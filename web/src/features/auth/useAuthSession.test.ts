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
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'server_error' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    // access token 近过期（剩 60s < 阈值 2 分钟）→ 初始续期 delay 钳到 0
    authStore.setSession({
      accessToken: makeToken(60),
      refreshToken: 'refresh-token',
      user: { id: 'u1', email: 'a@b.c' }
    });

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
    expect(authStore.getState().refreshToken).toBe('refresh-token');
  });

  test('刷新返回 401 时清空会话且不再退避重试', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'invalid_refresh_token' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    authStore.setSession({
      accessToken: makeToken(60),
      refreshToken: 'refresh-token',
      user: { id: 'u1', email: 'a@b.c' }
    });

    renderHook(() => useAuthSession());

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 401 已清场
    expect(authStore.getState().accessToken).toBeNull();
    expect(authStore.getState().refreshToken).toBeNull();

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
    authStore.setSession({ accessToken: makeToken(3600), refreshToken: 'old-refresh', user: { id: 'old-user', email: 'old@example.com' } });
    const { result } = renderHook(() => useAuthSession());

    const refreshPromise = result.current.refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => {
      authStore.setSession({ accessToken: 'new-access', refreshToken: 'new-refresh', user: { id: 'new-user', email: 'new@example.com' } });
    });
    resolveFetch?.(new Response(JSON.stringify({ accessToken: 'stale-access', refreshToken: 'stale-refresh', user: { id: 'old-user', email: 'old@example.com' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    await refreshPromise;

    expect(authStore.getState()).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh', user: { id: 'new-user', email: 'new@example.com' } });
  });

  test('旧刷新请求的 401 不会清空后来登录的会话', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    global.fetch = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    ) as unknown as typeof fetch;
    authStore.setSession({ accessToken: makeToken(3600), refreshToken: 'old-refresh', user: { id: 'old-user', email: 'old@example.com' } });
    const { result } = renderHook(() => useAuthSession());

    const refreshPromise = result.current.refreshSession();
    act(() => {
      authStore.setSession({ accessToken: 'new-access', refreshToken: 'new-refresh', user: { id: 'new-user', email: 'new@example.com' } });
    });
    resolveFetch?.(new Response(JSON.stringify({ error: { code: 'invalid_refresh_token' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    }));
    await refreshPromise;

    expect(authStore.getState().refreshToken).toBe('new-refresh');
    expect(authStore.getState().user?.id).toBe('new-user');
  });
});
