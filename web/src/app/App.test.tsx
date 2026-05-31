import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { authStore } from '../features/auth/authStore';
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

function mockWorkspaceFetch(requestedUrls: string[], notesByRequest?: (url: string) => { items: unknown[]; hasMore: boolean }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    requestedUrls.push(path);

    if (path.endsWith('/settings/access-keys') && method === 'GET') {
      return new Response(JSON.stringify({ items: [{ id: 'k1', label: 'CLI', maskedKey: 'jifo_abcd••••••vwxyz', createdAt: '2026-05-31T00:00:00Z' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (path.includes('/settings/access-keys/') && method === 'DELETE') {
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
      return new Response(JSON.stringify({ items: page.items, page: { limit: 20, offset: path.includes('offset=20') ? 20 : 0, hasMore: page.hasMore } }), {
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

function authenticateAndRender() {
  const view = render(<App />);
  authStore.setSession({ accessToken: 'demo-token', user: { id: 'u1', email: 'oisin@example.com', username: 'oisin' } });
  view.rerender(<App />);
  return view;
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
    expect(requestedUrls).toContain('/api/notes?limit=20&offset=0');
  });

  test('搜索笔记时请求后端 search 参数', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    mockWorkspaceFetch(requestedUrls, (url) => ({ items: [note('search-note', url.includes('search=') ? '会议记录' : '初始笔记')], hasMore: false }));

    authenticateAndRender();
    await waitFor(() => expect(screen.getByText('初始笔记')).toBeInTheDocument());

    await user.type(screen.getByRole('searchbox', { name: '搜索笔记' }), '会议');

    await waitFor(() => expect(requestedUrls.some((url) => url.includes('/api/notes?search=%E4%BC%9A%E8%AE%AE&limit=20&offset=0'))).toBe(true));
    await waitFor(() => expect(screen.getByText('会议记录')).toBeInTheDocument());
  });

  test('点击标签时请求后端 tagPath 参数', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    mockWorkspaceFetch(requestedUrls, (url) => ({ items: [note('tag-note', url.includes('tagPath=') ? '#工作 标签结果' : '#工作 初始笔记')], hasMore: false }));

    authenticateAndRender();
    await waitFor(() => expect(screen.getByRole('button', { name: '工作 (1)' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '工作 (1)' }));

    await waitFor(() => expect(requestedUrls.some((url) => url.includes('/api/notes?tagPath=%E5%B7%A5%E4%BD%9C&limit=20&offset=0'))).toBe(true));
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
        if (url.includes('offset=20')) {
          return { items: [note('next-note', '下一页笔记')], hasMore: false };
        }
        return { items: Array.from({ length: 20 }, (_, index) => note(`note-${index}`, `第一页笔记 ${index}`)), hasMore: true };
      });

      authenticateAndRender();
      await waitFor(() => expect(screen.getByText('第一页笔记 0')).toBeInTheDocument());

      await act(async () => {
        observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      });

      await waitFor(() => expect(requestedUrls).toContain('/api/notes?limit=20&offset=20'));
      await waitFor(() => expect(screen.getByText('下一页笔记')).toBeInTheDocument());
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
  });
});
