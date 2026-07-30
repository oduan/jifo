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

const emptyState: AuthState = { accessToken: null, refreshToken: null, user: null };

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

function parseStoredState(raw: string): AuthState | null {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.accessToken !== 'string' || candidate.accessToken === '') {
    return null;
  }
  if (candidate.refreshToken !== undefined && candidate.refreshToken !== null && typeof candidate.refreshToken !== 'string') {
    return null;
  }
  if (candidate.user !== undefined && candidate.user !== null && !isValidUser(candidate.user)) {
    return null;
  }
  return {
    accessToken: candidate.accessToken,
    refreshToken: (candidate.refreshToken as string | null | undefined) ?? null,
    user: (candidate.user as AuthUser | null | undefined) ?? null
  };
}

function readStoredState(): AuthState {
  if (typeof localStorage === 'undefined') {
    return { ...emptyState };
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return { ...emptyState };
    }
    const parsed = parseStoredState(raw);
    if (!parsed) {
      // Malformed or tampered payload: drop it instead of trusting it.
      localStorage.removeItem(storageKey);
      return { ...emptyState };
    }
    return parsed;
  } catch {
    return { ...emptyState };
  }
}

let state: AuthState = readStoredState();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey) return;
    try {
      state = event.newValue ? parseStoredState(event.newValue) ?? { ...emptyState } : { ...emptyState };
    } catch {
      state = { ...emptyState };
    }
    notify();
  });
}

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
