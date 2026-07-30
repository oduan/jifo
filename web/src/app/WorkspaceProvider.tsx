import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { loadMediaObjectUrl, uploadMedia } from '../features/media/api';
import type { Note } from '../features/notes/NoteCard';
import type { NoteBlock } from '../features/notes/NoteEditor';
import { useNotesWorkspace } from '../features/notes/useNotesWorkspace';
import { useWorkspaceView } from '../features/notes/useWorkspaceView';
import { AccessKeySummary, CreateAccessKeyResult, createAccessKey, deleteAccessKey as deleteAccessKeyAPI, listAccessKeys } from '../features/settings/api';
import { pullChanges, pushOutbox } from '../features/sync/api';
import { runSync } from '../features/sync/syncEngine';
import { deleteTag, renameTag } from '../features/tags/api';
import type { TagNode } from '../features/tags/TagTree';
import type { HeatmapCell } from '../features/heatmap/Heatmap';
import { errorMessage } from '../shared/api/errorMessage';
import type { ToastItem } from '../shared/ui/Toast';
import { createJifoDb } from '../storage/db';
import { useAuth } from './AuthProvider';

export type SelectedTag = {
  id: string | null;
  path?: string;
};

// WorkspaceBindings 是 NotesPage 及其子组件从上下文取用的完整数据 + 行为集合。
export type WorkspaceBindings = {
  userName: string;
  notes: Note[];
  tags: TagNode[];
  heatmapCells: HeatmapCell[];
  totalNoteCount?: number;
  searchQuery: string;
  selectedTagId: string | null;
  hasMoreNotes: boolean;
  isLoadingMoreNotes: boolean;
  isLoading: boolean;
  isInitialLoading: boolean;
  trash: boolean;
  toasts: ToastItem[];
  accessKeys: AccessKeySummary[];
  isLoadingAccessKeys: boolean;
  isCreatingAccessKey: boolean;
  settingsError: string | null;
  onSearchChange: (query: string) => void;
  onSelectTag: (tag: SelectedTag) => void;
  onRenameTag: (tagId: string, path: string) => void | Promise<void>;
  onDeleteTag: (tagId: string, deleteNotes: boolean) => void | Promise<void>;
  onLoadMoreNotes: () => void;
  onCreateNote: (blocks: NoteBlock[]) => void | Promise<void>;
  onUpdateNote: (id: string, blocks: NoteBlock[]) => void | Promise<void>;
  onDeleteNote: (id: string) => void | Promise<void>;
  onRestoreNote: (id: string) => void | Promise<void>;
  onSelectTrash: () => void;
  onLogout: () => void;
  onDismissToast: (id: number) => void;
  onLoadAccessKeys: () => void | Promise<void>;
  onCreateAccessKey: (label: string, expiresInDays?: number) => Promise<CreateAccessKeyResult>;
  onDeleteAccessKey: (id: string) => Promise<void>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onUploadImage: (file: File) => Promise<Extract<NoteBlock, { type: 'image' }>>;
  resolveMediaUrl: (mediaId: string) => Promise<string>;
};

const WorkspaceContext = createContext<WorkspaceBindings | null>(null);

// WorkspaceProvider 汇聚工作区数据（笔记/标签/热力图）、视图状态、toast 与所有变更行为，
// 供 NotesPage 及其子组件通过 useWorkspace / useOptionalWorkspace 取用，避免逐层透传大量 props。
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { authState, client, logout, updatePassword } = useAuth();
  const userId = authState.user?.id;
  // 无 user.id 时不创建 Dexie 实例，避免多个未识别会话串写到共享的 'guest' 库。
  const localDb = useMemo(
    () => (userId ? createJifoDb(`jifo-${userId}`) : null),
    [userId]
  );

  const { view, setQuery, selectTag, selectTrash, reset: resetView } = useWorkspaceView();
  const [debouncedNoteQuery, setDebouncedNoteQuery] = useState(view.query);

  const [accessKeys, setAccessKeys] = useState<AccessKeySummary[]>([]);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isLoadingAccessKeys, setLoadingAccessKeys] = useState(false);
  const [isCreatingAccessKey, setCreatingAccessKey] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const loadWorkspaceRef = useRef<() => Promise<void>>(async () => undefined);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((message: string, action?: ToastItem['action']) => {
    setToasts((current) => {
      if (current.some((toast) => toast.message === message)) {
        return current;
      }
      return [...current.slice(-2), { id: ++toastIdRef.current, message, action }];
    });
  }, []);

  const reportError = useCallback((message: string, retryWorkspace: boolean) => {
    pushToast(
      message,
      retryWorkspace ? { label: '重试', onClick: () => void loadWorkspaceRef.current() } : undefined
    );
  }, [pushToast]);

  const filters = useMemo(
    () => ({ debouncedQuery: debouncedNoteQuery, tagPath: view.tagPath, showTrash: view.showTrash }),
    [debouncedNoteQuery, view.tagPath, view.showTrash]
  );

  const workspace = useNotesWorkspace({ client, db: localDb, filters, reportError });
  const { loadWorkspace } = workspace;
  // toast 重试回调通过 ref 调用最新 loadWorkspace，避免陈旧闭包
  useEffect(() => {
    loadWorkspaceRef.current = loadWorkspace;
  }, [loadWorkspace]);

  useEffect(() => () => localDb?.close(), [localDb]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedNoteQuery(view.query), 300);
    return () => window.clearTimeout(timer);
  }, [view.query]);

  const syncNow = useCallback(async () => {
    const db = localDb;
    if (!db) return;
    await runSync({
      db,
      uploadMedia: async ({ localId }) => {
        const cached = await db.media_cache.where('localId').equals(localId).first();
        if (!cached?.blob) throw new Error('local media is unavailable');
        const asset = await uploadMedia(client, new File([cached.blob], localId, { type: cached.blob.type }));
        return { mediaId: asset.id };
      },
      pushOutbox: (operations) => pushOutbox(client, operations),
      pullChanges: (cursor) => pullChanges(client, cursor)
    });
  }, [client, localDb]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  // Provider 仅在已认证时挂载；卸载（登出）时清空 URL 视图参数。
  useEffect(() => () => resetView(), [resetView]);

  useEffect(() => {
    let active = true;
    const synchronize = () => {
      if (!navigator.onLine) return;
      void syncNow().then(async () => {
        if (active) await loadWorkspaceRef.current();
      }).catch(() => undefined);
    };
    synchronize();
    window.addEventListener('online', synchronize);
    const timer = window.setInterval(synchronize, 60_000);
    return () => {
      active = false;
      window.removeEventListener('online', synchronize);
      window.clearInterval(timer);
    };
  }, [syncNow]);

  const loadAccessKeys = useCallback(async () => {
    if (!authState.accessToken) {
      return;
    }
    setLoadingAccessKeys(true);
    setSettingsError(null);
    try {
      setAccessKeys(await listAccessKeys(client));
    } catch (loadError) {
      setSettingsError(errorMessage(loadError));
    } finally {
      setLoadingAccessKeys(false);
    }
  }, [authState.accessToken, client]);

  const createNewAccessKey = useCallback(
    async (label: string, expiresInDays?: number): Promise<CreateAccessKeyResult> => {
      setCreatingAccessKey(true);
      setSettingsError(null);
      try {
        const result = await createAccessKey(client, label, expiresInDays);
        setAccessKeys((current) => [result.item, ...current]);
        return result;
      } catch (createError) {
        setSettingsError(errorMessage(createError));
        throw createError;
      } finally {
        setCreatingAccessKey(false);
      }
    },
    [client]
  );

  const deleteExistingAccessKey = useCallback(
    async (id: string): Promise<void> => {
      setSettingsError(null);
      try {
        await deleteAccessKeyAPI(client, id);
        setAccessKeys((current) => current.filter((item) => item.id !== id));
      } catch (deleteError) {
        setSettingsError(errorMessage(deleteError));
        throw deleteError;
      }
    },
    [client]
  );

  const uploadImage = useCallback(async (file: File): Promise<Extract<NoteBlock, { type: 'image' }>> => {
    const asset = await uploadMedia(client, file);
    return { type: 'image', mediaId: asset.id, url: URL.createObjectURL(file), alt: file.name };
  }, [client]);

  const resolveMediaUrl = useCallback((mediaId: string) => loadMediaObjectUrl(client, mediaId), [client]);

  const restoreNoteById = useCallback((id: string) => void workspace.restoreNote(id), [workspace]);

  const handleCreateNote = useCallback(
    async (blocks: NoteBlock[]) => {
      try {
        await workspace.createNote(blocks);
      } catch (mutationError) {
        pushToast(`${errorMessage(mutationError)}（内容已保留在编辑器中）`);
        throw mutationError;
      }
    },
    [pushToast, workspace]
  );

  const handleUpdateNote = useCallback(
    async (id: string, blocks: NoteBlock[]) => {
      try {
        await workspace.updateNote(id, blocks);
      } catch (mutationError) {
        pushToast(`${errorMessage(mutationError)}（内容已保留在编辑器中）`);
        throw mutationError;
      }
    },
    [pushToast, workspace]
  );

  const handleDeleteNote = useCallback(
    async (id: string) => {
      const deleted = await workspace.deleteNote(id);
      if (deleted) {
        pushToast('已移入回收站', { label: '撤销', onClick: () => void workspace.restoreNote(id, deleted) });
      }
    },
    [pushToast, workspace]
  );

  const runTagMutation = useCallback(
    async (operation: () => Promise<void>) => {
      try {
        await operation();
        selectTag(null);
        await loadWorkspace();
      } catch (tagError) {
        reportError(errorMessage(tagError), false);
        throw tagError;
      }
    },
    [loadWorkspace, reportError, selectTag]
  );

  const onSelectTag = useCallback((tag: SelectedTag) => selectTag(tag.id, tag.id ? tag.path : undefined), [selectTag]);
  const onRenameTag = useCallback((tagId: string, path: string) => runTagMutation(() => renameTag(client, tagId, path)), [client, runTagMutation]);
  const onDeleteTag = useCallback((tagId: string, deleteNotes: boolean) => runTagMutation(() => deleteTag(client, tagId, deleteNotes)), [client, runTagMutation]);
  const onLoadMoreNotes = useCallback(() => void workspace.loadMoreNotes(), [workspace]);
  const onDeleteNote = useCallback((id: string) => void handleDeleteNote(id), [handleDeleteNote]);
  const onLogout = useCallback(() => void logout(), [logout]);

  const userName = authState.user?.username || authState.user?.email || 'Jifo 用户';

  const value = useMemo<WorkspaceBindings>(
    () => ({
      userName,
      notes: workspace.notes,
      tags: workspace.tags,
      heatmapCells: workspace.heatmapCells,
      totalNoteCount: workspace.totalNoteCount,
      searchQuery: view.query,
      selectedTagId: view.tagId,
      hasMoreNotes: workspace.hasMoreNotes,
      isLoadingMoreNotes: workspace.isLoadingMoreNotes,
      isLoading: workspace.isLoading,
      isInitialLoading: !workspace.hasWorkspaceLoaded,
      trash: view.showTrash,
      toasts,
      accessKeys,
      isLoadingAccessKeys,
      isCreatingAccessKey,
      settingsError,
      onSearchChange: setQuery,
      onSelectTag,
      onRenameTag,
      onDeleteTag,
      onLoadMoreNotes,
      onCreateNote: handleCreateNote,
      onUpdateNote: handleUpdateNote,
      onDeleteNote,
      onRestoreNote: restoreNoteById,
      onSelectTrash: selectTrash,
      onLogout,
      onDismissToast: dismissToast,
      onLoadAccessKeys: loadAccessKeys,
      onCreateAccessKey: createNewAccessKey,
      onDeleteAccessKey: deleteExistingAccessKey,
      onChangePassword: updatePassword,
      onUploadImage: uploadImage,
      resolveMediaUrl
    }),
    [
      userName,
      workspace.notes,
      workspace.tags,
      workspace.heatmapCells,
      workspace.totalNoteCount,
      workspace.hasMoreNotes,
      workspace.isLoadingMoreNotes,
      workspace.isLoading,
      workspace.hasWorkspaceLoaded,
      view.query,
      view.tagId,
      view.showTrash,
      toasts,
      accessKeys,
      isLoadingAccessKeys,
      isCreatingAccessKey,
      settingsError,
      setQuery,
      onSelectTag,
      onRenameTag,
      onDeleteTag,
      onLoadMoreNotes,
      handleCreateNote,
      handleUpdateNote,
      onDeleteNote,
      restoreNoteById,
      selectTrash,
      onLogout,
      dismissToast,
      loadAccessKeys,
      createNewAccessKey,
      deleteExistingAccessKey,
      updatePassword,
      uploadImage,
      resolveMediaUrl
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceBindings {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error('useWorkspace 必须在 WorkspaceProvider 内使用');
  }
  return value;
}

// 供既可独立传 props、又可在 Provider 下取上下文的组件使用（props 优先，上下文兜底）。
export function useOptionalWorkspace(): WorkspaceBindings | null {
  return useContext(WorkspaceContext);
}
