import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { ApiError, createApiClient } from '../../shared/api/client';
import { apiBaseUrl } from '../../shared/api/baseUrl';
import { changePassword } from '../settings/api';
import { LoginPayload, LoginResult } from './LoginPage';
import { logoutAuth, refreshAuth, submitAuth } from './api';
import { authStore } from './authStore';

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
      const current = authStore.getState();
      if (!current.refreshToken) {
        return null;
      }
      const requestedRefreshToken = current.refreshToken;

      try {
        const refreshed = await refreshAuth(refreshClient, requestedRefreshToken);
        const latest = authStore.getState();
        // A logout, login, or storage event may have changed the active
        // account while this request was in flight. Never resurrect or
        // overwrite that newer session with a stale refresh response.
        if (latest.refreshToken !== requestedRefreshToken) {
          return latest.accessToken;
        }
        authStore.setSession({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? null,
          user: refreshed.user ?? current.user ?? null
        });
        return refreshed.accessToken;
      } catch (refreshError) {
        if (
          refreshError instanceof ApiError &&
          refreshError.status === 401 &&
          authStore.getState().refreshToken === requestedRefreshToken
        ) {
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

  useEffect(() => {
    const accessToken = authState.accessToken;
    if (!accessToken || !authState.refreshToken) {
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
      // 返回 null 且 refreshToken 仍在（非 401 清场，如网络/5xx）：指数退避重试。
      if (authStore.getState().refreshToken) {
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
  }, [authState.accessToken, authState.refreshToken, refreshSession]);

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
