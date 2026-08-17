import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { ApiClient } from '../../shared/api/client';
import { CachedNote, JifoDb } from '../../storage/db';
import { authStore } from '../auth/authStore';
import { listNoteStats, listNotes } from './api';
import { useNotesWorkspace, WorkspaceFilterState } from './useNotesWorkspace';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listNotes: vi.fn(),
  listNoteStats: vi.fn()
}));

vi.mock('../tags/api', () => ({
  listTagTree: vi.fn(async () => [])
}));

vi.mock('../heatmap/api', () => ({
  loadHeatmap: vi.fn(async () => [])
}));

type ApiNoteItem = Parameters<typeof import('./api').fromApiNote>[0];

function apiNote(id: string, overrides: Partial<ApiNoteItem> = {}): ApiNoteItem {
  return {
    id,
    clientId: `client-${id}`,
    content: { blocks: [{ type: 'paragraph', text: id }] },
    plainText: id,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 1,
    ...overrides
  };
}

function notesPage(ids: string[], hasMore = false, nextCursor?: string) {
  return {
    items: ids.map(apiNote),
    page: { limit: 20, offset: 0, hasMore, nextCursor }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const fakeDb = {
  notes_cache: {
    bulkPut: async () => undefined,
    put: async () => undefined,
    toArray: async () => []
  }
} as unknown as JifoDb;

const client = {} as ApiClient;

describe('useNotesWorkspace loadWorkspace', () => {
  beforeEach(() => {
    authStore.setSession({ accessToken: 'token', refreshToken: 'refresh', user: { id: 'u1', email: 'u@example.com' } });
    vi.mocked(listNoteStats).mockResolvedValue({ total: 0 });
  });

  afterEach(() => {
    authStore.clear();
    vi.clearAllMocks();
  });

  function setup(initialFilters: WorkspaceFilterState) {
    const reportError = vi.fn();
    const rendered = renderHook(
      ({ filters }: { filters: WorkspaceFilterState }) => useNotesWorkspace({ client, db: fakeDb, filters, reportError }),
      { initialProps: { filters: initialFilters } }
    );
    return { ...rendered, reportError };
  }

  test('discards stale responses superseded by a newer loadWorkspace call', async () => {
    const stale = deferred<ReturnType<typeof notesPage>>();
    vi.mocked(listNotes)
      .mockImplementationOnce(async () => stale.promise)
      .mockImplementationOnce(async () => notesPage(['fresh-note']));

    const { result, rerender } = setup({ debouncedQuery: '', showTrash: false });

    let firstLoad!: Promise<void>;
    act(() => {
      firstLoad = result.current.loadWorkspace();
    });

    rerender({ filters: { debouncedQuery: 'query', showTrash: false } });
    await act(async () => {
      await result.current.loadWorkspace();
    });
    expect(result.current.notes.map((note) => note.id)).toEqual(['fresh-note']);

    // 迟到的旧响应到达后不得覆盖新状态
    await act(async () => {
      stale.resolve(notesPage(['stale-note']));
      await firstLoad;
    });
    expect(result.current.notes.map((note) => note.id)).toEqual(['fresh-note']);
  });

  test('skips duplicate concurrent loads with identical filters', async () => {
    vi.mocked(listNotes).mockResolvedValue(notesPage(['note-1']));

    const { result } = setup({ debouncedQuery: '', showTrash: false });

    await act(async () => {
      await Promise.all([result.current.loadWorkspace(), result.current.loadWorkspace()]);
    });

    expect(vi.mocked(listNotes)).toHaveBeenCalledTimes(1);
    expect(result.current.notes.map((note) => note.id)).toEqual(['note-1']);
  });

  test('loadMoreNotes deduplicates already-loaded notes by id', async () => {
    vi.mocked(listNotes)
      .mockResolvedValueOnce(notesPage(['note-1'], true))
      .mockResolvedValueOnce(notesPage(['note-1', 'note-2']));

    const { result } = setup({ debouncedQuery: '', showTrash: false });

    await act(async () => {
      await result.current.loadWorkspace();
    });
    await waitFor(() => expect(result.current.hasMoreNotes).toBe(true));

    await act(async () => {
      await result.current.loadMoreNotes();
    });

    expect(result.current.notes.map((note) => note.id)).toEqual(['note-1', 'note-2']);
  });

  test('loadMoreNotes forwards the keyset cursor from the previous page', async () => {
    vi.mocked(listNotes)
      .mockResolvedValueOnce(notesPage(['note-1'], true, 'cursor-1'))
      .mockResolvedValueOnce(notesPage(['note-2']));

    const { result } = setup({ debouncedQuery: '', showTrash: false });

    await act(async () => {
      await result.current.loadWorkspace();
    });
    await waitFor(() => expect(result.current.hasMoreNotes).toBe(true));

    await act(async () => {
      await result.current.loadMoreNotes();
    });

    expect(vi.mocked(listNotes).mock.calls[1][1]).toMatchObject({ cursor: 'cursor-1' });
  });
});

describe('useNotesWorkspace refreshSilently', () => {
  beforeEach(() => {
    authStore.setSession({ accessToken: 'token', refreshToken: 'refresh', user: { id: 'u1', email: 'u@example.com' } });
    vi.mocked(listNoteStats).mockResolvedValue({ total: 0 });
  });

  afterEach(() => {
    authStore.clear();
    vi.clearAllMocks();
  });

  function setup(initialFilters: WorkspaceFilterState) {
    const reportError = vi.fn();
    const rendered = renderHook(
      ({ filters }: { filters: WorkspaceFilterState }) => useNotesWorkspace({ client, db: fakeDb, filters, reportError }),
      { initialProps: { filters: initialFilters } }
    );
    return { ...rendered, reportError };
  }

  test('合并第一页数据：不触发 loading、不重置分页，未变化的笔记保留引用', async () => {
    const silentPage = deferred<ReturnType<typeof notesPage>>();
    vi.mocked(listNotes)
      .mockResolvedValueOnce(notesPage(['note-1', 'note-2'], true, 'cursor-1'))
      .mockResolvedValueOnce(notesPage(['note-3'], true, 'cursor-2'))
      .mockImplementationOnce(async () => silentPage.promise)
      .mockResolvedValueOnce(notesPage(['note-4']));

    const { result } = setup({ debouncedQuery: '', showTrash: false });
    await act(async () => {
      await result.current.loadWorkspace();
    });
    await act(async () => {
      await result.current.loadMoreNotes();
    });
    expect(result.current.notes.map((note) => note.id)).toEqual(['note-1', 'note-2', 'note-3']);

    const note1Before = result.current.notes.find((note) => note.id === 'note-1');
    const note2Before = result.current.notes.find((note) => note.id === 'note-2');

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refreshSilently();
    });
    // 静默刷新进行中也不进入 loading 态（笔记流不变暗、不闪烁）
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      silentPage.resolve({
        items: [
          apiNote('note-0'),
          apiNote('note-1'),
          apiNote('note-2', { updatedAt: '2026-01-02T00:00:00Z', version: 2 })
        ],
        page: { limit: 20, offset: 0, hasMore: true, nextCursor: 'cursor-0' }
      });
      await pending;
    });

    expect(result.current.isLoading).toBe(false);
    // 分页游标不被第一页结果重置，loadMore 仍从 loadMore 之后的位置继续
    expect(result.current.hasMoreNotes).toBe(true);
    // 新到的插入，已加载的第 2 页保留（不坍缩回首屏）
    expect(result.current.notes.map((note) => note.id)).toEqual(['note-0', 'note-1', 'note-2', 'note-3']);
    // 未变化的笔记保留原对象引用（NoteCard memo 不击穿），变化的才替换
    expect(result.current.notes.find((note) => note.id === 'note-1')).toBe(note1Before);
    expect(result.current.notes.find((note) => note.id === 'note-2')).not.toBe(note2Before);

    await act(async () => {
      await result.current.loadMoreNotes();
    });
    expect(vi.mocked(listNotes).mock.calls[3][1]).toMatchObject({ cursor: 'cursor-2' });
    expect(result.current.notes.map((note) => note.id)).toEqual(['note-0', 'note-1', 'note-2', 'note-3', 'note-4']);
  });

  test('pulledChanges 里远端删除的笔记被精确移除', async () => {
    vi.mocked(listNotes)
      .mockResolvedValueOnce(notesPage(['note-1', 'note-2', 'note-3']))
      .mockResolvedValueOnce(notesPage(['note-1', 'note-2']));

    const { result } = setup({ debouncedQuery: '', showTrash: false });
    await act(async () => {
      await result.current.loadWorkspace();
    });

    const pulled: CachedNote[] = [
      { id: 'note-3', clientId: 'client-note-3', blocks: [], updatedAt: '2026-01-02T00:00:00Z', deletedAt: '2026-01-02T00:00:00Z' },
      { id: 'note-2', clientId: 'client-note-2', blocks: [], updatedAt: '2026-01-02T00:00:00Z', permanentlyDeletedAt: '2026-01-02T00:00:00Z' }
    ];
    await act(async () => {
      await result.current.refreshSilently(pulled);
    });

    expect(result.current.notes.map((note) => note.id)).toEqual(['note-1']);
  });

  test('回收站视图下，pulledChanges 里被恢复的笔记从列表移除', async () => {
    vi.mocked(listNotes)
      .mockResolvedValueOnce(notesPage(['note-1', 'note-2']))
      .mockResolvedValueOnce(notesPage(['note-1']));

    const { result } = setup({ debouncedQuery: '', showTrash: true });
    await act(async () => {
      await result.current.loadWorkspace();
    });

    await act(async () => {
      await result.current.refreshSilently([
        { id: 'note-2', clientId: 'client-note-2', blocks: [], updatedAt: '2026-01-02T00:00:00Z', deletedAt: null }
      ]);
    });

    expect(result.current.notes.map((note) => note.id)).toEqual(['note-1']);
  });

  test('静默刷新失败时保留现有数据且不上报错误', async () => {
    vi.mocked(listNotes)
      .mockResolvedValueOnce(notesPage(['note-1']))
      .mockRejectedValueOnce(new Error('network down'));

    const { result, reportError } = setup({ debouncedQuery: '', showTrash: false });
    await act(async () => {
      await result.current.loadWorkspace();
    });

    await act(async () => {
      await result.current.refreshSilently();
    });

    expect(result.current.notes.map((note) => note.id)).toEqual(['note-1']);
    expect(result.current.isLoading).toBe(false);
    expect(reportError).not.toHaveBeenCalled();
  });
});
