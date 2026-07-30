import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { ApiClient } from '../../shared/api/client';
import { JifoDb } from '../../storage/db';
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

function apiNote(id: string): ApiNoteItem {
  return {
    id,
    clientId: `client-${id}`,
    content: { blocks: [{ type: 'paragraph', text: id }] },
    plainText: id,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 1
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
