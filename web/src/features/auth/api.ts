import { ApiClient } from '../../shared/api/client';
import { AuthUser } from './authStore';
import { LoginPayload, LoginResult } from './LoginPage';

const deviceCodeKey = 'jifo.deviceCode';

function randomId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateDeviceCode() {
  if (typeof localStorage === 'undefined') {
    return `web-${randomId()}`;
  }

  const existing = localStorage.getItem(deviceCodeKey);
  if (existing) {
    return existing;
  }

  const next = `web-${randomId()}`;
  localStorage.setItem(deviceCodeKey, next);
  return next;
}

export async function submitAuth(client: ApiClient, payload: LoginPayload): Promise<LoginResult> {
  const path = payload.mode === 'register' ? '/auth/register' : '/auth/login';
  const username = payload.email.split('@')[0] || payload.email;

  return client.request<LoginResult>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
      username,
      deviceCode: getOrCreateDeviceCode()
    })
  });
}

export async function refreshAuth(client: ApiClient, refreshToken: string): Promise<LoginResult> {
  return client.request<LoginResult>('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });
}

export function logoutAuth(client: ApiClient): Promise<void> {
  return client.request<void>('/auth/logout', { method: 'POST' });
}

// 当登录/刷新响应缺少 user 时，用有效 access token 补齐当前用户身份
export function fetchCurrentUser(client: ApiClient): Promise<AuthUser> {
  return client.request<AuthUser>('/me', { method: 'GET' });
}
