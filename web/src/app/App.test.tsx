import { File as NodeFile } from 'node:buffer';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { authStore } from '../features/auth/authStore';
import { createJifoDb } from '../storage/db';
import { App } from './App';

afterEach(() => {
  authStore.clear();
  vi.restoreAllMocks();
});

function note(id: string, text: string) {
  return {
    id,
    clientId: `client-${id}`,
    content: { blocks: [{ type: 'paragraph', text }] },
    plainText: text,
    createdAt: '2026-05-30T00:00:00Z',
    updatedAt: '2026-05-30T00:00:00Z',
    version: 1
  };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function mockWorkspaceFetch(requestedUrls: string[], notesByRequest?: (url: string) => { items: unknown[]; hasMore: boolean }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    requestedUrls.push(path);

    if (path.endsWith('/notes/stats')) {
      return new Response(JSON.stringify({ total: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (path.endsWith('/settings/access-keys') && method === 'GET') {
      return new Response(JSON.stringify({ items: [{ id: 'k1', label: 'CLI', maskedKey: 'jifo_abcd••••••vwxyz', createdAt: '2026-05-31T00:00:00Z' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (path.includes('/settings/access-keys/') && method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (method === 'DELETE' && /\/notes\/[^/]+$/.test(path)) {
      return new Response(JSON.stringify({ item: note('note-1', '#工作 第一条真实笔记') }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (method === 'POST' && path.endsWith('/restore')) {
      return new Response(JSON.stringify({ item: note('note-1', '#工作 第一条真实笔记') }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (path.endsWith('/auth/logout') && method === 'POST') {
      return new Response(null, { status: 204 });
    }
    if (path.endsWith('/tags/tree')) {
      return new Response(JSON.stringify({ items: [{ id: 'tag-work', name: '工作', path: '工作', noteCount: 1 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (path.includes('/notes')) {
      const page = notesByRequest?.(path) ?? { items: [note('note-1', '#工作 第一条真实笔记')], hasMore: false };
      return new Response(JSON.stringify({ items: page.items, page: { limit: 20, offset: 0, hasMore: page.hasMore, ...(page.hasMore ? { nextCursor: 'cursor-page-2' } : {}) } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (path.includes('/heatmap')) {
      return new Response(JSON.stringify({ days: [{ date: '2026-05-30', createdCount: 1, updatedCount: 0, totalCount: 1 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('not found', { status: 404 });
  });
}

// 先种好会话再挂载：accessToken 只存内存，挂载时内存已有 token，
// useAuthSession 的启动引导刷新自然跳过，不打乱下方各用例对请求次数的预期。
function authenticateAndRender(session = { accessToken: 'demo-token', user: { id: 'u1', email: 'oisin@example.com', username: 'oisin' } }) {
  authStore.setSession(session);
  return render(<App />);
}

describe('App', () => {
  test('未认证显示登录页，已认证后请求第一页笔记', async () => {
    const requestedUrls: string[] = [];
    mockWorkspaceFetch(requestedUrls);

    const { rerender } = render(<App />);
    expect(screen.getByRole('heading', { name: '轻量记录，安静回看' })).toBeInTheDocument();

    authStore.setSession({ accessToken: 'demo-token', user: { id: 'u1', email: 'oisin@example.com', username: 'oisin' } });
    rerender(<App />);

    await waitFor(() => expect(screen.getByRole('button', { name: '#工作' })).toBeInTheDocument());
    expect(screen.getByText(/第一条真实笔记/)).toBeInTheDocument();
    expect(screen.getByLabelText('账户统计')).toHaveTextContent('42');
    expect(requestedUrls).toContain('/api/notes/stats');
    expect(requestedUrls).toContain('/api/notes?limit=20');
  });

  test('access token 过期时自动刷新并继续加载工作区', async () => {
    const requestedUrls: string[] = [];
    const authHeaders: Record<string, string[]> = {};
    let tagTreeCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      requestedUrls.push(path);
      const headers = new Headers(init?.headers ?? undefined);
      authHeaders[path] = [...(authHeaders[path] ?? []), headers.get('Authorization') ?? ''];

      if (path.endsWith('/tags/tree')) {
        tagTreeCalls += 1;
        if (tagTreeCalls === 1) {
          return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'expired' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ items: [{ id: 'tag-work', name: '工作', path: '工作', noteCount: 1 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ accessToken: 'fresh-token', refreshToken: 'refresh-token-2', user: { id: 'u1', email: 'oisin@example.com', username: 'oisin' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.includes('/notes')) {
        return new Response(JSON.stringify({ items: [note('note-1', '#工作 刷新后笔记')], page: { limit: 20, offset: 0, hasMore: false } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.includes('/heatmap')) {
        return new Response(JSON.stringify({ days: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('not found', { status: 404 });
    });

    authenticateAndRender({ accessToken: 'expired-token', user: { id: 'u1', email: 'oisin@example.com', username: 'oisin' } });

    await waitFor(() => expect(screen.getByText(/刷新后笔记/)).toBeInTheDocument());
    expect(requestedUrls).toContain('/api/auth/refresh');
    expect(authStore.getState().accessToken).toBe('fresh-token');
    // 刷新令牌不再落 Web 存储:localStorage 只剩 user
    const storedAfterRefresh = localStorage.getItem('jifo.auth') ?? '';
    expect(storedAfterRefresh).not.toContain('refresh-token-2');
    expect(storedAfterRefresh).not.toContain('fresh-token');
    expect(authHeaders['/api/tags/tree'][0]).toBe('Bearer expired-token');
    expect(authHeaders['/api/tags/tree']).toContain('Bearer fresh-token');
  });

  test('多个并发请求同时 401 时只刷新一次并继续保持登录', async () => {
    let refreshCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const token = new Headers(init?.headers ?? undefined).get('Authorization') ?? '';

      if (path.endsWith('/tags/tree')) {
        return new Response(JSON.stringify({ items: [{ id: 'tag-work', name: '工作', path: '工作', noteCount: 1 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await delay(10);
        if (refreshCalls > 1) {
          return new Response(JSON.stringify({ error: { code: 'invalid_refresh_token' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ accessToken: 'fresh-token', refreshToken: 'refresh-token-2', user: { id: 'u1', email: 'oisin@example.com', username: 'oisin' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (token === 'Bearer expired-token') {
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'expired' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.endsWith('/notes/stats')) {
        return new Response(JSON.stringify({ total: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.includes('/notes')) {
        return new Response(JSON.stringify({ items: [note('note-1', '#工作 并发刷新后笔记')], page: { limit: 20, offset: 0, hasMore: false } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.includes('/heatmap')) {
        return new Response(JSON.stringify({ days: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('not found', { status: 404 });
    });

    authenticateAndRender({ accessToken: 'expired-token', user: { id: 'u1', email: 'oisin@example.com', username: 'oisin' } });

    await waitFor(() => expect(screen.getByText(/并发刷新后笔记/)).toBeInTheDocument());
    expect(refreshCalls).toBe(1);
    expect(authStore.getState().accessToken).toBe('fresh-token');
  });

  test('搜索笔记时请求后端 search 参数', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    mockWorkspaceFetch(requestedUrls, (url) => ({ items: [note('search-note', url.includes('search=') ? '会议记录' : '初始笔记')], hasMore: false }));

    authenticateAndRender();
    await waitFor(() => expect(screen.getByText('初始笔记')).toBeInTheDocument());

    await user.type(screen.getByRole('searchbox', { name: '搜索笔记' }), '会议');

    await waitFor(() => expect(requestedUrls.some((url) => url.includes('/api/notes?search=%E4%BC%9A%E8%AE%AE&limit=20'))).toBe(true));
    await waitFor(() => expect(screen.getByText('会议记录')).toBeInTheDocument());
  });

  test('点击标签时请求后端 tagPath 参数', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    mockWorkspaceFetch(requestedUrls, (url) => ({ items: [note('tag-note', url.includes('tagPath=') ? '#工作 标签结果' : '#工作 初始笔记')], hasMore: false }));

    authenticateAndRender();
    await waitFor(() => expect(screen.getByRole('button', { name: '工作 (1)' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '工作 (1)' }));

    await waitFor(() => expect(requestedUrls.some((url) => url.includes('/api/notes?tagPath=%E5%B7%A5%E4%BD%9C&limit=20'))).toBe(true));
    await waitFor(() => expect(screen.getByText(/标签结果/)).toBeInTheDocument());
  });

  test('在设置弹窗删除访问密钥时调用后端并从列表移除', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockWorkspaceFetch(requestedUrls);

    authenticateAndRender();
    await waitFor(() => expect(screen.getByText(/第一条真实笔记/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'oisin 设置菜单' }));
    await user.click(screen.getByRole('button', { name: '设置' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '删除 CLI 访问密钥' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '删除 CLI 访问密钥' }));

    await waitFor(() => expect(requestedUrls).toContain('/api/settings/access-keys/k1'));
    await waitFor(() => expect(screen.queryByText('jifo_abcd••••••vwxyz')).not.toBeInTheDocument());
  });

  test('退出登录时先调用服务端logout再清除本地会话', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    mockWorkspaceFetch(requestedUrls);
    authenticateAndRender();
    await waitFor(() => expect(screen.getByText(/第一条真实笔记/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'oisin 设置菜单' }));
    await user.click(screen.getByRole('button', { name: '退出登录' }));

    await waitFor(() => expect(requestedUrls).toContain('/api/auth/logout'));
    await waitFor(() => expect(authStore.getState().accessToken).toBeNull());
    expect(screen.getByRole('heading', { name: '轻量记录，安静回看' })).toBeInTheDocument();
  });

  test('周期同步连续失败达阈值时提示改动暂存本地，恢复后提示同步已恢复，单次失败不打扰', async () => {
    let syncPullShouldFail = false;
    let syncPullCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = String(input).replace(/^https?:\/\/[^/]+/, '');

      if (path.includes('/sync/pull')) {
        syncPullCalls += 1;
        if (syncPullShouldFail) {
          throw new TypeError('network down');
        }
        return new Response(JSON.stringify({ notes: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path.endsWith('/notes/stats')) {
        return new Response(JSON.stringify({ total: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path.endsWith('/tags/tree')) {
        return new Response(JSON.stringify({ items: [{ id: 'tag-work', name: '工作', path: '工作', noteCount: 1 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.includes('/notes')) {
        return new Response(JSON.stringify({ items: [note('note-1', '#工作 同步提示测试')], page: { limit: 20, offset: 0, hasMore: false } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.includes('/heatmap')) {
        return new Response(JSON.stringify({ days: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });

    // 独立用户 id 隔离 Dexie 库，避免同文件其他用例的残留数据串扰
    authenticateAndRender({ accessToken: 'demo-token', user: { id: 'sync-toast-user', email: 'sync-toast@example.com', username: 'sync-toast' } });
    await waitFor(() => expect(screen.getByText(/同步提示测试/)).toBeInTheDocument());

    const db = createJifoDb('jifo-sync-toast-user');
    try {
      // 等待本轮同步彻底结束（pull 调用数达标且 Dexie 同步锁已释放），
      // 避免下一轮 'online' 触发时上一轮还占着锁、被跳过当成成功。
      const waitForSyncSettled = async (expectedPullCalls: number) => {
        await vi.waitFor(async () => {
          expect(syncPullCalls).toBe(expectedPullCalls);
          expect(await db.sync_state.get('sync_lock')).toBeUndefined();
        });
        await act(async () => {});
      };

      // 挂载时的一次周期同步成功，失败计数从 0 开始
      await waitForSyncSettled(1);
      expect(screen.queryByText('同步失败,改动暂存本地')).not.toBeInTheDocument();

      syncPullShouldFail = true;

      // 第 1 次失败：不打扰
      await act(async () => {
        window.dispatchEvent(new Event('online'));
      });
      await waitForSyncSettled(2);
      expect(screen.queryByText('同步失败,改动暂存本地')).not.toBeInTheDocument();

      // 第 2 次失败：仍不打扰
      await act(async () => {
        window.dispatchEvent(new Event('online'));
      });
      await waitForSyncSettled(3);
      expect(screen.queryByText('同步失败,改动暂存本地')).not.toBeInTheDocument();

      // 第 3 次连续失败：提示一次「改动暂存本地」
      await act(async () => {
        window.dispatchEvent(new Event('online'));
      });
      await waitForSyncSettled(4);
      expect(screen.getByText('同步失败,改动暂存本地')).toBeInTheDocument();

      // 恢复成功：重置计数并提示「同步已恢复」
      syncPullShouldFail = false;
      await act(async () => {
        window.dispatchEvent(new Event('online'));
      });
      await waitForSyncSettled(5);
      expect(screen.getByText('同步已恢复')).toBeInTheDocument();
    } finally {
      db.close();
    }
  });

  test('设置里「仅登出」保留本地笔记缓存,服务器登出照常', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    mockWorkspaceFetch(requestedUrls);

    authenticateAndRender({ accessToken: 'demo-token', user: { id: 'logout-keep-user', email: 'keep@example.com', username: 'keep' } });
    await waitFor(() => expect(screen.getByText(/第一条真实笔记/)).toBeInTheDocument());

    const db = createJifoDb('jifo-logout-keep-user');
    try {
      expect((await db.notes_cache.toArray()).length).toBeGreaterThan(0);

      await user.click(screen.getByRole('button', { name: 'keep 设置菜单' }));
      await user.click(screen.getByRole('button', { name: '设置' }));
      await user.click(screen.getByRole('button', { name: '账户' }));
      await user.click(screen.getByRole('button', { name: '仅登出(保留本地缓存)' }));

      await waitFor(() => expect(requestedUrls).toContain('/api/auth/logout'));
      await waitFor(() => expect(authStore.getState().accessToken).toBeNull());
      expect(screen.getByRole('heading', { name: '轻量记录，安静回看' })).toBeInTheDocument();
      // 默认动作是保留:IndexedDB 里的笔记缓存原样保留
      expect((await db.notes_cache.toArray()).length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  test('「登出并清除本地数据」拒绝确认时不删除,确认后删除本地缓存并登出', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    const confirmSpy = vi.spyOn(window, 'confirm');
    mockWorkspaceFetch(requestedUrls);

    authenticateAndRender({ accessToken: 'demo-token', user: { id: 'logout-clear-user', email: 'clear@example.com', username: 'clear' } });
    await waitFor(() => expect(screen.getByText(/第一条真实笔记/)).toBeInTheDocument());

    // 持有打开的 IndexedDB 连接会让 deleteDatabase 阻塞:每次校验都是
    // 打开→读取→立即关闭,确认删除执行时不留任何测试侧连接。
    const readCachedNotes = async () => {
      const probe = createJifoDb('jifo-logout-clear-user');
      try {
        return await probe.notes_cache.toArray();
      } finally {
        probe.close();
      }
    };

    await user.click(screen.getByRole('button', { name: 'clear 设置菜单' }));
    await user.click(screen.getByRole('button', { name: '设置' }));
    await user.click(screen.getByRole('button', { name: '账户' }));

    // 路径一:拒绝确认 → 既不登出也不删数据
    confirmSpy.mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: '登出并清除本地数据' }));
    await act(async () => {});
    expect(requestedUrls).not.toContain('/api/auth/logout');
    expect(authStore.getState().accessToken).not.toBeNull();
    expect((await readCachedNotes()).length).toBeGreaterThan(0);

    // 路径二:确认后 → 删除该浏览器上的本地缓存,服务器登出照常
    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '登出并清除本地数据' }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('删除此浏览器上的全部本地笔记缓存'));
    expect(String(confirmSpy.mock.calls[confirmSpy.mock.calls.length - 1][0])).toContain('服务器上的笔记不受影响');

    await waitFor(() => expect(requestedUrls).toContain('/api/auth/logout'));
    await waitFor(() => expect(authStore.getState().accessToken).toBeNull());
    expect(screen.getByRole('heading', { name: '轻量记录，安静回看' })).toBeInTheDocument();
    // 删除后重新打开同名库:库被重建为空,之前的笔记缓存已不在
    await vi.waitFor(async () => {
      expect(await readCachedNotes()).toEqual([]);
    });
  });

  test('滚动到底时根据 hasMore 请求下一页并追加', async () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const requestedUrls: string[] = [];

    class MockIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0];
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      disconnect = vi.fn();
      observe = vi.fn();
      takeRecords = vi.fn(() => []);
      unobserve = vi.fn();
    }

    globalThis.IntersectionObserver = MockIntersectionObserver;

    try {
      mockWorkspaceFetch(requestedUrls, (url) => {
        if (url.includes('cursor=')) {
          return { items: [note('next-note', '下一页笔记')], hasMore: false };
        }
        return { items: Array.from({ length: 20 }, (_, index) => note(`note-${index}`, `第一页笔记 ${index}`)), hasMore: true };
      });

      authenticateAndRender();
      await waitFor(() => expect(screen.getByText('第一页笔记 0')).toBeInTheDocument());

      await act(async () => {
        observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      });

      await waitFor(() => expect(requestedUrls.some((url) => url.includes('/api/notes?') && url.includes('cursor=cursor-page-2'))).toBe(true));
      await waitFor(() => expect(screen.getByText('下一页笔记')).toBeInTheDocument());
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
  });

  test('工作区加载失败时以 toast 提示错误并提供重试', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ error: { code: 'server_error', message: 'boom' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    authenticateAndRender();

    await waitFor(() => expect(screen.getByText('请求失败（500），请稍后重试。')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  test('删除笔记后展示 toast，撤销会调用恢复接口', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    mockWorkspaceFetch(requestedUrls);

    authenticateAndRender();
    await waitFor(() => expect(screen.getByText(/第一条真实笔记/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(screen.getByText('已移入回收站')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '撤销' }));

    await waitFor(() => expect(screen.queryByText('已移入回收站')).not.toBeInTheDocument());
    expect(requestedUrls.some((url) => url.endsWith('/notes/note-1/restore'))).toBe(true);
  });

  test('离线删除后撤销会取消待同步删除，不追加恢复操作', async () => {
    const user = userEvent.setup();
    let offline = false;
    const requestedUrls: string[] = [];
    const fetchMock = mockWorkspaceFetch(requestedUrls);
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input).replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      if (offline) {
        throw new TypeError('network offline');
      }
      if (method === 'DELETE' && /\/notes\/[^/]+$/.test(path)) {
        offline = true;
        throw new TypeError('network offline');
      }
      if (path.endsWith('/notes/stats')) {
        return new Response(JSON.stringify({ total: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path.endsWith('/tags/tree')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path.includes('/notes')) {
        return new Response(JSON.stringify({ items: [note('offline-note', '离线撤销笔记')], page: { limit: 20, offset: 0, hasMore: false } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.includes('/heatmap')) {
        return new Response(JSON.stringify({ days: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });

    authenticateAndRender({ accessToken: 'demo-token', user: { id: 'offline-user', email: 'offline@example.com', username: 'offline' } });
    await waitFor(() => expect(screen.getByText('离线撤销笔记')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.getByText('已移入回收站')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(screen.getByText('离线撤销笔记')).toBeInTheDocument());

    const db = createJifoDb('jifo-offline-user');
    const operations = await db.outbox.filter((operation) => operation.noteId === 'offline-note').toArray();
    expect(operations).toEqual([]);
    expect((await db.notes_cache.get('offline-note'))?.deletedAt).toBeNull();
    db.close();
  });

  test('修改操作失败时提示错误，但不显示无效的工作区重试动作', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    const fetchMock = mockWorkspaceFetch(requestedUrls);
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input).replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      if (method === 'DELETE' && /\/notes\/[^/]+$/.test(path)) {
        return new Response(JSON.stringify({ error: { code: 'server_error', message: 'delete failed' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.endsWith('/notes/stats')) {
        return new Response(JSON.stringify({ total: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path.endsWith('/tags/tree')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path.includes('/notes')) {
        return new Response(JSON.stringify({ items: [note('note-1', '删除失败笔记')], page: { limit: 20, offset: 0, hasMore: false } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.includes('/heatmap')) {
        return new Response(JSON.stringify({ days: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });

    authenticateAndRender();
    await waitFor(() => expect(screen.getByText('删除失败笔记')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(screen.getByText('请求失败（500），请稍后重试。')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  test('离线粘贴图片降级进 media_cache，恢复联网后随同步上传并携带 mediaId 推送', async () => {
    const user = userEvent.setup();
    const pushBodies: Array<{ operations: Array<{ payload: { blocks: Array<Record<string, unknown>> } }> }> = [];
    let mediaPostCount = 0;
    // 断网：粘贴的图片不请求 /media，直接落 media_cache
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path.endsWith('/media')) {
        mediaPostCount += 1;
        return new Response(JSON.stringify({ item: { id: 'server-media-1', kind: 'image', mimeType: 'image/png', sizeBytes: 9, checksum: 'x', url: '/media/server-media-1', createdAt: '2026-05-30T00:00:00Z' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (method === 'POST' && path.endsWith('/sync/push')) {
        const body = JSON.parse(String(init?.body));
        pushBodies.push(body);
        return new Response(JSON.stringify({ results: body.operations.map((operation: { opId: string }) => ({ opId: operation.opId, status: 'created', noteId: 'server-note-image', version: 1 })) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path.includes('/sync/pull')) {
        return new Response(JSON.stringify({ notes: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path.endsWith('/notes/stats')) {
        return new Response(JSON.stringify({ total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path.endsWith('/tags/tree')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path.includes('/notes')) {
        return new Response(JSON.stringify({ items: [], page: { limit: 20, offset: 0, hasMore: false } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path.includes('/heatmap')) {
        return new Response(JSON.stringify({ days: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });

    try {
      // 独立用户 id 隔离 Dexie 库，避免同文件其他用例的 'jifo-u1' 残留数据串扰
      authenticateAndRender({ accessToken: 'demo-token', user: { id: 'media-user', email: 'media@example.com', username: 'media' } });
      const textarea = await screen.findByLabelText('笔记内容');

      // 离线粘贴：编辑器缩略图直接读回 media_cache 里的本地 blob
      // （用 Node 原生 File 构造，jsdom File 过不了 fake-indexeddb 的 structuredClone）
      const file = new NodeFile(['png-bytes'], 'offline.png', { type: 'image/png' });
      fireEvent.paste(textarea, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } });
      await screen.findByAltText('offline.png');

      await user.type(textarea, '离线粘贴');
      await user.click(screen.getByRole('button', { name: '发送笔记' }));

      const db = createJifoDb('jifo-media-user');
      try {
        await vi.waitFor(async () => {
          const pending = await db.media_cache.where('status').equals('local_pending').toArray();
          expect(pending).toHaveLength(1);
          expect(pending[0]?.blob?.size).toBe(9);
        });
        // 离线粘贴阶段没有发生任何媒体上传请求
        expect(mediaPostCount).toBe(0);

        // 恢复联网：'online' 事件触发同步，先上传图片再推送笔记
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
        await act(async () => {
          window.dispatchEvent(new Event('online'));
        });

        await vi.waitFor(() => expect(mediaPostCount).toBe(1));
        await vi.waitFor(() => expect(pushBodies).toHaveLength(1));
        expect(pushBodies[0].operations[0].payload.blocks).toContainEqual({ type: 'image', mediaId: 'server-media-1', alt: 'offline.png' });
        await vi.waitFor(async () => {
          const uploaded = await db.media_cache.where('status').equals('uploaded').toArray();
          expect(uploaded).toHaveLength(1);
          expect(uploaded[0]?.serverId).toBe('server-media-1');
        });
      } finally {
        db.close();
      }
    } finally {
      delete (window.navigator as { onLine?: boolean }).onLine;
    }
  });
});
