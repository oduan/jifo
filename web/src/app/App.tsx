import { AuthProvider, useAuth } from './AuthProvider';
import { WorkspaceProvider } from './WorkspaceProvider';
import { LoginPage } from '../features/auth/LoginPage';
import { authStore } from '../features/auth/authStore';
import { fetchCurrentUser } from '../features/auth/api';
import { NotesPage } from '../features/notes/NotesPage';

// AppRoutes 在 AuthProvider 内部读取会话：未登录展示登录页，登录后进入工作区。
function AppRoutes() {
  const { accessToken, client, submitLogin } = useAuth();

  if (!accessToken) {
    return (
      <LoginPage
        onSubmit={submitLogin}
        onSuccess={(result) => {
          authStore.setSession({ accessToken: result.accessToken, refreshToken: result.refreshToken ?? null, user: result.user ?? null });
          // 响应缺 user 时用新 token 调 /me 补齐，避免落入无本地库的在线降级态。
          if (!result.user) {
            void fetchCurrentUser(client)
              .then((user) => {
                authStore.setSession({ accessToken: result.accessToken, refreshToken: result.refreshToken ?? null, user });
              })
              .catch(() => undefined);
          }
        }}
      />
    );
  }

  return (
    <WorkspaceProvider>
      <NotesPage />
    </WorkspaceProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
