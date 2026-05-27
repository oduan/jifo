import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createJifoDb } from '../../storage/db';
import {
  createNoteOutboxOperation,
  createOfflineNote,
  deleteNoteOutboxOperation,
  enqueueOutboxOperation,
  restoreNoteOutboxOperation,
  updateNoteOutboxOperation
} from './outbox';
import { runSync } from './syncEngine';

describe('IndexedDB schema', () => {
  test('能写入 notes_cache、media_cache、outbox、sync_state', async () => {
    const db = createJifoDb('task11-schema');

    await db.notes_cache.put({
      id: 'n1',
      clientId: 'c1',
      blocks: [{ type: 'paragraph', content: 'hi' }],
      updatedAt: '2026-05-27T00:00:00Z'
    });

    await db.media_cache.put({
      id: 'm1',
      localId: 'local-1',
      status: 'local_pending',
      createdAt: '2026-05-27T00:00:00Z'
    });

    await db.outbox.add({
      opId: 'op-1',
      entity: 'note',
      action: 'create',
      clientId: 'c1',
      baseVersion: 0,
      payload: { blocks: [{ type: 'paragraph', content: 'hi' }] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    await db.sync_state.put({ key: 'cursor', value: 'abc' });

    expect(await db.notes_cache.get('n1')).toBeTruthy();
    expect(await db.media_cache.get('m1')).toBeTruthy();
    expect(await db.outbox.toArray()).toHaveLength(1);
    expect(await db.sync_state.get('cursor')).toEqual({ key: 'cursor', value: 'abc' });

    await db.delete();
  });
});

describe('outbox helpers', () => {
  let db = createJifoDb('task11-outbox');

  beforeEach(async () => {
    await db.delete();
    db = createJifoDb('task11-outbox');
  });

  test('离线新增 note：更新本地 cache 并写入 outbox create，包含 opId/clientId/baseVersion', async () => {
    const now = '2026-05-27T01:00:00Z';

    const result = await createOfflineNote(db, {
      noteId: 'local-note-1',
      clientId: 'client-1',
      blocks: [{ type: 'paragraph', content: 'offline note' }],
      createdAt: now,
      opId: 'op-create-1'
    });

    const saved = await db.outbox.toArray();
    expect(result.note.id).toBe('local-note-1');
    expect(saved).toHaveLength(1);
    expect(saved[0].opId).toBe('op-create-1');
    expect(saved[0].clientId).toBe('client-1');
    expect(saved[0].baseVersion).toBe(0);
    expect((await db.notes_cache.get('local-note-1'))?.blocks).toEqual([{ type: 'paragraph', content: 'offline note' }]);
  });

  test('create/update/delete/restore helpers 都能生成 note 操作', () => {
    const create = createNoteOutboxOperation({ clientId: 'c1', blocks: [{ type: 'paragraph', content: '1' }] });
    const update = updateNoteOutboxOperation({ noteId: 'n1', clientId: 'c1', baseVersion: 2, blocks: [{ type: 'paragraph', content: '2' }] });
    const remove = deleteNoteOutboxOperation({ noteId: 'n1', clientId: 'c1', baseVersion: 2 });
    const restore = restoreNoteOutboxOperation({ noteId: 'n1', clientId: 'c1', baseVersion: 3, blocks: [{ type: 'paragraph', content: '3' }] });

    expect(create.action).toBe('create');
    expect(update.action).toBe('update');
    expect(remove.action).toBe('delete');
    expect(restore.action).toBe('restore');
  });
});

describe('runSync', () => {
  let db = createJifoDb('task11-sync');

  beforeEach(async () => {
    await db.delete();
    db = createJifoDb('task11-sync');
  });

  test('媒体优先上传：先上传 media，再替换 blocks.mediaId，最后 push note', async () => {
    const calls: string[] = [];

    await db.outbox.add({
      opId: 'op-1',
      entity: 'note',
      action: 'create',
      clientId: 'client-1',
      baseVersion: 0,
      payload: {
        blocks: [
          { type: 'paragraph', content: 'with image' },
          { type: 'image', url: 'blob:abc', localId: 'local-media-1' }
        ]
      },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    const pushedPayloads: unknown[] = [];

    await runSync({
      db,
      uploadMedia: async (input) => {
        calls.push(`upload:${input.localId}`);
        return { mediaId: 'server-media-1' };
      },
      pushOutbox: async (ops) => {
        calls.push('push');
        pushedPayloads.push(ops[0].payload);
        return [{ opId: 'op-1', status: 'created', noteId: 'server-note-1', version: 1 }];
      },
      pullChanges: async () => {
        calls.push('pull');
        return { cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'cursor-1' }, notes: [] };
      }
    });

    expect(calls).toEqual(['upload:local-media-1', 'push', 'pull']);
    expect(pushedPayloads[0]).toEqual({
      blocks: [
        { type: 'paragraph', content: 'with image' },
        { type: 'image', mediaId: 'server-media-1' }
      ]
    });
  });

  test('push→pull 后更新本地 cache；遇到 conflict_copied 时增加 conflict note', async () => {
    await db.outbox.add({
      opId: 'op-update-1',
      entity: 'note',
      action: 'update',
      clientId: 'client-1',
      noteId: 'n1',
      baseVersion: 1,
      payload: { blocks: [{ type: 'paragraph', content: 'new text' }] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async () => [
        {
          opId: 'op-update-1',
          status: 'conflict_copied',
          noteId: 'conflict-1',
          version: 3,
          note: {
            id: 'conflict-1',
            clientId: 'conflict-client-1',
            blocks: [{ type: 'paragraph', content: '冲突副本内容' }],
            updatedAt: '2026-05-27T01:00:00Z',
            createdAt: '2026-05-27T01:00:00Z',
            version: 3,
            conflictOfNoteId: 'n1',
            conflictReason: 'version_conflict'
          }
        }
      ],
      pullChanges: async () => ({
        cursor: { updatedAt: '2026-05-27T01:00:01Z', id: 'n1' },
        notes: [
          {
            id: 'n1',
            clientId: 'client-1',
            blocks: [{ type: 'paragraph', content: 'server text' }],
            updatedAt: '2026-05-27T01:00:01Z',
            createdAt: '2026-05-27T00:00:00Z',
            version: 2
          }
        ]
      })
    });

    const conflict = await db.notes_cache.get('conflict-1');
    const serverNote = await db.notes_cache.get('n1');

    expect(conflict?.conflictReason).toBe('version_conflict');
    expect(serverNote?.blocks).toEqual([{ type: 'paragraph', content: 'server text' }]);
    expect((await db.sync_state.get('cursor'))?.value).toEqual({ updatedAt: '2026-05-27T01:00:01Z', id: 'n1' });
    expect((await db.outbox.toArray())).toHaveLength(0);
  });

  test('同一 DB 实例并发 runSync 只会推送一次同一批 outbox', async () => {
    await db.outbox.add({
      opId: 'op-concurrent-1',
      entity: 'note',
      action: 'create',
      clientId: 'client-1',
      baseVersion: 0,
      payload: { blocks: [{ type: 'paragraph', content: 'once' }] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    let releasePush: () => void = () => undefined;
    const pushOutbox = vi.fn(
      () =>
        new Promise<Array<{ opId: string; status: string }>>((resolve) => {
          releasePush = () => resolve([{ opId: 'op-concurrent-1', status: 'created' }]);
        })
    );

    const first = runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox,
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'cursor-concurrent' }, notes: [] })
    });
    await vi.waitFor(() => expect(pushOutbox).toHaveBeenCalledTimes(1));
    const second = runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox,
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'cursor-concurrent' }, notes: [] })
    });

    releasePush();
    await Promise.all([first, second]);

    expect(pushOutbox).toHaveBeenCalledTimes(1);
    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('同名 DB 多实例并发 runSync 也只会推送一次同一批 outbox', async () => {
    await db.outbox.add({
      opId: 'op-db-lock-1',
      entity: 'note',
      action: 'create',
      clientId: 'client-1',
      baseVersion: 0,
      payload: { blocks: [{ type: 'paragraph', content: 'once across db instances' }] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });
    const secondDb = createJifoDb('task11-sync');

    let releasePush: () => void = () => undefined;
    const pushOutbox = vi.fn(
      () =>
        new Promise<Array<{ opId: string; status: string }>>((resolve) => {
          releasePush = () => resolve([{ opId: 'op-db-lock-1', status: 'created' }]);
        })
    );

    const first = runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox,
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'n1' }, notes: [] })
    });
    await vi.waitFor(() => expect(pushOutbox).toHaveBeenCalledTimes(1));
    const second = runSync({
      db: secondDb,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox,
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'n1' }, notes: [] })
    });

    releasePush();
    await Promise.all([first, second]);

    expect(pushOutbox).toHaveBeenCalledTimes(1);
    expect(await db.outbox.toArray()).toHaveLength(0);
    await secondDb.close();
  });

  test('pull 失败时不会留下 pushing 状态', async () => {
    await db.outbox.add({
      opId: 'op-pull-fails-1',
      entity: 'note',
      action: 'update',
      clientId: 'client-1',
      noteId: 'n1',
      baseVersion: 1,
      payload: { blocks: [{ type: 'paragraph', content: 'server accepted before pull failed' }] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    await expect(
      runSync({
        db,
        uploadMedia: async () => ({ mediaId: 'unused' }),
        pushOutbox: async () => {
          throw new Error('network down before server ack');
        },
        pullChanges: async () => {
          throw new Error('pull down');
        }
      })
    ).rejects.toThrow('network down before server ack');

    const [op] = await db.outbox.toArray();
    expect(op.status).toBe('failed');
    expect(op.lastError).toBe('network down before server ack');
  });

  test('pull 失败时已成功 push 的 outbox 已清理且不会残留 pushing', async () => {
    await db.outbox.add({
      opId: 'op-pull-fails-after-push-1',
      entity: 'note',
      action: 'create',
      clientId: 'client-1',
      baseVersion: 0,
      payload: { blocks: [{ type: 'paragraph', content: 'server accepted' }] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    await expect(
      runSync({
        db,
        uploadMedia: async () => ({ mediaId: 'unused' }),
        pushOutbox: async () => [{ opId: 'op-pull-fails-after-push-1', status: 'created' }],
        pullChanges: async () => {
          throw new Error('pull down');
        }
      })
    ).rejects.toThrow('pull down');

    expect((await db.outbox.toArray()).some((op) => op.status === 'pushing')).toBe(false);
    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('后端返回 duplicate 时视为成功，清理 outbox 并回填 noteId/version', async () => {
    await db.notes_cache.put({
      id: 'local-note-duplicate',
      clientId: 'client-1',
      blocks: [{ type: 'paragraph', content: 'duplicate create' }],
      createdAt: '2026-05-27T00:00:00Z',
      updatedAt: '2026-05-27T00:00:00Z',
      version: 0
    });
    await db.outbox.add({
      opId: 'op-duplicate-1',
      entity: 'note',
      action: 'create',
      noteId: 'local-note-duplicate',
      clientId: 'client-1',
      baseVersion: 0,
      payload: { blocks: [{ type: 'paragraph', content: 'duplicate create' }] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async () => [{ opId: 'op-duplicate-1', status: 'duplicate', noteId: 'n-existing', version: 2 }],
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'n-existing' }, notes: [] })
    });

    expect(await db.outbox.toArray()).toHaveLength(0);
    expect(await db.notes_cache.get('local-note-duplicate')).toBeUndefined();
    expect((await db.notes_cache.get('n-existing'))?.version).toBe(2);
  });

  test('启动同步时会恢复上次中断残留的 pushing outbox', async () => {
    await db.outbox.add({
      opId: 'op-interrupted-1',
      entity: 'note',
      action: 'update',
      clientId: 'client-1',
      noteId: 'n1',
      baseVersion: 1,
      payload: { blocks: [{ type: 'paragraph', content: 'stuck pushing' }] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pushing'
    });

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async () => {
        throw new Error('should not push restored operation until next run');
      },
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'cursor-after-recover' }, notes: [] })
    });

    let [op] = await db.outbox.toArray();
    expect(op.status).toBe('failed');
    expect(op.lastError).toBe('interrupted_sync');

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async () => [{ opId: 'op-interrupted-1', status: 'updated', noteId: 'n1', version: 2 }],
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:01Z', id: 'n1' }, notes: [] })
    });

    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('push 返回失败状态时保留 outbox 并记录错误', async () => {
    await db.outbox.add({
      opId: 'op-failed-1',
      entity: 'note',
      action: 'update',
      clientId: 'client-1',
      noteId: 'n1',
      baseVersion: 1,
      payload: { blocks: [{ type: 'paragraph', content: 'will retry' }] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async () => [{ opId: 'op-failed-1', status: 'retry_later' }],
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'cursor-after-failure-status' }, notes: [] })
    });

    const [op] = await db.outbox.toArray();
    expect(op.status).toBe('failed');
    expect(op.lastError).toBe('push_status:retry_later');
  });

  test('媒体上传成功但 push 失败时持久化 mediaId 并保留 failed outbox 供重试', async () => {
    await db.media_cache.put({
      id: 'm-local-1',
      localId: 'local-media-1',
      status: 'local_pending',
      createdAt: '2026-05-27T00:00:00Z'
    });
    await db.outbox.add({
      opId: 'op-media-retry-1',
      entity: 'note',
      action: 'create',
      clientId: 'client-1',
      baseVersion: 0,
      payload: {
        blocks: [
          { type: 'paragraph', content: 'with image' },
          { type: 'image', url: 'blob:abc', localId: 'local-media-1' }
        ]
      },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    await expect(
      runSync({
        db,
        uploadMedia: async () => ({ mediaId: 'server-media-1' }),
        pushOutbox: async () => {
          throw new Error('network down');
        },
        pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'unused' }, notes: [] })
      })
    ).rejects.toThrow('network down');

    const [failedOp] = await db.outbox.toArray();
    expect(failedOp.status).toBe('failed');
    expect(failedOp.lastError).toBe('network down');
    expect(failedOp.payload.blocks).toEqual([
      { type: 'paragraph', content: 'with image' },
      { type: 'image', mediaId: 'server-media-1' }
    ]);
    expect((await db.media_cache.get('m-local-1'))?.serverId).toBe('server-media-1');

    const uploadMedia = vi.fn(async () => ({ mediaId: 'server-media-1' }));
    const pushedPayloads: unknown[] = [];
    await runSync({
      db,
      uploadMedia,
      pushOutbox: async (ops) => {
        pushedPayloads.push(ops[0].payload);
        return [{ opId: 'op-media-retry-1', status: 'created' }];
      },
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'cursor-after-retry' }, notes: [] })
    });

    expect(uploadMedia).not.toHaveBeenCalled();
    expect(pushedPayloads[0]).toEqual({
      blocks: [
        { type: 'paragraph', content: 'with image' },
        { type: 'image', mediaId: 'server-media-1' }
      ]
    });
    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('conflict_copied 不会把原 note id 改成冲突副本 id，仍可通过 pull 落地冲突副本', async () => {
    await db.notes_cache.put({
      id: 'n1',
      clientId: 'client-1',
      blocks: [{ type: 'paragraph', content: 'server original' }],
      updatedAt: '2026-05-27T00:00:00Z',
      createdAt: '2026-05-27T00:00:00Z',
      version: 1
    });
    await db.outbox.add({
      opId: 'op-conflict-no-note',
      entity: 'note',
      action: 'update',
      clientId: 'client-1',
      noteId: 'n1',
      baseVersion: 1,
      payload: { blocks: [{ type: 'paragraph', content: 'client text' }] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async () => [{ opId: 'op-conflict-no-note', status: 'conflict_copied', noteId: 'conflict-from-pull' }],
      pullChanges: async () => ({
        cursor: { updatedAt: '2026-05-27T01:00:00Z', id: 'conflict-from-pull' },
        notes: [
          {
            id: 'conflict-from-pull',
            clientId: 'conflict-client-1',
            blocks: [{ type: 'paragraph', content: 'pull conflict copy' }],
            updatedAt: '2026-05-27T01:00:00Z',
            createdAt: '2026-05-27T01:00:00Z',
            version: 3,
            conflictOfNoteId: 'n1',
            conflictReason: 'version_conflict'
          }
        ]
      })
    });

    expect((await db.notes_cache.get('n1'))?.blocks).toEqual([{ type: 'paragraph', content: 'server original' }]);
    expect((await db.notes_cache.get('conflict-from-pull'))?.conflictReason).toBe('version_conflict');
    expect(await db.outbox.toArray()).toHaveLength(0);
  });
});
