import { describe, expect, test, vi } from 'vitest';

import { ApiClient } from '../../shared/api/client';
import { OutboxOperation } from '../../storage/db';
import { pullChanges, pushOutbox } from './api';

function outboxOperation(index: number): OutboxOperation {
  return {
    opId: `op-${index}`,
    entity: 'note',
    action: 'update',
    clientId: `client-${index}`,
    noteId: `note-${index}`,
    baseVersion: 1,
    payload: { blocks: [{ type: 'paragraph', content: `内容 ${index}` }] },
    createdAt: '2026-01-01T00:00:00Z',
    status: 'pending'
  };
}

describe('sync api adapter', () => {
  test('push converts cached paragraph content to backend text blocks', async () => {
    const request = vi.fn(async () => ({ results: [{ opId: 'op1', status: 'created', noteId: 'n1', version: 1 }] }));
    const client = { request } as unknown as ApiClient;
    const results = await pushOutbox(client, [{
      opId: 'op1', entity: 'note', action: 'create', clientId: 'c1', noteId: 'local-note-1', baseVersion: 0,
      payload: { blocks: [{ type: 'paragraph', content: 'hello #tag' }] }, createdAt: '2026-01-01T00:00:00Z', status: 'pending'
    }]);

    expect(results[0]).toMatchObject({ status: 'created', noteId: 'n1' });
    const body = JSON.parse(request.mock.calls[0][1]?.body as string);
    expect(body.operations[0]).not.toHaveProperty('noteId');
    expect(body.operations[0].payload).toEqual({ blocks: [{ type: 'paragraph', text: 'hello #tag' }], plainText: 'hello #tag' });
  });

  test('601 个操作按 400 一批分两次推送并按顺序拼接结果', async () => {
    const batchSizes: number[] = [];
    const request = vi.fn(async (_path: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body));
      batchSizes.push(body.operations.length);
      return {
        results: body.operations.map((operation: { opId: string }, index: number) => ({
          opId: operation.opId,
          status: 'created',
          noteId: `server-${index}`,
          version: 1
        }))
      };
    });
    const client = { request } as unknown as ApiClient;

    const operations = Array.from({ length: 601 }, (_, index) => outboxOperation(index));
    const results = await pushOutbox(client, operations);

    // 后端单批上限 500:客户端 400 一批,601 = 400 + 201
    expect(batchSizes).toEqual([400, 201]);
    expect(results).toHaveLength(601);
    // 结果按批次顺序拼接,与入队顺序一一对应
    expect(results.map((result) => result.opId)).toEqual(operations.map((operation) => operation.opId));
    expect(results[0]).toMatchObject({ status: 'created', noteId: 'server-0' });
    expect(results[400]).toMatchObject({ status: 'created', noteId: 'server-0' });
  });

  test('不超过一批的操作仍然只发一次请求', async () => {
    const request = vi.fn(async (_path: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body));
      return { results: body.operations.map((operation: { opId: string }) => ({ opId: operation.opId, status: 'updated' })) };
    });
    const client = { request } as unknown as ApiClient;

    const operations = Array.from({ length: 400 }, (_, index) => outboxOperation(index));
    const results = await pushOutbox(client, operations);

    expect(request).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(400);
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
