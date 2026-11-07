import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { loadMediaObjectUrl, uploadMedia } from '../features/media/api';
import { loadLocalMediaObjectUrl, uploadImageBlock } from '../features/media/localMedia';
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
import { CachedNote, createJifoDb } from '../storage/db';
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
  // 默认仅登出并保留本地缓存;显式传 clearLocalData 时先删除本浏览器上
  // 该用户的 IndexedDB 笔记缓存(需调用方先行确认)。
  onLogout: (options?: { clearLocalData?: boolean }) => void | Promise<void>;
  onDismissToast: (id: number) => void;
  onLoadAccessKeys: () => void | Promise<void>;
  onCreateAccessKey: (label: string, expiresInDays?: number) => Promise<CreateAccessKeyResult>;
  onDeleteAccessKey: (id: string) => Promise<void>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onUploadImage: (file: File) => Promise<Extract<NoteBlock, { type: 'image' }>>;
  resolveMediaUrl: (mediaId: string) => Promise<string>;
  // 离线粘贴图片(localId 块)时从 media_cache 读回本地 blob 生成 object URL。
  resolveLocalMediaUrl: (localId: string) => Promise<string>;
};

const WorkspaceContext = createContext<WorkspaceBindings | null>(null);

// 周期同步失败可见性：单次失败不打扰；连续失败达到阈值才提示一次
// 「同步失败,改动暂存本地」，恢复成功后重置计数并提示恢复。
const SYNC_FAILURE_TOAST_THRESHOLD = 3;

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
  // 周期同步的连续失败计数（成功即清零），见 SYNC_FAILURE_TOAST_THRESHOLD。
  const syncFailureCountRef = useRef(0);
  const loadWorkspaceRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshSilentlyRef = useRef<(pulledChanges?: CachedNote[]) => Promise<void>>(async () => undefined);

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
  const { loadWorkspace, refreshSilently } = workspace;
  // toast 重试回调通过 ref 调用最新 loadWorkspace，避免陈旧闭包
  useEffect(() => {
    loadWorkspaceRef.current = loadWorkspace;
  }, [loadWorkspace]);
  // 定时同步回调通过 ref 调用最新 refreshSilently，避免重置 60s 定时器
  useEffect(() => {
    refreshSilentlyRef.current = refreshSilently;
  }, [refreshSilently]);

  useEffect(() => () => localDb?.close(), [localDb]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedNoteQuery(view.query), 300);
    return () => window.clearTimeout(timer);
  }, [view.query]);

  const syncNow = useCallback(async (): Promise<CachedNote[] | undefined> => {
    const db = localDb;
    if (!db) return undefined;
    return runSync({
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
      // 周期同步走静默刷新：不闪烁、不动分页与滚动位置。失败不再全静默：
      // syncNow（push/pull）与 refreshSilently（工作区刷新，失败沿 then 链抛到这里）
      // 都汇聚到同一个连续失败计数，达到阈值提示一次，成功后重置并提示恢复。
      void syncNow().then(async (pulledChanges) => {
        // syncNow 返回 undefined 说明本轮被跳过（并发同步/锁冲突）：既不算成功
        // 也不算失败，不动失败计数，也不与正在写库的同步并发刷新工作区。
        if (pulledChanges === undefined) {
          return;
        }
        if (active) await refreshSilentlyRef.current(pulledChanges);
        if (syncFailureCountRef.current >= SYNC_FAILURE_TOAST_THRESHOLD) {
          pushToast('同步已恢复');
        }
        syncFailureCountRef.current = 0;
      }).catch(() => {
        syncFailureCountRef.current += 1;
        // 达到阈值才提示一次（长故障期间不重复轰炸；pushToast 会对同文案去重）
        if (syncFailureCountRef.current === SYNC_FAILURE_TOAST_THRESHOLD) {
          pushToast('同步失败,改动暂存本地');
        }
      });
    };
    synchronize();
    window.addEventListener('online', synchronize);
    const timer = window.setInterval(synchronize, 60_000);
    return () => {
      active = false;
      window.removeEventListener('online', synchronize);
      window.clearInterval(timer);
    };
  }, [syncNow, pushToast]);

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

  // 粘贴图片:在线即传即用;断网或上传因网络故障失败时降级为 media_cache 本地
  // 缓存(local_pending),返回 localId 图片块,由同步引擎恢复联网后补传。
  const uploadImage = useCallback(
    (file: File) => uploadImageBlock({ client, db: localDb, file }),
    [client, localDb]
  );

  const resolveMediaUrl = useCallback((mediaId: string) => loadMediaObjectUrl(client, mediaId), [client]);

  const resolveLocalMediaUrl = useCallback(
    async (localId: string) => {
      if (!localDb) throw new Error('local media is unavailable');
      return loadLocalMediaObjectUrl(localDb, localId);
    },
    [localDb]
  );

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
  // 登出:默认仅清会话、保留本地缓存(默认动作是保留);显式 clearLocalData 时先删除
  // 本浏览器上该用户的 IndexedDB 库(jifo-<userId>,含全部笔记缓存与离线草稿),
  // 服务器数据不受影响。删除失败不阻断登出,但如实提示缓存仍在。
  const onLogout = useCallback(
    async (options?: { clearLocalData?: boolean }) => {
      if (options?.clearLocalData && localDb) {
        try {
          await localDb.delete();
        } catch {
          pushToast('本地数据清除失败,该浏览器上的笔记缓存已保留');
        }
      }
      await logout();
    },
    [localDb, logout, pushToast]
  );

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
      resolveMediaUrl,
      resolveLocalMediaUrl
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
      resolveMediaUrl,
      resolveLocalMediaUrl
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
