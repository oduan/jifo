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

// 刷新只靠后端写入的 HttpOnly Cookie(credentials:'include' 由 client 统一注入):
// 本地不持有 refreshToken,请求体留空,后端回退到 Cookie 取刷新令牌并轮换写回。
// 响应体里的 refreshToken 字段(为兼容 Android 仍会返回)在这里被忽略,绝不落 Web 存储。
export async function refreshAuth(client: ApiClient): Promise<LoginResult> {
  return client.request<LoginResult>('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
}

export function logoutAuth(client: ApiClient): Promise<void> {
  return client.request<void>('/auth/logout', { method: 'POST' });
}

// 当登录/刷新响应缺少 user 时，用有效 access token 补齐当前用户身份
export function fetchCurrentUser(client: ApiClient): Promise<AuthUser> {
  return client.request<AuthUser>('/me', { method: 'GET' });
}
