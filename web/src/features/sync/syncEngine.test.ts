import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createJifoDb } from '../../storage/db';
import {
  createNoteOutboxOperation,
  createOfflineNote,
  deleteNoteOutboxOperation,
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

  test('离线创建后的连续编辑会合并为一个 create 并回填服务端 ID', async () => {
    await createOfflineNote(db, {
      noteId: 'local-note-1',
      clientId: 'client-offline-1',
      blocks: [{ type: 'paragraph', content: 'draft' }],
      opId: 'op-create-1'
    });
    await db.outbox.add(updateNoteOutboxOperation({
      noteId: 'local-note-1',
      clientId: 'client-offline-1',
      baseVersion: 0,
      blocks: [{ type: 'paragraph', content: 'final text' }],
      opId: 'op-update-1'
    }));
    await db.notes_cache.update('local-note-1', { blocks: [{ type: 'paragraph', content: 'final text' }] });
    const pushed: Array<ReturnType<typeof createNoteOutboxOperation>> = [];

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async (operations) => {
        pushed.push(...operations);
        return [{ opId: 'op-create-1', status: 'created', noteId: 'server-note-1', version: 1 }];
      },
      pullChanges: async () => ({ notes: [] })
    });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ action: 'create', noteId: 'local-note-1' });
    expect(pushed[0].payload.blocks).toEqual([{ type: 'paragraph', content: 'final text' }]);
    expect(await db.notes_cache.get('local-note-1')).toBeUndefined();
    expect((await db.notes_cache.get('server-note-1'))?.blocks).toEqual([{ type: 'paragraph', content: 'final text' }]);
    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('create 重命名 noteId 时同一事务内回写 outbox 旧 id 操作并推进 baseVersion', async () => {
    await createOfflineNote(db, {
      noteId: 'local-note-1',
      clientId: 'client-offline-1',
      blocks: [{ type: 'paragraph', content: 'draft' }],
      opId: 'op-create-1'
    });

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async () => {
        // 模拟推送期间新入队的编辑：rename 发生后、界面刷新前，操作仍带旧 id
        await db.outbox.add(updateNoteOutboxOperation({
          noteId: 'local-note-1',
          clientId: 'client-offline-1',
          baseVersion: 0,
          blocks: [{ type: 'paragraph', content: 'late edit' }],
          opId: 'op-update-late'
        }));
        return [{ opId: 'op-create-1', status: 'created', noteId: 'server-note-1', version: 1 }];
      },
      pullChanges: async () => ({ notes: [] })
    });

    expect(await db.notes_cache.get('local-note-1')).toBeUndefined();
    const [pendingOp] = await db.outbox.toArray();
    expect(pendingOp.opId).toBe('op-update-late');
    expect(pendingOp.noteId).toBe('server-note-1');
    expect(pendingOp.baseVersion).toBe(1);
    expect(pendingOp.status).toBe('pending');

    // 回写后的操作以服务端 UUID 重试成功，不再被后端按非法 noteId 拒绝
    const pushedOps: Array<ReturnType<typeof updateNoteOutboxOperation>> = [];
    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async (operations) => {
        pushedOps.push(...operations);
        return [{ opId: 'op-update-late', status: 'updated', noteId: 'server-note-1', version: 2 }];
      },
      pullChanges: async () => ({ notes: [] })
    });

    expect(pushedOps).toHaveLength(1);
    expect(pushedOps[0]).toMatchObject({ action: 'update', noteId: 'server-note-1', baseVersion: 1 });
    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('遗留的跨 noteId 毒丸操作在同步开头被治愈，最新编辑不随旧 id 丢失', async () => {
    // 旧版本遗留的毒丸数据：cache 已重命名为服务端 id，outbox 仍留着旧 id 的 failed 更新；
    // healStaleNoteIds 先把旧 id 操作改写为当前 id，compaction 再按同一 id 合并推送
    await db.notes_cache.put({
      id: 'server-note-1',
      clientId: 'client-offline-1',
      blocks: [{ type: 'paragraph', content: 'server state' }],
      createdAt: '2026-05-27T00:00:00Z',
      updatedAt: '2026-05-27T00:00:00Z',
      version: 1
    });
    const poison = updateNoteOutboxOperation({
      noteId: 'local-note-1',
      clientId: 'client-offline-1',
      baseVersion: 0,
      blocks: [{ type: 'paragraph', content: 'older edit' }],
      opId: 'op-poison'
    });
    await db.outbox.add({ ...poison, status: 'failed' });
    await db.outbox.add(updateNoteOutboxOperation({
      noteId: 'server-note-1',
      clientId: 'client-offline-1',
      baseVersion: 1,
      blocks: [{ type: 'paragraph', content: 'newest edit' }],
      opId: 'op-newest'
    }));

    const pushedOps: Array<ReturnType<typeof updateNoteOutboxOperation>> = [];
    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async (operations) => {
        pushedOps.push(...operations);
        return operations.map((operation) => ({ opId: operation.opId, status: 'updated' as const, noteId: 'server-note-1', version: 2 }));
      },
      pullChanges: async () => ({ notes: [] })
    });

    expect(pushedOps).toHaveLength(1);
    expect(pushedOps[0]).toMatchObject({ opId: 'op-poison', action: 'update', noteId: 'server-note-1', baseVersion: 1 });
    expect(pushedOps[0].payload.blocks).toEqual([{ type: 'paragraph', content: 'newest edit' }]);
    expect(pushedOps.some((operation) => operation.noteId === 'local-note-1')).toBe(false);
    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('重命名后以旧 id 入队的单条操作在同步开头被治愈并以当前 id 推送', async () => {
    // pull 失败导致界面未刷新时，用户编辑会以旧 id 入队且不构成 compaction 组
    await db.notes_cache.put({
      id: 'server-note-1',
      clientId: 'client-offline-1',
      blocks: [{ type: 'paragraph', content: 'server state' }],
      createdAt: '2026-05-27T00:00:00Z',
      updatedAt: '2026-05-27T00:00:00Z',
      version: 1
    });
    await db.outbox.add(updateNoteOutboxOperation({
      noteId: 'local-note-1',
      clientId: 'client-offline-1',
      baseVersion: 0,
      blocks: [{ type: 'paragraph', content: 'late edit' }],
      opId: 'op-stale-single'
    }));

    const pushedOps: Array<ReturnType<typeof updateNoteOutboxOperation>> = [];
    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async (operations) => {
        pushedOps.push(...operations);
        return [{ opId: 'op-stale-single', status: 'updated', noteId: 'server-note-1', version: 2 }];
      },
      pullChanges: async () => ({ notes: [] })
    });

    expect(pushedOps).toHaveLength(1);
    expect(pushedOps[0]).toMatchObject({ action: 'update', noteId: 'server-note-1', baseVersion: 1 });
    expect(pushedOps[0].payload.blocks).toEqual([{ type: 'paragraph', content: 'late edit' }]);
    expect(await db.outbox.toArray()).toHaveLength(0);
    expect((await db.notes_cache.get('server-note-1'))?.version).toBe(2);
  });

  test('同 clientId 的本地草稿陈旧记录被清理，权威 id 选择不被字典序更小的旧 id 污染', async () => {
    // 离线编辑曾以旧 id 重建 cache 记录：等值 clientId 内主键升序会先命中
    // local-note-*，治愈必须优先服务端记录并把幽灵记录清掉
    await db.notes_cache.put({
      id: 'server-note-1',
      clientId: 'client-offline-1',
      blocks: [{ type: 'paragraph', content: 'server state' }],
      createdAt: '2026-05-27T00:00:00Z',
      updatedAt: '2026-05-27T01:00:00Z',
      version: 1
    });
    await db.notes_cache.put({
      id: 'local-note-1',
      clientId: 'client-offline-1',
      blocks: [{ type: 'paragraph', content: 'stale ghost' }],
      createdAt: '2026-05-27T00:00:00Z',
      updatedAt: '2026-05-27T00:30:00Z',
      version: 0
    });
    await db.outbox.add(updateNoteOutboxOperation({
      noteId: 'local-note-1',
      clientId: 'client-offline-1',
      baseVersion: 0,
      blocks: [{ type: 'paragraph', content: 'older edit' }],
      opId: 'op-poison'
    }));
    await db.outbox.add(updateNoteOutboxOperation({
      noteId: 'server-note-1',
      clientId: 'client-offline-1',
      baseVersion: 1,
      blocks: [{ type: 'paragraph', content: 'newest edit' }],
      opId: 'op-newest'
    }));

    const pushedOps: Array<ReturnType<typeof updateNoteOutboxOperation>> = [];
    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async (operations) => {
        pushedOps.push(...operations);
        return operations.map((operation) => ({ opId: operation.opId, status: 'updated' as const, noteId: 'server-note-1', version: 2 }));
      },
      pullChanges: async () => ({ notes: [] })
    });

    const cachedNotes = await db.notes_cache.toArray();
    expect(cachedNotes).toHaveLength(1);
    expect(cachedNotes[0]).toMatchObject({ id: 'server-note-1', version: 2 });
    expect(pushedOps).toHaveLength(1);
    expect(pushedOps[0]).toMatchObject({ opId: 'op-poison', noteId: 'server-note-1', baseVersion: 1 });
    expect(pushedOps[0].payload.blocks).toEqual([{ type: 'paragraph', content: 'newest edit' }]);
    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('restore 操作随重命名回写 noteId 并推进 baseVersion', async () => {
    await createOfflineNote(db, {
      noteId: 'local-note-1',
      clientId: 'client-offline-1',
      blocks: [{ type: 'paragraph', content: 'draft' }],
      opId: 'op-create-restore-1'
    });

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async () => {
        // 推送期间以旧 id 入队的 restore（界面尚持旧 id 时从回收站恢复）
        await db.outbox.add(restoreNoteOutboxOperation({
          noteId: 'local-note-1',
          clientId: 'client-offline-1',
          baseVersion: 0,
          blocks: [{ type: 'paragraph', content: 'restored draft' }],
          opId: 'op-restore-stale'
        }));
        return [{ opId: 'op-create-restore-1', status: 'created', noteId: 'server-note-1', version: 1 }];
      },
      pullChanges: async () => ({ notes: [] })
    });

    const [pendingOp] = await db.outbox.toArray();
    expect(pendingOp.opId).toBe('op-restore-stale');
    expect(pendingOp.noteId).toBe('server-note-1');
    expect(pendingOp.baseVersion).toBe(1);
    expect(pendingOp.status).toBe('pending');

    const pushedOps: Array<ReturnType<typeof restoreNoteOutboxOperation>> = [];
    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async (operations) => {
        pushedOps.push(...operations);
        return [{ opId: 'op-restore-stale', status: 'restored', noteId: 'server-note-1', version: 2 }];
      },
      pullChanges: async () => ({ notes: [] })
    });

    expect(pushedOps).toHaveLength(1);
    expect(pushedOps[0]).toMatchObject({ action: 'restore', noteId: 'server-note-1', baseVersion: 1 });
    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('治愈后的 create+delete 草稿组取消时按当前 id 清理 cache 记录', async () => {
    // create 仍带旧 id（草稿推送从未成功），但同 clientId 的服务端记录已存在：
    // 取消草稿时必须删掉当前记录，而不是按旧 id 删空
    await db.notes_cache.put({
      id: 'server-note-1',
      clientId: 'client-offline-1',
      blocks: [{ type: 'paragraph', content: 'server state' }],
      createdAt: '2026-05-27T00:00:00Z',
      updatedAt: '2026-05-27T00:00:00Z',
      version: 1
    });
    await db.outbox.add(createNoteOutboxOperation({
      noteId: 'local-note-1',
      clientId: 'client-offline-1',
      blocks: [{ type: 'paragraph', content: 'draft' }],
      opId: 'op-create-stale'
    }));
    await db.outbox.add(updateNoteOutboxOperation({
      noteId: 'server-note-1',
      clientId: 'client-offline-1',
      baseVersion: 1,
      blocks: [{ type: 'paragraph', content: 'edit' }],
      opId: 'op-update-2'
    }));
    await db.outbox.add(deleteNoteOutboxOperation({
      noteId: 'server-note-1',
      clientId: 'client-offline-1',
      baseVersion: 1,
      opId: 'op-delete-draft-2'
    }));
    const pushOutbox = vi.fn(async () => []);

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox,
      pullChanges: async () => ({ notes: [] })
    });

    expect(pushOutbox).not.toHaveBeenCalled();
    expect(await db.outbox.toArray()).toHaveLength(0);
    expect(await db.notes_cache.toArray()).toHaveLength(0);
  });

  test('draftDeleted 组在权威 cache 记录缺失时回退为组内最新 noteId 清理', async () => {
    // cache 无该 clientId 记录时统一 id 回退为组内最新 noteId：按该 id 删 cache
    // 为空操作，但取消整组、不推送的语义不变
    await db.outbox.add(createNoteOutboxOperation({
      noteId: 'local-note-1',
      clientId: 'client-offline-1',
      blocks: [{ type: 'paragraph', content: 'draft' }],
      opId: 'op-create-fallback'
    }));
    await db.outbox.add(updateNoteOutboxOperation({
      noteId: 'local-note-2',
      clientId: 'client-offline-1',
      baseVersion: 0,
      blocks: [{ type: 'paragraph', content: 'edit' }],
      opId: 'op-update-fallback'
    }));
    await db.outbox.add(deleteNoteOutboxOperation({
      noteId: 'local-note-2',
      clientId: 'client-offline-1',
      baseVersion: 0,
      opId: 'op-delete-fallback'
    }));
    const pushOutbox = vi.fn(async () => []);

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox,
      pullChanges: async () => ({ notes: [] })
    });

    expect(pushOutbox).not.toHaveBeenCalled();
    expect(await db.outbox.toArray()).toHaveLength(0);
    expect(await db.notes_cache.toArray()).toHaveLength(0);
  });

  test('离线创建后删除会取消整组操作且不向服务端创建笔记', async () => {
    await createOfflineNote(db, {
      noteId: 'local-note-delete',
      clientId: 'client-offline-delete',
      blocks: [{ type: 'paragraph', content: 'discard me' }],
      opId: 'op-create-delete'
    });
    await db.outbox.add(deleteNoteOutboxOperation({
      noteId: 'local-note-delete',
      clientId: 'client-offline-delete',
      baseVersion: 0,
      opId: 'op-delete-draft'
    }));
    const pushOutbox = vi.fn(async () => []);

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox,
      pullChanges: async () => ({ notes: [] })
    });

    expect(pushOutbox).not.toHaveBeenCalled();
    expect(await db.notes_cache.get('local-note-delete')).toBeUndefined();
    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('同一远端笔记的多次离线更新只推送最后内容和原始版本', async () => {
    await db.outbox.add(updateNoteOutboxOperation({ noteId: 'n1', clientId: 'c1', baseVersion: 4, blocks: [{ type: 'paragraph', content: 'first' }], opId: 'op-first' }));
    await db.outbox.add(updateNoteOutboxOperation({ noteId: 'n1', clientId: 'c1', baseVersion: 4, blocks: [{ type: 'paragraph', content: 'last' }], opId: 'op-last' }));
    const pushed: Array<ReturnType<typeof updateNoteOutboxOperation>> = [];

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async (operations) => {
        pushed.push(...operations);
        return [{ opId: 'op-first', status: 'updated', noteId: 'n1', version: 5 }];
      },
      pullChanges: async () => ({ notes: [] })
    });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ opId: 'op-first', baseVersion: 4, action: 'update' });
    expect(pushed[0].payload.blocks).toEqual([{ type: 'paragraph', content: 'last' }]);
  });

  test('媒体优先上传：先上传 media，再替换 blocks.mediaId，最后 push note', async () => {
    const calls: string[] = [];

    await db.media_cache.put({
      id: 'm-local-media-1',
      localId: 'local-media-1',
      status: 'local_pending',
      blob: new NodeBlob(['png-bytes']),
      createdAt: '2026-05-27T00:00:00Z'
    });
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
    await db.sync_state.put({ key: 'cursor', value: { updatedAt: '2026-05-26T00:00:00Z', id: 'old-cursor' } });
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

    const pullChanges = vi.fn(async () => ({
      cursor: { updatedAt: '2026-05-27T01:00:01Z', id: 'n1' },
      notes: [
        {
          id: 'n1',
          clientId: 'client-1',
          blocks: [{ type: 'paragraph' as const, content: 'server text' }],
          updatedAt: '2026-05-27T01:00:01Z',
          createdAt: '2026-05-27T00:00:00Z',
          version: 2
        }
      ]
    }));

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
      pullChanges
    });

    const conflict = await db.notes_cache.get('conflict-1');
    const serverNote = await db.notes_cache.get('n1');

    expect(conflict?.conflictReason).toBe('version_conflict');
    expect(serverNote?.blocks).toEqual([{ type: 'paragraph', content: 'server text' }]);
    expect(pullChanges).toHaveBeenCalledWith(undefined);
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

  test('已有未过期 sync_lock 时不会修改 outbox 或执行 push', async () => {
    await db.sync_state.put({
      key: 'sync_lock',
      value: { owner: 'other-context', expiresAt: Date.now() + 30_000 }
    });
    await db.outbox.add({
      opId: 'op-lock-held-1',
      entity: 'note',
      action: 'create',
      clientId: 'client-1',
      baseVersion: 0,
      payload: { blocks: [{ type: 'paragraph', content: 'locked' }] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });
    const pushOutbox = vi.fn(async () => [{ opId: 'op-lock-held-1', status: 'created' }]);

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox,
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'cursor-locked' }, notes: [] })
    });

    const [op] = await db.outbox.toArray();
    expect(pushOutbox).not.toHaveBeenCalled();
    expect(op.status).toBe('pending');
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

    const [op] = await db.outbox.toArray();
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
      blob: new NodeBlob(['png-bytes']),
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

  test('后端返回 already_trashed 时视为成功并清理 outbox', async () => {
    await db.outbox.add({
      opId: 'op-already-trashed-1',
      entity: 'note',
      action: 'delete',
      clientId: 'client-1',
      noteId: 'n1',
      baseVersion: 1,
      payload: { blocks: [] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async () => [{ opId: 'op-already-trashed-1', status: 'already_trashed', noteId: 'n1', version: 2 }],
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'cursor-already-trashed' }, notes: [] })
    });

    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('返回 pull 拉到的变更笔记，供上层同步界面状态', async () => {
    const pulled = {
      id: 'n-remote',
      clientId: 'client-remote',
      blocks: [{ type: 'paragraph' as const, content: 'remote change' }],
      updatedAt: '2026-05-27T02:00:00Z',
      deletedAt: '2026-05-27T02:00:00Z',
      version: 4
    };

    const result = await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async () => [],
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T02:00:00Z', id: 'n-remote' }, notes: [pulled] })
    });

    expect(result).toEqual([pulled]);
  });

  test('后端返回 error 状态时保留 outbox 并在 lastError 记录 code', async () => {
    await db.outbox.add({
      opId: 'op-error-1',
      entity: 'note',
      action: 'delete',
      clientId: 'client-1',
      noteId: 'n1',
      baseVersion: 1,
      payload: { blocks: [] },
      createdAt: '2026-05-27T00:00:00Z',
      status: 'pending'
    });

    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'unused' }),
      pushOutbox: async () => [{ opId: 'op-error-1', status: 'error', code: 'note_not_found' }],
      pullChanges: async () => ({ cursor: { updatedAt: '2026-05-27T00:00:00Z', id: 'cursor-error' }, notes: [] })
    });

    const [op] = await db.outbox.toArray();
    expect(op.status).toBe('failed');
    expect(op.lastError).toBe('push_status:error:note_not_found');
  });

  test('离线粘贴的图片随笔记推送：从 media_cache 取 blob 上传，块改写为 mediaId 并回写缓存', async () => {
    await db.media_cache.put({
      id: 'local-media-1',
      localId: 'local-media-1',
      status: 'local_pending',
      blob: new NodeBlob(['png-bytes']),
      createdAt: '2026-05-27T00:00:00Z'
    });
    await db.outbox.add(createNoteOutboxOperation({
      noteId: 'local-note-offline-image',
      clientId: 'client-offline-image',
      blocks: [
        { type: 'paragraph', content: 'offline paste' },
        { type: 'image', localId: 'local-media-1', alt: 'paste.png' }
      ],
      opId: 'op-offline-image'
    }));

    const uploadCalls: Array<{ localId: string; url?: string }> = [];
    const pushedPayloads: unknown[] = [];
    await runSync({
      db,
      // 模拟 WorkspaceProvider.syncNow 的上传回调：从 media_cache 取 blob 上传
      uploadMedia: async (input) => {
        uploadCalls.push({ localId: input.localId, url: input.url });
        const cached = await db.media_cache.where('localId').equals(input.localId).first();
        if (!cached?.blob) throw new Error('local media is unavailable');
        return { mediaId: 'server-media-9' };
      },
      pushOutbox: async (operations) => {
        pushedPayloads.push(...operations.map((operation) => operation.payload));
        return [{ opId: 'op-offline-image', status: 'created', noteId: 'server-note-image', version: 1 }];
      },
      pullChanges: async () => ({ notes: [] })
    });

    expect(uploadCalls).toEqual([{ localId: 'local-media-1', url: undefined }]);
    expect(pushedPayloads[0]).toEqual({
      blocks: [
        { type: 'paragraph', content: 'offline paste' },
        { type: 'image', mediaId: 'server-media-9', alt: 'paste.png' }
      ]
    });
    const cachedMedia = await db.media_cache.where('localId').equals('local-media-1').first();
    expect(cachedMedia).toMatchObject({ serverId: 'server-media-9', status: 'uploaded' });
    expect(await db.outbox.toArray()).toHaveLength(0);
  });

  test('毒图：media_cache 记录缺失只失败该操作，其余操作照常推送且同步继续拉取', async () => {
    await db.outbox.add(createNoteOutboxOperation({
      noteId: 'local-note-poison',
      clientId: 'client-poison',
      blocks: [{ type: 'image', localId: 'local-media-missing', alt: 'ghost.png' }],
      opId: 'op-poison-image'
    }));
    await db.outbox.add(createNoteOutboxOperation({
      noteId: 'local-note-healthy',
      clientId: 'client-healthy',
      blocks: [{ type: 'paragraph', content: 'healthy note' }],
      opId: 'op-healthy'
    }));

    const pushedOpIds: string[] = [];
    const pullChanges = vi.fn(async () => ({ notes: [] }));
    await runSync({
      db,
      uploadMedia: async () => {
        throw new Error('upload must not be attempted for missing media');
      },
      pushOutbox: async (operations) => {
        pushedOpIds.push(...operations.map((operation) => operation.opId));
        return operations.map((operation) => ({ opId: operation.opId, status: 'created' as const, noteId: `server-${operation.opId}`, version: 1 }));
      },
      pullChanges
    });

    expect(pushedOpIds).toEqual(['op-healthy']);
    const operations = await db.outbox.toArray();
    expect(operations.find((operation) => operation.opId === 'op-poison-image')).toMatchObject({ status: 'failed', lastError: 'local_media_unavailable' });
    expect(operations.find((operation) => operation.opId === 'op-healthy')).toBeUndefined();
    expect(pullChanges).toHaveBeenCalledTimes(1);
  });

  test('毒图：blob 为空（size 0）同样只失败该操作，有效图片正常上传', async () => {
    await db.media_cache.put({ id: 'local-media-empty', localId: 'local-media-empty', status: 'local_pending', blob: new NodeBlob([]), createdAt: '2026-05-27T00:00:00Z' });
    await db.media_cache.put({ id: 'local-media-ok', localId: 'local-media-ok', status: 'local_pending', blob: new NodeBlob(['png-bytes']), createdAt: '2026-05-27T00:00:00Z' });
    await db.outbox.add(createNoteOutboxOperation({
      noteId: 'local-note-empty-image',
      clientId: 'client-empty-image',
      blocks: [{ type: 'image', localId: 'local-media-empty', alt: 'empty.png' }],
      opId: 'op-empty-image'
    }));
    await db.outbox.add(createNoteOutboxOperation({
      noteId: 'local-note-ok-image',
      clientId: 'client-ok-image',
      blocks: [{ type: 'image', localId: 'local-media-ok', alt: 'ok.png' }],
      opId: 'op-ok-image'
    }));

    const pushedOpIds: string[] = [];
    await runSync({
      db,
      uploadMedia: async () => ({ mediaId: 'server-media-7' }),
      pushOutbox: async (operations) => {
        pushedOpIds.push(...operations.map((operation) => operation.opId));
        return operations.map((operation) => ({ opId: operation.opId, status: 'created' as const, noteId: `server-${operation.opId}`, version: 1 }));
      },
      pullChanges: async () => ({ notes: [] })
    });

    expect(pushedOpIds).toEqual(['op-ok-image']);
    const operations = await db.outbox.toArray();
    expect(operations.find((operation) => operation.opId === 'op-empty-image')).toMatchObject({ status: 'failed', lastError: 'local_media_unavailable' });
    expect(operations.find((operation) => operation.opId === 'op-ok-image')).toBeUndefined();
    expect((await db.media_cache.where('localId').equals('local-media-ok').first())?.serverId).toBe('server-media-7');
  });
});
