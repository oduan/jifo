import { describe, expect, test, vi } from 'vitest';

import { ApiClient } from '../../shared/api/client';
import { createAccessKey, listAccessKeys } from './api';

function mockClient(response: unknown): ApiClient {
  return {
    request: vi.fn(async () => response)
  };
}

describe('settings api', () => {
  test('listAccessKeys maps response items', async () => {
    const client = mockClient({ items: [{ id: 'k1', label: 'CLI', maskedKey: 'jifo_abcd••••vwxyz', createdAt: '2026-05-31T00:00:00Z' }] });

    await expect(listAccessKeys(client)).resolves.toEqual([{ id: 'k1', label: 'CLI', maskedKey: 'jifo_abcd••••vwxyz', createdAt: '2026-05-31T00:00:00Z' }]);
    expect(client.request).toHaveBeenCalledWith('/settings/access-keys');
  });

  test('createAccessKey posts label and returns one-time secret', async () => {
    const response = { item: { id: 'k1', label: 'CLI', maskedKey: 'jifo_abcd••••vwxyz', createdAt: '2026-05-31T00:00:00Z' }, secret: 'jifo_secret' };
    const client = mockClient(response);

    await expect(createAccessKey(client, 'CLI')).resolves.toEqual(response);
    expect(client.request).toHaveBeenCalledWith('/settings/access-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'CLI' })
    });
  });
});
