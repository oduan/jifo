import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { LoginPage, LoginPayload, LoginResult } from '../features/auth/LoginPage';
import { refreshAuth, submitAuth } from '../features/auth/api';
import { authStore } from '../features/auth/authStore';
import { loadHeatmap } from '../features/heatmap/api';
import { HeatmapCell } from '../features/heatmap/Heatmap';
import { createNote, deleteNote, fromApiNote, listNoteStats, listNotes, updateNote } from '../features/notes/api';
import { AccessKeySummary, createAccessKey, CreateAccessKeyResult, deleteAccessKey as deleteAccessKeyAPI, listAccessKeys } from '../features/settings/api';
import { Note } from '../features/notes/NoteCard';
import { NoteBlock } from '../features/notes/NoteEditor';
import { NotesPage } from '../features/notes/NotesPage';
import { listTagTree } from '../features/tags/api';
import { TagNode } from '../features/tags/TagTree';
import { ApiError, createApiClient } from '../shared/api/client';

const NOTES_PAGE_SIZE = 20;
const ACCESS_TOKEN_RENEWAL_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_RENEWAL_CHECK_MS = 30 * 60 * 1000;

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

export function App() {
  const authState = useAuthState();
  const accessToken = authState.accessToken;
  const [notes, setNotes] = useState<Note[]>([]);
  const [totalNoteCount, setTotalNoteCount] = useState(0);
  const [tags, setTags] = useState<TagNode[]>([]);
  const [heatmapCells, setHeatmapCells] = useState<HeatmapCell[]>([]);
  const [accessKeys, setAccessKeys] = useState<AccessKeySummary[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [isMutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isLoadingAccessKeys, setLoadingAccessKeys] = useState(false);
  const [isCreatingAccessKey, setCreatingAccessKey] = useState(false);
  const [noteQuery, setNoteQuery] = useState('');
  const [debouncedNoteQuery, setDebouncedNoteQuery] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedTagPath, setSelectedTagPath] = useState<string | undefined>();
  const [hasMoreNotes, setHasMoreNotes] = useState(false);
  const [isLoadingMoreNotes, setLoadingMoreNotes] = useState(false);

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
      limit: NOTES_PAGE_SIZE,
      offset
    }),
    [debouncedNoteQuery, selectedTagPath]
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
      setTags(nextTags);
      setNotes(nextNotes.items.map((note) => fromApiNote(note, nextTags)));
      setTotalNoteCount(nextStats.total);
      setHasMoreNotes(nextNotes.page.hasMore);
      setHeatmapCells(nextHeatmap);
    } catch (loadError) {
      const message = errorMessage(loadError);
      setError(message);
      if (loadError instanceof ApiError && loadError.status === 401 && !authStore.getState().refreshToken) {
        authStore.clear();
      }
    } finally {
      setLoading(false);
    }
  }, [client, noteListOptions]);

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
    }
  }, [accessToken, loadWorkspace]);

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

  const withMutation = useCallback(
    async (operation: () => Promise<void>) => {
      setMutating(true);
      setError(null);
      try {
        await operation();
        await loadWorkspace();
      } catch (mutationError) {
        setError(errorMessage(mutationError));
      } finally {
        setMutating(false);
      }
    },
    [loadWorkspace]
  );

  const loadMoreNotes = useCallback(async () => {
    if (!authStore.getAccessToken() || isLoading || isLoadingMoreNotes || !hasMoreNotes) {
      return;
    }

    setLoadingMoreNotes(true);
    setError(null);
    try {
      const next = await listNotes(client, noteListOptions(notes.length));
      setNotes((current) => [...current, ...next.items.map((note) => fromApiNote(note, tags))]);
      setHasMoreNotes(next.page.hasMore);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoadingMoreNotes(false);
    }
  }, [client, hasMoreNotes, isLoading, isLoadingMoreNotes, noteListOptions, notes.length, tags]);

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
      isMutating={isMutating}
      error={error}
      onRetry={() => void loadWorkspace()}
      onSearchChange={setNoteQuery}
      onSelectTag={(tag) => {
        setSelectedTagId(tag.id);
        setSelectedTagPath(tag.id ? tag.path : undefined);
      }}
      onLoadMoreNotes={() => void loadMoreNotes()}
      onCreateNote={(blocks: NoteBlock[]) =>
        withMutation(async () => {
          await createNote(client, blocks);
        })
      }
      onUpdateNote={(id: string, blocks: NoteBlock[]) =>
        withMutation(async () => {
          await updateNote(client, id, blocks);
        })
      }
      onDeleteNote={(id: string) =>
        withMutation(async () => {
          await deleteNote(client, id);
        })
      }
      onLogout={() => authStore.clear()}
      accessKeys={accessKeys}
      isLoadingAccessKeys={isLoadingAccessKeys}
      isCreatingAccessKey={isCreatingAccessKey}
      settingsError={settingsError}
      onLoadAccessKeys={loadAccessKeys}
      onCreateAccessKey={createNewAccessKey}
      onDeleteAccessKey={deleteExistingAccessKey}
    />
  );
}
