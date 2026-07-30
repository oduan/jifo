import { ReactNode, createContext, useContext } from 'react';

import { useAuthSession } from '../features/auth/useAuthSession';

export type AuthContextValue = ReturnType<typeof useAuthSession>;

const AuthContext = createContext<AuthContextValue | null>(null);

// AuthProvider 在应用根部创建唯一的会话实例，避免多处重复 useAuthSession。
export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthSession();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

// 在 Provider 内消费认证上下文；不在 Provider 内使用属于编程错误。
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth 必须在 AuthProvider 内使用');
  }
  return value;
}
