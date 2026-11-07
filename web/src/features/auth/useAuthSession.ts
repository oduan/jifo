import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { ApiError, createApiClient } from '../../shared/api/client';
import { apiBaseUrl } from '../../shared/api/baseUrl';
import { changePassword } from '../settings/api';
import { LoginPayload, LoginResult } from './LoginPage';
import { logoutAuth, refreshAuth, submitAuth } from './api';
import { authStorageKey, authStore } from './authStore';

const ACCESS_TOKEN_RENEWAL_THRESHOLD_MS = 2 * 60 * 1000;
const MAX_TIMEOUT_MS = 0x7fffffff;
// 静默刷新失败（非 401 清场）时的指数退避：30s→60s→120s…，上限 5 分钟。
const REFRESH_BACKOFF_BASE_MS = 30 * 1000;
const REFRESH_BACKOFF_MAX_MS = 5 * 60 * 1000;

export function secondsUntilJwtExpiry(token: string | null, now = Date.now()): number | null {
  if (!token) {
    return null;
  }
  const [, payload] = token.split('.');
  if (!payload) {
    return null;
  }
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof decoded.exp === 'number' ? decoded.exp - Math.floor(now / 1000) : null;
  } catch {
    return null;
  }
}

function createAuthRuntime() {
  const baseUrl = apiBaseUrl();
  // 刷新专用 client:不带 access token,靠 HttpOnly Cookie(client 统一 credentials:'include')换新。
  const refreshClient = createApiClient({
    baseUrl,
    getAccessToken: () => null
  });
  let refreshInFlight: Promise<string | null> | null = null;

  const refreshSession = () => {
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      // 本地没有 refreshToken:刷新完全依赖浏览器自动携带的 HttpOnly Cookie。
      // 记录请求起点的 accessToken 作为陈旧响应守卫(等价于旧的 refreshToken 比对):
      // 在途期间发生的登录/登出/其他 tab 写入都会改变它。
      const before = authStore.getState().accessToken;

      try {
        const refreshed = await refreshAuth(refreshClient);
        const latest = authStore.getState();
        // A logout, login, or another tab's storage event may have changed the
        // active session while this request was in flight. Never resurrect or
        // overwrite that newer session with a stale refresh response.
        if (latest.accessToken !== before) {
          return latest.accessToken;
        }
        authStore.setSession({
          accessToken: refreshed.accessToken,
          user: refreshed.user ?? latest.user ?? null
        });
        return refreshed.accessToken;
      } catch (refreshError) {
        if (
          refreshError instanceof ApiError &&
          refreshError.status === 401 &&
          authStore.getState().accessToken === before
        ) {
          // Cookie 已失效且期间没有新登录:清场回登录页(顺带清掉 localStorage 的用户信号)。
          // 网络/5xx 等非 401 失败不动会话,由调用方退避重试。
          authStore.clear();
        }
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  };

  return {
    client: createApiClient({
      baseUrl,
      getAccessToken: authStore.getAccessToken,
      refreshAccessToken: refreshSession
    }),
    refreshSession
  };
}

export function useAuthSession() {
  const authState = useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);
  const { client, refreshSession } = useMemo(() => createAuthRuntime(), []);

  const backoffAttemptRef = useRef(0);
  const bootstrappedRef = useRef(false);

  // 页面加载引导:accessToken 只存内存,冷启动时内存必然没有 token。
  // 先用 HttpOnly Cookie(credentials:'include')换一次新 accessToken;
  // 失败(401/网络)则维持登出态,由 AppRoutes 展示登录页。
  // 用户不会因此掉登录:上次登录写下的刷新 Cookie 仍然有效。
  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }
    bootstrappedRef.current = true;
    if (!authStore.getAccessToken()) {
      void refreshSession();
    }
  }, [refreshSession]);

  // 跨 tab 协同:token 只存在于各 tab 自己的内存里,refresh token 在共享的 HttpOnly Cookie 里,
  // localStorage 只剩 user 这个非敏感信号,storage 事件不再携带任何 token。
  // - 其他 tab 清空该键(登出)→ 本 tab 同步清场;
  // - 其他 tab 写入 user(登录)且本 tab 还没有 token → 本 tab 独立用 Cookie 换一次新 token。
  // 刷新本身各 tab 独立进行(浏览器自动携带同一份 Cookie),不需要广播 token 内容。
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== authStorageKey) {
        return;
      }
      if (!event.newValue) {
        authStore.clear();
        return;
      }
      if (!authStore.getAccessToken()) {
        void refreshSession();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshSession]);

  useEffect(() => {
    const accessToken = authState.accessToken;
    if (!accessToken) {
      return;
    }
    let timer: number | undefined;
    let cancelled = false;

    const attempt = async () => {
      const token = await refreshSession();
      if (cancelled) {
        return;
      }
      if (token) {
        // 成功：重置退避；accessToken 变化会触发本 effect 重新排程正常续期。
        backoffAttemptRef.current = 0;
        return;
      }
      // 返回 null 且会话仍在（非 401 清场，如网络/5xx）：指数退避重试。
      if (authStore.getAccessToken()) {
        const delay = Math.min(REFRESH_BACKOFF_BASE_MS * 2 ** backoffAttemptRef.current, REFRESH_BACKOFF_MAX_MS);
        backoffAttemptRef.current += 1;
        timer = window.setTimeout(() => void attempt(), delay);
      }
    };

    const secondsLeft = secondsUntilJwtExpiry(accessToken);
    if (secondsLeft === null) {
      return;
    }
    const delay = Math.min(Math.max(secondsLeft * 1000 - ACCESS_TOKEN_RENEWAL_THRESHOLD_MS, 0), MAX_TIMEOUT_MS);
    timer = window.setTimeout(() => void attempt(), delay);
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [authState.accessToken, refreshSession]);

  const submitLogin = useCallback((payload: LoginPayload): Promise<LoginResult> => submitAuth(client, payload), [client]);

  const logout = useCallback(async () => {
    try {
      await logoutAuth(client);
    } finally {
      authStore.clear();
    }
  }, [client]);

  const updatePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await changePassword(client, currentPassword, newPassword);
      authStore.clear();
    },
    [client]
  );

  return { authState, accessToken: authState.accessToken, client, refreshSession, submitLogin, logout, updatePassword };
}
