export type AuthUser = {
  id: string;
  email: string;
  username?: string;
};

// accessToken 只存内存;refresh token 由后端的 HttpOnly Cookie 承载,完全不进 Web 存储
// (审计 H-1:XSS 曾可从 localStorage 读走长效凭据)。localStorage 里只保留非敏感的
// user 对象,并兼任跨 tab 的登录/登出信号(见 useAuthSession 的 storage 监听)。
export type AuthState = {
  accessToken: string | null;
  user?: AuthUser | null;
};

type Listener = () => void;

const storageKey = 'jifo.auth';
// 跨 tab 监听(useAuthSession)需要用同一个键判定 storage 事件来源。
export const authStorageKey = storageKey;
const listeners = new Set<Listener>();

const emptyState: AuthState = { accessToken: null, user: null };

function isValidUser(value: unknown): value is AuthUser {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.email === 'string' &&
    (candidate.username === undefined || typeof candidate.username === 'string')
  );
}

// 兼容迁移:旧版本把 accessToken/refreshToken 明文整体存进 localStorage。升级后启动时
// 读一次旧键,剥离全部 token 字段,只把 user 写回;没有有效 user 就整键删除。
// 迁移不做登录态恢复(旧会话的续期凭据已删除),Cookie 仍在的用户刷新一次即可续期。
export function migrateLegacyAuthStorage(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    return;
  }
  if (!raw) {
    return;
  }
  let user: AuthUser | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const candidate = parsed as Record<string, unknown>;
      user = isValidUser(candidate.user) ? candidate.user : null;
    }
  } catch {
    user = null;
  }
  if (user) {
    const sanitized = JSON.stringify({ user });
    if (sanitized !== raw) {
      localStorage.setItem(storageKey, sanitized);
    }
  } else {
    localStorage.removeItem(storageKey);
  }
}

function readStoredUser(): AuthUser | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      // Malformed or tampered payload: drop it instead of trusting it.
      localStorage.removeItem(storageKey);
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate.user === undefined || candidate.user === null) {
      return null;
    }
    if (!isValidUser(candidate.user)) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return candidate.user;
  } catch {
    return null;
  }
}

// 模块加载即启动迁移,先剥离历史残留的明文 token,再水合 user。
migrateLegacyAuthStorage();

// 冷启动时 accessToken 必为空(只存内存),user 从 localStorage 水合。
let state: AuthState = { accessToken: null, user: readStoredUser() };

function persist() {
  if (typeof localStorage === 'undefined') {
    return;
  }
  if (!state.user) {
    localStorage.removeItem(storageKey);
    return;
  }
  // 只落盘 user;token 无论如何都不进 localStorage。
  localStorage.setItem(storageKey, JSON.stringify({ user: state.user }));
}

function notify() {
  listeners.forEach((listener) => listener());
}

export const authStore = {
  getState(): AuthState {
    return { ...state };
  },

  getSnapshot(): AuthState {
    return state;
  },

  getAccessToken(): string | null {
    return state.accessToken;
  },

  isAuthenticated(): boolean {
    return Boolean(state.accessToken);
  },

  // 仅改内存里的 accessToken,不触碰 localStorage。
  setAccessToken(accessToken: string | null) {
    state = { ...state, accessToken };
    notify();
  },

  setSession(nextState: AuthState) {
    state = {
      accessToken: nextState.accessToken ?? null,
      user: nextState.user ?? null
    };
    persist();
    notify();
  },

  clear() {
    state = { ...emptyState };
    persist();
    notify();
  },

  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};
