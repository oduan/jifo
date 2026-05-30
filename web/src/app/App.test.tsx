import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { authStore } from '../features/auth/authStore';
import { App } from './App';

afterEach(() => {
  authStore.clear();
});

describe('App', () => {
  test('未认证显示登录页，已认证显示真实 API 驱动的 NotesPage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tags/tree')) {
        return new Response(JSON.stringify({ items: [{ id: 'tag-work', name: '工作', path: '工作', noteCount: 1 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/notes')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'note-1',
                clientId: 'client-1',
                content: { blocks: [{ type: 'paragraph', text: '#工作 第一条真实笔记' }] },
                plainText: '#工作 第一条真实笔记',
                createdAt: '2026-05-30T00:00:00Z',
                updatedAt: '2026-05-30T00:00:00Z',
                version: 1
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/heatmap')) {
        return new Response(JSON.stringify({ days: [{ date: '2026-05-30', createdCount: 1, updatedCount: 0, totalCount: 1 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('not found', { status: 404 });
    });

    const { rerender } = render(<App />);
    expect(screen.getByRole('heading', { name: '轻量记录，安静回看' })).toBeInTheDocument();

    authStore.setSession({ accessToken: 'demo-token', user: { id: 'u1', email: 'oisin@example.com', username: 'oisin' } });
    rerender(<App />);

    expect(screen.getAllByText('全部笔记').length).toBeGreaterThan(0);
    expect(screen.queryByText('Jifo 主界面（占位）')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('#工作 第一条真实笔记')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
