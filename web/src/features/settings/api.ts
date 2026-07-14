import { ApiClient } from '../../shared/api/client';

export type AccessKeySummary = {
  id: string;
  label: string;
  maskedKey: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type CreateAccessKeyResult = {
  item: AccessKeySummary;
  secret: string;
};

type AccessKeysResponse = {
  items: AccessKeySummary[];
};

export function listAccessKeys(client: ApiClient): Promise<AccessKeySummary[]> {
  return client.request<AccessKeysResponse>('/settings/access-keys').then((response) => response.items);
}

export function createAccessKey(client: ApiClient, label: string): Promise<CreateAccessKeyResult> {
  return client.request<CreateAccessKeyResult>('/settings/access-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  });
}

export function deleteAccessKey(client: ApiClient, id: string): Promise<void> {
  return client.request<void>(`/settings/access-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function changePassword(client: ApiClient, currentPassword: string, newPassword: string): Promise<void> {
  return client.request<void>('/me/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword })
  });
}
