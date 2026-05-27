import { useSyncExternalStore } from 'react';

import { LoginPage } from '../features/auth/LoginPage';
import { authStore } from '../features/auth/authStore';
import { NotesPage } from '../features/notes/NotesPage';

function useAccessToken() {
  return useSyncExternalStore(authStore.subscribe, authStore.getAccessToken, authStore.getAccessToken);
}

export function App() {
  const accessToken = useAccessToken();

  if (!accessToken) {
    return (
      <LoginPage
        onSuccess={(result) => {
          authStore.setAccessToken(result.accessToken);
        }}
      />
    );
  }

  return (
    <NotesPage
      userName="oisin"
      notes={[
        {
          id: 'demo-1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '欢迎使用 Jifo。主布局已就绪，离线同步将在 Task 11 接入。' }],
          tagIds: ['demo']
        }
      ]}
      tags={[{ id: 'demo', name: '示例', noteCount: 1 }]}
      heatmapCells={[
        { date: '2026-05-21', noteCount: 0 },
        { date: '2026-05-22', noteCount: 0 },
        { date: '2026-05-23', noteCount: 0 },
        { date: '2026-05-24', noteCount: 0 },
        { date: '2026-05-25', noteCount: 0 },
        { date: '2026-05-26', noteCount: 0 },
        { date: '2026-05-27', noteCount: 1 }
      ]}
      onLogout={() => authStore.clear()}
    />
  );
}
