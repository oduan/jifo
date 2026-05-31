import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { LoginPage, LoginPayload, LoginResult } from '../features/auth/LoginPage';
import { submitAuth } from '../features/auth/api';
import { authStore } from '../features/auth/authStore';
import { loadHeatmap } from '../features/heatmap/api';
import { HeatmapCell } from '../features/heatmap/Heatmap';
import { createNote, deleteNote, fromApiNote, listNotes, updateNote } from '../features/notes/api';
import { AccessKeySummary, createAccessKey, CreateAccessKeyResult, listAccessKeys } from '../features/settings/api';
import { Note } from '../features/notes/NoteCard';
import { NoteBlock } from '../features/notes/NoteEditor';
import { NotesPage } from '../features/notes/NotesPage';
import { listTagTree } from '../features/tags/api';
import { TagNode } from '../features/tags/TagTree';
import { ApiError, createApiClient } from '../shared/api/client';

const NOTES_PAGE_SIZE = 20;

function useAuthState() {
  return useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);
}

function apiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL ?? '/api';
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

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl(),
        getAccessToken: authStore.getAccessToken
      }),
    []
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedNoteQuery(noteQuery), 300);
    return () => window.clearTimeout(timer);
  }, [noteQuery]);

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
      const [nextNotes, nextHeatmap] = await Promise.all([listNotes(client, noteListOptions(0)), loadHeatmap(client)]);
      setTags(nextTags);
      setNotes(nextNotes.items.map((note) => fromApiNote(note, nextTags)));
      setHasMoreNotes(nextNotes.page.hasMore);
      setHeatmapCells(nextHeatmap);
    } catch (loadError) {
      const message = errorMessage(loadError);
      setError(message);
      if (loadError instanceof ApiError && loadError.status === 401) {
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
    />
  );
}
