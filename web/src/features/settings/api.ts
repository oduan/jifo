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
