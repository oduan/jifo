export type AuthState = {
  accessToken: string | null;
};

type Listener = () => void;

const listeners = new Set<Listener>();
let state: AuthState = { accessToken: null };

function notify() {
  listeners.forEach((listener) => listener());
}

export const authStore = {
  getState(): AuthState {
    return { ...state };
  },

  getAccessToken(): string | null {
    return state.accessToken;
  },

  isAuthenticated(): boolean {
    return Boolean(state.accessToken);
  },

  setAccessToken(accessToken: string | null) {
    state = { accessToken };
    notify();
  },

  clear() {
    state = { accessToken: null };
    notify();
  },

  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};
