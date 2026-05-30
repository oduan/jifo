export type AuthUser = {
  id: string;
  email: string;
  username?: string;
};

export type AuthState = {
  accessToken: string | null;
  refreshToken?: string | null;
  user?: AuthUser | null;
};

type Listener = () => void;

const storageKey = 'jifo.auth';
const listeners = new Set<Listener>();

function readStoredState(): AuthState {
  if (typeof localStorage === 'undefined') {
    return { accessToken: null, refreshToken: null, user: null };
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return { accessToken: null, refreshToken: null, user: null };
    }
    const parsed = JSON.parse(raw) as AuthState;
    return { accessToken: parsed.accessToken ?? null, refreshToken: parsed.refreshToken ?? null, user: parsed.user ?? null };
  } catch {
    return { accessToken: null, refreshToken: null, user: null };
  }
}

let state: AuthState = readStoredState();

function persist() {
  if (typeof localStorage === 'undefined') {
    return;
  }
  if (!state.accessToken) {
    localStorage.removeItem(storageKey);
    return;
  }
  localStorage.setItem(storageKey, JSON.stringify(state));
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

  setAccessToken(accessToken: string | null) {
    state = accessToken ? { ...state, accessToken } : { accessToken: null, refreshToken: null, user: null };
    persist();
    notify();
  },

  setSession(nextState: AuthState) {
    state = {
      accessToken: nextState.accessToken ?? null,
      refreshToken: nextState.refreshToken ?? null,
      user: nextState.user ?? null
    };
    persist();
    notify();
  },

  clear() {
    state = { accessToken: null, refreshToken: null, user: null };
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
