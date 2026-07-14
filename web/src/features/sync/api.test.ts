import { describe, expect, test, vi } from 'vitest';

import { ApiClient } from '../../shared/api/client';
import { pullChanges, pushOutbox } from './api';

describe('sync api adapter', () => {
  test('push converts cached paragraph content to backend text blocks', async () => {
    const request = vi.fn(async () => ({ results: [{ opId: 'op1', status: 'created', noteId: 'n1', version: 1 }] }));
    const client = { request } as unknown as ApiClient;
    const results = await pushOutbox(client, [{
      opId: 'op1', entity: 'note', action: 'create', clientId: 'c1', baseVersion: 0,
      payload: { blocks: [{ type: 'paragraph', content: 'hello #tag' }] }, createdAt: '2026-01-01T00:00:00Z', status: 'pending'
    }]);

    expect(results[0]).toMatchObject({ status: 'created', noteId: 'n1' });
    const body = JSON.parse(request.mock.calls[0][1]?.body as string);
    expect(body.operations[0].payload).toEqual({ blocks: [{ type: 'paragraph', text: 'hello #tag' }], plainText: 'hello #tag' });
  });

  test('pull maps backend note blocks and nullable cursor', async () => {
    const request = vi.fn(async () => ({
      notes: [{ id: 'n1', clientId: 'c1', content: { blocks: [{ type: 'paragraph', text: 'server text' }] }, updatedAt: '2026-01-01T00:00:00Z', version: 2 }],
      cursor: { updatedAt: '2026-01-01T00:00:00Z', id: 'n1' }
    }));
    const client = { request } as unknown as ApiClient;
    const result = await pullChanges(client);
    expect(result.cursor).toEqual({ updatedAt: '2026-01-01T00:00:00Z', id: 'n1' });
    expect(result.notes[0].blocks).toEqual([{ type: 'paragraph', content: 'server text' }]);
  });
});
