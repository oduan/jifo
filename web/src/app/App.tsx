import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { LoginPage, LoginPayload, LoginResult } from '../features/auth/LoginPage';
import { logoutAuth, refreshAuth, submitAuth } from '../features/auth/api';
import { authStore } from '../features/auth/authStore';
import { loadHeatmap } from '../features/heatmap/api';
import { HeatmapCell } from '../features/heatmap/Heatmap';
import { loadMediaObjectUrl, uploadMedia } from '../features/media/api';
import { createNote, deleteNote, fromApiNote, listNoteStats, listNotes, restoreNote, updateNote } from '../features/notes/api';
import { AccessKeySummary, changePassword, createAccessKey, CreateAccessKeyResult, deleteAccessKey as deleteAccessKeyAPI, listAccessKeys } from '../features/settings/api';
import { Note } from '../features/notes/NoteCard';
import { NoteBlock } from '../features/notes/NoteEditor';
import { NotesPage } from '../features/notes/NotesPage';
import { deleteTag, listTagTree, renameTag } from '../features/tags/api';
import { TagNode } from '../features/tags/TagTree';
import { ApiError, createApiClient } from '../shared/api/client';
import { ToastItem } from '../shared/ui/Toast';
import { CachedNote, CachedNoteBlock, createJifoDb } from '../storage/db';
import { pullChanges, pushOutbox } from '../features/sync/api';
import { runSync } from '../features/sync/syncEngine';
import { createOfflineNote, deleteNoteOutboxOperation, restoreNoteOutboxOperation, updateNoteOutboxOperation } from '../features/sync/outbox';

const NOTES_PAGE_SIZE = 20;
const ACCESS_TOKEN_RENEWAL_THRESHOLD_MS = 2 * 60 * 1000;
const ACCESS_TOKEN_RENEWAL_CHECK_MS = 30 * 1000;

function useAuthState() {
  return useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);
}

function apiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL ?? '/api';
}

function secondsUntilJwtExpiry(token: string | null, now = Date.now()): number | null {
  if (!token) {
    return null;
  }
  const [, payload] = token.split('.');
  if (!payload) {
    return null;
  }
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof decoded.exp === 'number' ? decoded.exp - Math.floor(now / 1000) : null;
  } catch {
    return null;
  }
}

function shouldRenewAccessToken(token: string | null, thresholdMs = ACCESS_TOKEN_RENEWAL_THRESHOLD_MS) {
  const secondsLeft = secondsUntilJwtExpiry(token);
  return secondsLeft !== null && secondsLeft * 1000 <= thresholdMs;
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return '登录已失效，请重新登录。';
    }
    return `请求失败（${error.status}），请稍后重试。`;
  }
  return error instanceof Error ? error.message : '请求失败，请稍后重试。';
}

function newLocalId(prefix: string) {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function toCachedBlocks(blocks: NoteBlock[]): CachedNoteBlock[] {
  return blocks.map((block) => block.type === 'paragraph' ? { type: 'paragraph', content: block.content } : { type: 'image', url: block.url, mediaId: block.mediaId, alt: block.alt });
}

function fromCachedNote(note: CachedNote): Note {
  return {
    id: note.id,
    clientId: note.clientId,
    createdAt: note.createdAt ?? note.updatedAt,
    updatedAt: note.updatedAt,
    version: note.version,
    deletedAt: note.deletedAt,
    blocks: note.blocks,
    tagIds: []
  };
}

function isNetworkFailure(error: unknown) {
  return error instanceof TypeError;
}

function cachedPlainText(note: CachedNote) {
  return note.blocks.filter((block): block is Extract<CachedNoteBlock, { type: 'paragraph' }> => block.type === 'paragraph').map((block) => block.content).join('\n\n');
}

type AppErrorState = {
  message: string;
  retryWorkspace: boolean;
};

export function App() {
  const authState = useAuthState();
  const accessToken = authState.accessToken;
  const localDb = useMemo(() => createJifoDb(`jifo-${authState.user?.id ?? 'guest'}`), [authState.user?.id]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [totalNoteCount, setTotalNoteCount] = useState(0);
  const [tags, setTags] = useState<TagNode[]>([]);
  const [heatmapCells, setHeatmapCells] = useState<HeatmapCell[]>([]);
  const [accessKeys, setAccessKeys] = useState<AccessKeySummary[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [isMutating, setMutating] = useState(false);
  const [error, setError] = useState<AppErrorState | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isLoadingAccessKeys, setLoadingAccessKeys] = useState(false);
  const [isCreatingAccessKey, setCreatingAccessKey] = useState(false);
  const [noteQuery, setNoteQuery] = useState('');
  const [debouncedNoteQuery, setDebouncedNoteQuery] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedTagPath, setSelectedTagPath] = useState<string | undefined>();
  const [hasMoreNotes, setHasMoreNotes] = useState(false);
  const [isLoadingMoreNotes, setLoadingMoreNotes] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

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
    setError((current) => {
      if (current?.message === message && current.retryWorkspace === retryWorkspace) {
        return current;
      }
      return { message, retryWorkspace };
    });
  }, []);

  const authApi = useMemo(() => {
    const baseUrl = apiBaseUrl();
    const refreshClient = createApiClient({
      baseUrl,
      getAccessToken: () => null
    });
    let refreshInFlight: Promise<string | null> | null = null;

    const refreshSession = () => {
      if (refreshInFlight) {
        return refreshInFlight;
      }

      refreshInFlight = (async () => {
        const current = authStore.getState();
        if (!current.refreshToken) {
          return null;
        }

        try {
          const refreshed = await refreshAuth(refreshClient, current.refreshToken);
          authStore.setSession({
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? null,
            user: refreshed.user ?? current.user ?? null
          });
          return refreshed.accessToken;
        } catch (refreshError) {
          if (refreshError instanceof ApiError && refreshError.status === 401) {
            authStore.clear();
          }
          return null;
        } finally {
          refreshInFlight = null;
        }
      })();

      return refreshInFlight;
    };

    const client = createApiClient({
      baseUrl,
      getAccessToken: authStore.getAccessToken,
      refreshAccessToken: refreshSession
    });

    return { client, refreshSession };
  }, []);
  const client = authApi.client;

  useEffect(() => () => localDb.close(), [localDb]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedNoteQuery(noteQuery), 300);
    return () => window.clearTimeout(timer);
  }, [noteQuery]);

  useEffect(() => {
    if (!accessToken || !authStore.getState().refreshToken) {
      return;
    }

    const renewIfNeeded = () => {
      const current = authStore.getState();
      if (current.accessToken && current.refreshToken && shouldRenewAccessToken(current.accessToken)) {
        void authApi.refreshSession();
      }
    };

    renewIfNeeded();
    const timer = window.setInterval(renewIfNeeded, ACCESS_TOKEN_RENEWAL_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [accessToken, authApi]);

  const noteListOptions = useCallback(
    (offset: number) => ({
      search: debouncedNoteQuery,
      tagPath: selectedTagPath,
      trash: showTrash,
      limit: NOTES_PAGE_SIZE,
      offset
    }),
    [debouncedNoteQuery, selectedTagPath, showTrash]
  );

  const loadWorkspace = useCallback(async () => {
    if (!authStore.getAccessToken()) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextTags = await listTagTree(client);
      const [nextNotes, nextStats, nextHeatmap] = await Promise.all([listNotes(client, noteListOptions(0)), listNoteStats(client), loadHeatmap(client)]);
      await localDb.notes_cache.bulkPut(nextNotes.items.map((note) => ({
        id: note.id,
        clientId: note.clientId,
        blocks: fromApiNote(note, nextTags).blocks,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        deletedAt: note.deletedAt,
        version: note.version
      })));
      setTags(nextTags);
      setNotes(nextNotes.items.map((note) => fromApiNote(note, nextTags)));
      setTotalNoteCount(nextStats.total);
      setHasMoreNotes(nextNotes.page.hasMore);
      setHeatmapCells(nextHeatmap);
    } catch (loadError) {
      const message = errorMessage(loadError);
      reportError(message, true);
      const cached = await localDb.notes_cache.toArray();
      const query = debouncedNoteQuery.trim().toLocaleLowerCase();
      setNotes(cached
        .filter((note) => showTrash ? Boolean(note.deletedAt) && !note.permanentlyDeletedAt : !note.deletedAt && !note.permanentlyDeletedAt)
        .filter((note) => !query || cachedPlainText(note).toLocaleLowerCase().includes(query))
        .filter((note) => !selectedTagPath || cachedPlainText(note).includes(`#${selectedTagPath}`))
        .map(fromCachedNote));
      if (loadError instanceof ApiError && loadError.status === 401 && !authStore.getState().refreshToken) {
        authStore.clear();
      }
    } finally {
      setLoading(false);
    }
  }, [client, debouncedNoteQuery, localDb, noteListOptions, reportError, selectedTagPath, showTrash]);

  useEffect(() => {
    if (!error) {
      return;
    }
    pushToast(
      error.message,
      error.retryWorkspace
        ? {
            label: '重试',
            onClick: () => void loadWorkspace()
          }
        : undefined
    );
    setError(null);
  }, [error, loadWorkspace, pushToast]);

  const syncNow = useCallback(async () => {
    await runSync({
      db: localDb,
      uploadMedia: async ({ localId }) => {
        const cached = await localDb.media_cache.where('localId').equals(localId).first();
        if (!cached?.blob) throw new Error('local media is unavailable');
        const asset = await uploadMedia(client, new File([cached.blob], localId, { type: cached.blob.type }));
        return { mediaId: asset.id };
      },
      pushOutbox: (operations) => pushOutbox(client, operations),
      pullChanges: (cursor) => pullChanges(client, cursor)
    });
  }, [client, localDb]);

  useEffect(() => {
    if (accessToken) {
      void loadWorkspace();
    } else {
      setNotes([]);
      setTotalNoteCount(0);
      setTags([]);
      setHeatmapCells([]);
      setAccessKeys([]);
      setError(null);
      setSettingsError(null);
      setNoteQuery('');
      setDebouncedNoteQuery('');
      setSelectedTagId(null);
      setSelectedTagPath(undefined);
      setHasMoreNotes(false);
      setLoadingMoreNotes(false);
      setShowTrash(false);
    }
  }, [accessToken, loadWorkspace]);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const synchronize = () => {
      if (!navigator.onLine) return;
      void syncNow().then(async () => {
        if (active) await loadWorkspace();
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
  }, [accessToken, loadWorkspace, syncNow]);

  const submitLogin = useCallback(
    async (payload: LoginPayload): Promise<LoginResult> => {
      return submitAuth(client, payload);
    },
    [client]
  );

  const loadAccessKeys = useCallback(async () => {
    if (!authStore.getAccessToken()) {
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
  }, [client]);

  const createNewAccessKey = useCallback(
    async (label: string): Promise<CreateAccessKeyResult> => {
      setCreatingAccessKey(true);
      setSettingsError(null);
      try {
        const result = await createAccessKey(client, label);
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

  const logout = useCallback(async () => {
    try {
      await logoutAuth(client);
    } finally {
      authStore.clear();
    }
  }, [client]);

  const updatePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await changePassword(client, currentPassword, newPassword);
      authStore.clear();
    },
    [client]
  );

  const uploadImage = useCallback(async (file: File): Promise<Extract<NoteBlock, { type: 'image' }>> => {
    const asset = await uploadMedia(client, file);
    return { type: 'image', mediaId: asset.id, url: URL.createObjectURL(file), alt: file.name };
  }, [client]);

  const resolveMediaUrl = useCallback((mediaId: string) => loadMediaObjectUrl(client, mediaId), [client]);

  const withMutation = useCallback(
    async (operation: () => Promise<void>) => {
      setMutating(true);
      setError(null);
      try {
        await operation();
        await loadWorkspace();
      } catch (mutationError) {
        reportError(errorMessage(mutationError), false);
      } finally {
        setMutating(false);
      }
    },
    [loadWorkspace, reportError]
  );

  const restoreNoteById = useCallback(
    (id: string) =>
      withMutation(async () => {
        const pendingDeletes = await localDb.outbox
          .filter((operation) => operation.entity === 'note' && operation.noteId === id && operation.action === 'delete' && operation.status === 'pending')
          .toArray();
        if (pendingDeletes.length > 0) {
          const restoredAt = new Date().toISOString();
          await localDb.transaction('rw', localDb.notes_cache, localDb.outbox, async () => {
            await localDb.notes_cache.update(id, { deletedAt: null, updatedAt: restoredAt });
            for (const operation of pendingDeletes) {
              if (operation.localSeq !== undefined) {
                await localDb.outbox.delete(operation.localSeq);
              }
            }
          });
          return;
        }

        try {
          await restoreNote(client, id);
        } catch (restoreError) {
          if (!isNetworkFailure(restoreError)) throw restoreError;
          const current = notes.find((note) => note.id === id);
          if (!current) throw restoreError;
          const blocks = toCachedBlocks(current.blocks);
          const operation = restoreNoteOutboxOperation({ noteId: id, clientId: current.clientId, baseVersion: current.version, blocks });
          await localDb.transaction('rw', localDb.notes_cache, localDb.outbox, async () => {
            await localDb.notes_cache.update(id, { deletedAt: null, updatedAt: new Date().toISOString(), blocks });
            await localDb.outbox.add(operation);
          });
        }
      }),
    [client, localDb, notes, withMutation]
  );

  const loadMoreNotes = useCallback(async () => {
    if (!authStore.getAccessToken() || isLoading || isLoadingMoreNotes || !hasMoreNotes) {
      return;
    }

    setLoadingMoreNotes(true);
    setError(null);
    try {
      const next = await listNotes(client, noteListOptions(notes.length));
      await localDb.notes_cache.bulkPut(next.items.map((note) => ({
        id: note.id,
        clientId: note.clientId,
        blocks: fromApiNote(note, tags).blocks,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        deletedAt: note.deletedAt,
        version: note.version
      })));
      setNotes((current) => [...current, ...next.items.map((note) => fromApiNote(note, tags))]);
      setHasMoreNotes(next.page.hasMore);
    } catch (loadError) {
      reportError(errorMessage(loadError), true);
    } finally {
      setLoadingMoreNotes(false);
    }
  }, [client, hasMoreNotes, isLoading, isLoadingMoreNotes, localDb, noteListOptions, notes.length, reportError, tags]);

  if (!accessToken) {
    return (
      <LoginPage
        onSubmit={submitLogin}
        onSuccess={(result) => {
          authStore.setSession({ accessToken: result.accessToken, refreshToken: result.refreshToken ?? null, user: result.user ?? null });
        }}
      />
    );
  }

  const userName = authState.user?.username || authState.user?.email || 'Jifo 用户';

  return (
    <NotesPage
      userName={userName}
      notes={notes}
      tags={tags}
      heatmapCells={heatmapCells}
      totalNoteCount={totalNoteCount}
      searchQuery={noteQuery}
      selectedTagId={selectedTagId}
      hasMoreNotes={hasMoreNotes}
      isLoadingMoreNotes={isLoadingMoreNotes}
      isLoading={isLoading}
      toasts={toasts}
      onDismissToast={dismissToast}
      onSearchChange={setNoteQuery}
      onSelectTag={(tag) => {
        setShowTrash(false);
        setSelectedTagId(tag.id);
        setSelectedTagPath(tag.id ? tag.path : undefined);
      }}
      onRenameTag={async (tagId, path) => {
        setMutating(true);
        setError(null);
        try {
          await renameTag(client, tagId, path);
          setSelectedTagId(null);
          setSelectedTagPath(undefined);
          await loadWorkspace();
        } catch (tagError) {
          reportError(errorMessage(tagError), false);
          throw tagError;
        } finally {
          setMutating(false);
        }
      }}
      onDeleteTag={async (tagId, deleteNotes) => {
        setMutating(true);
        setError(null);
        try {
          await deleteTag(client, tagId, deleteNotes);
          setSelectedTagId(null);
          setSelectedTagPath(undefined);
          await loadWorkspace();
        } catch (tagError) {
          reportError(errorMessage(tagError), false);
          throw tagError;
        } finally {
          setMutating(false);
        }
      }}
      onLoadMoreNotes={() => void loadMoreNotes()}
      trash={showTrash}
      onSelectTrash={() => {
        setShowTrash(true);
        setSelectedTagId(null);
        setSelectedTagPath(undefined);
      }}
      onCreateNote={(blocks: NoteBlock[]) =>
        withMutation(async () => {
          try {
            await createNote(client, blocks);
          } catch (createError) {
            if (!isNetworkFailure(createError)) throw createError;
            await createOfflineNote(localDb, { clientId: newLocalId('web-note'), blocks: toCachedBlocks(blocks) });
          }
        })
      }
      onUpdateNote={(id: string, blocks: NoteBlock[]) =>
        withMutation(async () => {
          try {
            await updateNote(client, id, blocks);
          } catch (updateError) {
            if (!isNetworkFailure(updateError)) throw updateError;
            const current = notes.find((note) => note.id === id);
            if (!current) throw updateError;
            const cached: CachedNote = { id, clientId: current.clientId, blocks: toCachedBlocks(blocks), createdAt: current.createdAt, updatedAt: new Date().toISOString(), version: current.version };
            const operation = updateNoteOutboxOperation({ noteId: id, clientId: current.clientId, baseVersion: current.version, blocks: cached.blocks });
            await localDb.transaction('rw', localDb.notes_cache, localDb.outbox, async () => {
              await localDb.notes_cache.put(cached);
              await localDb.outbox.add(operation);
            });
          }
        })
      }
      onDeleteNote={(id: string) =>
        withMutation(async () => {
          try {
            await deleteNote(client, id);
          } catch (deleteError) {
            if (!isNetworkFailure(deleteError)) throw deleteError;
            const current = notes.find((note) => note.id === id);
            if (!current) throw deleteError;
            const operation = deleteNoteOutboxOperation({ noteId: id, clientId: current.clientId, baseVersion: current.version });
            await localDb.transaction('rw', localDb.notes_cache, localDb.outbox, async () => {
              await localDb.notes_cache.update(id, { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
              await localDb.outbox.add(operation);
            });
          }
          pushToast('已移入回收站', { label: '撤销', onClick: () => void restoreNoteById(id) });
        })
      }
      onRestoreNote={restoreNoteById}
      onLogout={() => void logout()}
      accessKeys={accessKeys}
      isLoadingAccessKeys={isLoadingAccessKeys}
      isCreatingAccessKey={isCreatingAccessKey}
      settingsError={settingsError}
      onLoadAccessKeys={loadAccessKeys}
      onCreateAccessKey={createNewAccessKey}
      onDeleteAccessKey={deleteExistingAccessKey}
      onChangePassword={updatePassword}
      onUploadImage={uploadImage}
      resolveMediaUrl={resolveMediaUrl}
    />
  );
}
