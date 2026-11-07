import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { authStore } from './authStore';
import { useAuthSession } from './useAuthSession';

function makeToken(expSecondsFromNow: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = btoa(JSON.stringify({ exp }));
  return `${header}.${payload}.sig`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('useAuthSession 静默刷新退避', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    authStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    authStore.clear();
    localStorage.clear();
  });

  test('刷新失败（非 401）时按 30s→60s 指数退避重排定时器', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { code: 'server_error' } }, 500));
    global.fetch = fetchMock as unknown as typeof fetch;

    // access token 近过期（剩 60s < 阈值 2 分钟）→ 初始续期 delay 钳到 0
    authStore.setSession({ accessToken: makeToken(60), user: { id: 'u1', email: 'a@b.c' } });

    renderHook(() => useAuthSession());

    // 初次尝试（delay 0）
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 退避 30s 后第二次尝试
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 退避 60s 后第三次尝试
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 未收到 401，会话未被清空
    expect(authStore.getState().accessToken).not.toBeNull();
  });

  test('刷新返回 401 时清空会话且不再退避重试', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { code: 'invalid_refresh_token' } }, 401));
    global.fetch = fetchMock as unknown as typeof fetch;

    authStore.setSession({ accessToken: makeToken(60), user: { id: 'u1', email: 'a@b.c' } });

    renderHook(() => useAuthSession());

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 401 已清场
    expect(authStore.getState().accessToken).toBeNull();
    expect(authStore.getState().user).toBeNull();

    // 退避窗口内不再发起刷新
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('在途刷新成功不会覆盖其他标签页写入的新会话', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    authStore.setSession({ accessToken: makeToken(3600), user: { id: 'old-user', email: 'old@example.com' } });
    const { result } = renderHook(() => useAuthSession());

    const refreshPromise = result.current.refreshSession();
    act(() => {
      authStore.setSession({ accessToken: 'new-access', user: { id: 'new-user', email: 'new@example.com' } });
    });
    resolveFetch?.(jsonResponse({ accessToken: 'stale-access', refreshToken: 'stale-refresh', user: { id: 'old-user', email: 'old@example.com' } }));
    await refreshPromise;

    expect(authStore.getState()).toEqual({ accessToken: 'new-access', user: { id: 'new-user', email: 'new@example.com' } });
  });

  test('旧刷新请求的 401 不会清空后来登录的会话', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    global.fetch = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    ) as unknown as typeof fetch;
    authStore.setSession({ accessToken: makeToken(3600), user: { id: 'old-user', email: 'old@example.com' } });
    const { result } = renderHook(() => useAuthSession());

    const refreshPromise = result.current.refreshSession();
    act(() => {
      authStore.setSession({ accessToken: 'new-access', user: { id: 'new-user', email: 'new@example.com' } });
    });
    resolveFetch?.(jsonResponse({ error: { code: 'invalid_refresh_token' } }, 401));
    await refreshPromise;

    expect(authStore.getState().accessToken).toBe('new-access');
    expect(authStore.getState().user?.id).toBe('new-user');
  });
});

describe('useAuthSession 启动引导与跨 tab 协同', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    authStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    authStore.clear();
    localStorage.clear();
  });

  test('页面加载无内存 token 时用 HttpOnly Cookie 引导换新 accessToken', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({ accessToken: 'boot-fresh-token', refreshToken: 'rotated-never-stored', user: { id: 'u1', email: 'a@b.c' } })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    // 上一会话只留下非敏感 user(旧版本残留的 token 已被迁移剥离)
    authStore.setSession({ accessToken: null, user: { id: 'u1', email: 'a@b.c' } });

    renderHook(() => useAuthSession());
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/auth/refresh');
    // 刷新请求必须带 Cookie(credentials:include),本地不再有 refreshToken 可用
    expect(init?.credentials).toBe('include');
    expect(authStore.getAccessToken()).toBe('boot-fresh-token');
    // localStorage 里没有任何 token 痕迹,只剩 user
    const stored = localStorage.getItem('jifo.auth') ?? '';
    expect(stored).not.toContain('boot-fresh-token');
    expect(stored).not.toContain('rotated-never-stored');
    expect(stored).toContain('a@b.c');
  });

  test('引导刷新失败（401）时清空会话回到登出态', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { code: 'invalid_refresh_token' } }, 401));
    global.fetch = fetchMock as unknown as typeof fetch;

    authStore.setSession({ accessToken: null, user: { id: 'u1', email: 'a@b.c' } });
    expect(localStorage.getItem('jifo.auth')).not.toBeNull();

    renderHook(() => useAuthSession());
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authStore.getAccessToken()).toBeNull();
    // Cookie 已失效,user 信号一并清掉,后续访问不再空发刷新请求
    expect(localStorage.getItem('jifo.auth')).toBeNull();
  });

  test('其他 tab 登出（storage 键被清空）时本 tab 同步清场', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;
    authStore.setSession({ accessToken: 'tab-token', user: { id: 'u1', email: 'a@b.c' } });

    renderHook(() => useAuthSession());
    await vi.advanceTimersByTimeAsync(0);
    // 内存已有 token,启动引导不会发起请求
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'jifo.auth', newValue: null }));
    });

    expect(authStore.getAccessToken()).toBeNull();
    expect(authStore.getState().user).toBeNull();
    expect(localStorage.getItem('jifo.auth')).toBeNull();
  });

  test('其他 tab 登录（写入 user）且本 tab 无 token 时独立用 Cookie 换新', async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        // 首次引导刷新遇到网络故障(非 401,不清场),本 tab 仍无 token
        throw new TypeError('network offline');
      }
      return jsonResponse({ accessToken: 'cross-tab-fresh', refreshToken: 'cross-tab-rotated', user: { id: 'u2', email: 'c@d.e' } });
    }) as unknown as typeof fetch;

    renderHook(() => useAuthSession());
    await vi.advanceTimersByTimeAsync(0);
    expect(authStore.getAccessToken()).toBeNull();

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'jifo.auth', newValue: JSON.stringify({ user: { id: 'u2', email: 'c@d.e' } }) }));
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(authStore.getAccessToken()).toBe('cross-tab-fresh');
    // 换新结果同样只进内存,不落 Web 存储
    expect(localStorage.getItem('jifo.auth')).not.toContain('cross-tab-fresh');
    expect(localStorage.getItem('jifo.auth')).not.toContain('cross-tab-rotated');
  });
});
