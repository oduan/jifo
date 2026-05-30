import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { LoginPage, LoginPayload, LoginResult } from '../features/auth/LoginPage';
import { submitAuth } from '../features/auth/api';
import { authStore } from '../features/auth/authStore';
import { loadHeatmap } from '../features/heatmap/api';
import { HeatmapCell } from '../features/heatmap/Heatmap';
import { uploadMedia } from '../features/media/api';
import { createNote, deleteNote, fromApiNote, listNotes, updateNote } from '../features/notes/api';
import { Note } from '../features/notes/NoteCard';
import { NoteBlock } from '../features/notes/NoteEditor';
import { NotesPage } from '../features/notes/NotesPage';
import { listTagTree } from '../features/tags/api';
import { TagNode } from '../features/tags/TagTree';
import { ApiError, createApiClient } from '../shared/api/client';

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
  const [isLoading, setLoading] = useState(false);
  const [isMutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl(),
        getAccessToken: authStore.getAccessToken
      }),
    []
  );

  const loadWorkspace = useCallback(async () => {
    if (!authStore.getAccessToken()) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextTags = await listTagTree(client);
      const [nextNotes, nextHeatmap] = await Promise.all([listNotes(client), loadHeatmap(client)]);
      setTags(nextTags);
      setNotes(nextNotes.map((note) => fromApiNote(note, nextTags)));
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
  }, [client]);

  useEffect(() => {
    if (accessToken) {
      void loadWorkspace();
    } else {
      setNotes([]);
      setTags([]);
      setHeatmapCells([]);
      setError(null);
    }
  }, [accessToken, loadWorkspace]);

  const submitLogin = useCallback(
    async (payload: LoginPayload): Promise<LoginResult> => {
      return submitAuth(client, payload);
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
      isLoading={isLoading}
      isMutating={isMutating}
      error={error}
      onRetry={() => void loadWorkspace()}
      onCreateNote={(blocks: NoteBlock[]) => withMutation(async () => {
        await createNote(client, blocks);
      })}
      onUpdateNote={(id: string, blocks: NoteBlock[]) => withMutation(async () => {
        await updateNote(client, id, blocks);
      })}
      onDeleteNote={(id: string) => withMutation(async () => {
        await deleteNote(client, id);
      })}
      onUploadImage={async (file: File) => {
        const asset = await uploadMedia(client, file);
        return { type: 'image', url: asset.url, mediaId: asset.id, alt: file.name };
      }}
      onLogout={() => authStore.clear()}
    />
  );
}
