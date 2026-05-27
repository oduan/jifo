import { useSyncExternalStore } from 'react';

import { LoginPage } from '../features/auth/LoginPage';
import { authStore } from '../features/auth/authStore';

function useAuthState() {
  return useSyncExternalStore(authStore.subscribe, authStore.getState, authStore.getState);
}

export function App() {
  const authState = useAuthState();

  if (!authState.accessToken) {
    return (
      <LoginPage
        onSuccess={(result) => {
          authStore.setAccessToken(result.accessToken);
        }}
      />
    );
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>Jifo 主界面（占位）</h1>
      <p>认证成功。Task 10 再实现 NotesPage / Heatmap / TagTree。</p>
    </main>
  );
}
