import { beforeEach, describe, expect, test } from 'vitest';

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
        return { cursor: 'cursor-1', notes: [] };
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
        cursor: 'cursor-2',
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
    expect((await db.sync_state.get('cursor'))?.value).toBe('cursor-2');
    expect((await db.outbox.toArray())).toHaveLength(0);
  });
});
