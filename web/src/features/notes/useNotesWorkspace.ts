import { useCallback, useMemo, useRef, useState } from 'react';

import { HeatmapCell } from '../heatmap/Heatmap';
import { loadHeatmap } from '../heatmap/api';
import { ApiClient, ApiError } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errorMessage';
import { JifoDb } from '../../storage/db';
import { authStore } from '../auth/authStore';
import { listTagTree } from '../tags/api';
import { TagNode } from '../tags/TagTree';
import { fromApiNote, listNoteStats, listNotes } from './api';
import { Note } from './NoteCard';
import { NoteBlock } from './NoteEditor';
import { cachedPlainText, createNotesRepository, fromCachedNote } from './notesRepository';

const NOTES_PAGE_SIZE = 20;

export type WorkspaceFilterState = {
  debouncedQuery: string;
  tagPath?: string;
  showTrash: boolean;
};

type UseNotesWorkspaceInput = {
  client: ApiClient;
  db: JifoDb | null;
  filters: WorkspaceFilterState;
  reportError: (message: string, retryWorkspace: boolean) => void;
};

export function useNotesWorkspace({ client, db, filters, reportError }: UseNotesWorkspaceInput) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<TagNode[]>([]);
  const [heatmapCells, setHeatmapCells] = useState<HeatmapCell[]>([]);
  const [totalNoteCount, setTotalNoteCount] = useState(0);
  const [isLoading, setLoading] = useState(false);
  const [hasWorkspaceLoaded, setHasWorkspaceLoaded] = useState(false);
  const [hasMoreNotes, setHasMoreNotes] = useState(false);
  const [isLoadingMoreNotes, setLoadingMoreNotes] = useState(false);

  const repository = useMemo(() => createNotesRepository({ client, db }), [client, db]);

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const tagsRef = useRef(tags);
  tagsRef.current = tags;
  const showTrashRef = useRef(filters.showTrash);
  showTrashRef.current = filters.showTrash;
  // Monotonic sequence: stale responses (superseded by a newer loadWorkspace
  // call) are discarded instead of clobbering fresher state.
  const requestSeqRef = useRef(0);
  // Key of the in-flight loadWorkspace, used to skip duplicate timer-triggered
  // calls with identical filters while one is already running.
  const inFlightKeyRef = useRef<string | null>(null);
  // Keyset 分页游标：loadWorkspace 取首页后记录，loadMoreNotes 携带它翻页。
  const nextCursorRef = useRef<string | undefined>(undefined);

  const { debouncedQuery, tagPath, showTrash } = filters;

  const baseListOptions = useCallback(
    () => ({
      search: debouncedQuery,
      tagPath,
      trash: showTrash,
      limit: NOTES_PAGE_SIZE
    }),
    [debouncedQuery, tagPath, showTrash]
  );

  const loadWorkspace = useCallback(async () => {
    if (!authStore.getAccessToken()) {
      return;
    }

    const requestKey = JSON.stringify({ debouncedQuery, tagPath, showTrash });
    if (inFlightKeyRef.current === requestKey) {
      return;
    }
    const seq = ++requestSeqRef.current;
    inFlightKeyRef.current = requestKey;

    setLoading(true);
    try {
      const nextTags = await listTagTree(client);
      const [nextNotes, nextStats, nextHeatmap] = await Promise.all([listNotes(client, baseListOptions()), listNoteStats(client), loadHeatmap(client)]);
      if (seq !== requestSeqRef.current) {
        return;
      }
      if (db) {
        await db.notes_cache.bulkPut(nextNotes.items.map((note) => ({
          id: note.id,
          clientId: note.clientId,
          blocks: fromApiNote(note, nextTags).blocks,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          deletedAt: note.deletedAt,
          version: note.version
        })));
      }
      if (seq !== requestSeqRef.current) {
        return;
      }
      setTags(nextTags);
      setNotes(nextNotes.items.map((note) => fromApiNote(note, nextTags)));
      setTotalNoteCount(nextStats.total);
      setHasMoreNotes(nextNotes.page.hasMore);
      nextCursorRef.current = nextNotes.page.nextCursor;
      setHeatmapCells(nextHeatmap);
    } catch (loadError) {
      if (seq !== requestSeqRef.current) {
        return;
      }
      reportError(errorMessage(loadError), true);
      if (!db) {
        if (loadError instanceof ApiError && loadError.status === 401 && !authStore.getState().refreshToken) {
          authStore.clear();
        }
        return;
      }
      const cached = await db.notes_cache.toArray();
      const query = debouncedQuery.trim().toLocaleLowerCase();
      setNotes(cached
        .filter((note) => showTrash ? Boolean(note.deletedAt) && !note.permanentlyDeletedAt : !note.deletedAt && !note.permanentlyDeletedAt)
        .filter((note) => !query || cachedPlainText(note).toLocaleLowerCase().includes(query))
        .filter((note) => !tagPath || cachedPlainText(note).includes(`#${tagPath}`))
        .map(fromCachedNote));
      if (loadError instanceof ApiError && loadError.status === 401 && !authStore.getState().refreshToken) {
        authStore.clear();
      }
    } finally {
      if (inFlightKeyRef.current === requestKey) {
        inFlightKeyRef.current = null;
      }
      if (seq === requestSeqRef.current) {
        setLoading(false);
        setHasWorkspaceLoaded(true);
      }
    }
  }, [client, db, debouncedQuery, baseListOptions, reportError, showTrash, tagPath]);

  const loadMoreNotes = useCallback(async () => {
    if (!authStore.getAccessToken() || isLoading || isLoadingMoreNotes || !hasMoreNotes) {
      return;
    }

    setLoadingMoreNotes(true);
    try {
      const next = await listNotes(client, { ...baseListOptions(), cursor: nextCursorRef.current });
      const currentTags = tagsRef.current;
      if (db) {
        await db.notes_cache.bulkPut(next.items.map((note) => ({
          id: note.id,
          clientId: note.clientId,
          blocks: fromApiNote(note, currentTags).blocks,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          deletedAt: note.deletedAt,
          version: note.version
        })));
      }
      setNotes((current) => {
        const existingIds = new Set(current.map((note) => note.id));
        const appended = next.items
          .filter((note) => !existingIds.has(note.id))
          .map((note) => fromApiNote(note, currentTags));
        return [...current, ...appended];
      });
      setHasMoreNotes(next.page.hasMore);
      nextCursorRef.current = next.page.nextCursor;
    } catch (loadError) {
      reportError(errorMessage(loadError), true);
    } finally {
      setLoadingMoreNotes(false);
    }
  }, [client, db, hasMoreNotes, isLoading, isLoadingMoreNotes, baseListOptions, reportError]);

  // 静默刷新侧栏元数据（标签树 / 统计 / 热力图），不触碰笔记列表与分页
  const refreshMeta = useCallback(async () => {
    try {
      const [nextTags, nextStats, nextHeatmap] = await Promise.all([listTagTree(client), listNoteStats(client), loadHeatmap(client)]);
      setTags(nextTags);
      setTotalNoteCount(nextStats.total);
      setHeatmapCells(nextHeatmap);
    } catch {
      // 离线或瞬时失败：保留现有侧栏数据，等下一次同步/加载修正
    }
  }, [client]);

  const createNote = useCallback(
    async (blocks: NoteBlock[]) => {
      // 失败时向上抛错，由调用方决定如何提示并保留编辑器内容
      const note = await repository.create(blocks, tagsRef.current);
      setNotes((current) => [note, ...current]);
      setTotalNoteCount((count) => count + 1);
      void refreshMeta();
    },
    [refreshMeta, repository]
  );

  const updateNote = useCallback(
    async (id: string, blocks: NoteBlock[]) => {
      const current = notesRef.current.find((note) => note.id === id);
      if (!current) {
        return;
      }
      const updated = await repository.update(id, blocks, current, tagsRef.current);
      setNotes((existing) => existing.map((note) => (note.id === id ? updated : note)));
      void refreshMeta();
    },
    [refreshMeta, repository]
  );

  const deleteNote = useCallback(
    async (id: string): Promise<Note | undefined> => {
      const current = notesRef.current.find((note) => note.id === id);
      if (!current) {
        return undefined;
      }
      try {
        await repository.remove(id, current);
        setNotes((existing) => existing.filter((note) => note.id !== id));
        setTotalNoteCount((count) => Math.max(0, count - 1));
        void refreshMeta();
        return current;
      } catch (mutationError) {
        reportError(errorMessage(mutationError), false);
        return undefined;
      }
    },
    [refreshMeta, reportError, repository]
  );

  const restoreNote = useCallback(
    async (id: string, fallback?: Note) => {
      const current = notesRef.current.find((note) => note.id === id) ?? fallback;
      if (!current) {
        return;
      }
      try {
        const restored = await repository.restore(id, current, tagsRef.current);
        setNotes((existing) => {
          const without = existing.filter((note) => note.id !== id);
          return showTrashRef.current ? without : [restored, ...without];
        });
        setTotalNoteCount((count) => count + 1);
        void refreshMeta();
      } catch (mutationError) {
        reportError(errorMessage(mutationError), false);
      }
    },
    [refreshMeta, reportError, repository]
  );

  const reset = useCallback(() => {
    setNotes([]);
    setTags([]);
    setHeatmapCells([]);
    setTotalNoteCount(0);
    setLoading(false);
    setHasWorkspaceLoaded(false);
    setHasMoreNotes(false);
    setLoadingMoreNotes(false);
    nextCursorRef.current = undefined;
  }, []);

  return {
    notes,
    tags,
    heatmapCells,
    totalNoteCount,
    isLoading,
    hasWorkspaceLoaded,
    hasMoreNotes,
    isLoadingMoreNotes,
    loadWorkspace,
    loadMoreNotes,
    createNote,
    updateNote,
    deleteNote,
    restoreNote,
    reset
  };
}

