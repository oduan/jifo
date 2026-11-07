import { CachedNote, CachedNoteBlock, JifoDb, OutboxOperation } from '../../storage/db';
import { findAuthoritativeCachedNote, isLocalDraftNoteId } from './outbox';

export type MediaUploadInput = {
  localId: string;
  url?: string;
};

export type MediaUploadResult = {
  mediaId: string;
};

// push 操作的已知返回状态；服务端返回的未知值在边界处归一为 'unknown'。
export const PUSH_STATUSES = [
  'created',
  'updated',
  'deleted',
  'restored',
  'delete_conflict_ignored',
  'conflict_copied',
  'duplicate',
  'already_trashed',
  'error'
] as const;

export type PushStatus = (typeof PUSH_STATUSES)[number] | 'unknown';

// 视为成功并可从 outbox 移除的状态；'error' 与 'unknown' 不在其中。
const SUCCESSFUL_PUSH_STATUSES: readonly PushStatus[] = [
  'created',
  'updated',
  'deleted',
  'restored',
  'delete_conflict_ignored',
  'conflict_copied',
  'duplicate',
  'already_trashed'
];

export function normalizePushStatus(status: string): PushStatus {
  return (PUSH_STATUSES as readonly string[]).includes(status) ? (status as PushStatus) : 'unknown';
}

export type PushResult = {
  opId: string;
  status: PushStatus;
  code?: string;
  noteId?: string;
  version?: number;
  note?: CachedNote;
};

export type PullCursor = {
  updatedAt: string;
  id: string;
};

export type PullChangesResult = {
  cursor?: PullCursor;
  notes: CachedNote[];
};

export type SyncEngineOptions = {
  db: JifoDb;
  uploadMedia: (input: MediaUploadInput) => Promise<MediaUploadResult>;
  pushOutbox: (operations: OutboxOperation[]) => Promise<PushResult[]>;
  pullChanges: (cursor?: PullCursor) => Promise<PullChangesResult>;
};

const runningSyncDbNames = new Set<string>();
const successfulPushStatuses = new Set<PushStatus>(SUCCESSFUL_PUSH_STATUSES);
const syncLockKey = 'sync_lock';
const syncLockTtlMs = 30_000;

type SyncLock = {
  owner: string;
  expiresAt: number;
};

function isLocalImageBlock(block: CachedNoteBlock): block is Extract<CachedNoteBlock, { type: 'image' }> & { localId: string } {
  return block.type === 'image' && Boolean(block.localId) && !block.mediaId;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function newLockOwner() {
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `sync-${randomId}`;
}

function readSyncLock(value: unknown): SyncLock | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const lock = value as Partial<SyncLock>;
  if (typeof lock.owner !== 'string' || typeof lock.expiresAt !== 'number') {
    return undefined;
  }
  return { owner: lock.owner, expiresAt: lock.expiresAt };
}

async function acquireSyncLock(db: JifoDb): Promise<string | undefined> {
  const owner = newLockOwner();
  const now = Date.now();
  let acquired = false;

  await db.transaction('rw', db.sync_state, async () => {
    const current = readSyncLock((await db.sync_state.get(syncLockKey))?.value);
    if (current && current.expiresAt > now) {
      return;
    }
    await db.sync_state.put({ key: syncLockKey, value: { owner, expiresAt: now + syncLockTtlMs } });
    acquired = true;
  });

  if (!acquired) {
    return undefined;
  }

  const confirmed = readSyncLock((await db.sync_state.get(syncLockKey))?.value);
  return confirmed?.owner === owner ? owner : undefined;
}

async function refreshSyncLock(db: JifoDb, owner: string) {
  let refreshed = false;
  await db.transaction('rw', db.sync_state, async () => {
    const current = readSyncLock((await db.sync_state.get(syncLockKey))?.value);
    if (current?.owner !== owner) {
      return;
    }
    await db.sync_state.put({ key: syncLockKey, value: { owner, expiresAt: Date.now() + syncLockTtlMs } });
    refreshed = true;
  });
  return refreshed;
}

async function ensureSyncLock(db: JifoDb, owner: string) {
  if (!(await refreshSyncLock(db, owner))) {
    throw new Error('sync lock lost');
  }
}

async function releaseSyncLock(db: JifoDb, owner: string | undefined) {
  if (!owner) {
    return;
  }
  await db.transaction('rw', db.sync_state, async () => {
    const current = readSyncLock((await db.sync_state.get(syncLockKey))?.value);
    if (current?.owner === owner) {
      await db.sync_state.delete(syncLockKey);
    }
  });
}

async function markOperations(db: JifoDb, operations: OutboxOperation[], status: 'pushing' | 'failed', lastError?: string) {
  await db.transaction('rw', db.outbox, async () => {
    for (const op of operations) {
      if (op.localSeq !== undefined) {
        await db.outbox.update(op.localSeq, { status, lastError });
      }
    }
  });
}

async function compactPendingOperations(db: JifoDb) {
  const operations = await db.outbox.where('status').anyOf('pending', 'failed').sortBy('localSeq');
  const groups = new Map<string, OutboxOperation[]>();
  for (const operation of operations) {
    const key = `${operation.entity}:${operation.clientId}`;
    groups.set(key, [...(groups.get(key) ?? []), operation]);
  }

  await db.transaction('rw', db.outbox, db.notes_cache, async () => {
    for (const group of groups.values()) {
      if (group.length < 2) continue;

      const first = group[0];
      const firstSeq = first.localSeq;
      if (firstSeq === undefined) continue;
      const pendingCreate = first.action === 'create';
      // 含 delete/restore 的组不参与合并（合并语义只对 create/update 成立）；
      // 组内残留的旧 id 操作由 healStaleNoteIds 在推送前统一改写，按各自语义独立推送
      if (!pendingCreate && group.some((operation) => operation.action !== 'update')) {
        continue;
      }

      // 组内操作共享 clientId、指向同一条逻辑笔记，但 noteId 可能新旧不一：
      // 本地草稿推送成功后 id 从 local-note-* 换成服务端 UUID，历史遗留数据
      // （或迁移窗口期 UI 仍持旧 id 入队的编辑）会让同组同时存在两个 id。
      // 旧 id 操作推送时会被后端 UUID 解析拒绝；若把后续 payload 合并进组内
      // 第一条（旧 id 的毒丸操作），最新编辑会跟着它一起永久丢失。
      // 这里选择“统一到权威 id”而不是跳过合并：权威 id 优先取 notes_cache 中
      // 该 clientId 记录的当前 id（cache 重命名与 outbox 回写在同一事务发生，
      // cache 是当前 id 的权威来源，且不依赖新旧操作的先后顺序），cache 无
      // 记录时回退为组内最新一条操作的 noteId。统一后遗留毒丸操作被治愈：
      // 合并结果以服务端 UUID 推送成功，而不是永远 failed。
      const distinctNoteIds = new Set(group.map((operation) => operation.noteId));
      let unifiedNoteId: string | undefined;
      let unifiedBaseVersion: number | undefined;
      if (distinctNoteIds.size > 1) {
        const cachedNote = await findAuthoritativeCachedNote(db, first.clientId);
        unifiedNoteId = cachedNote?.id ?? [...group].reverse().find((operation) => operation.noteId !== undefined)?.noteId;
        // create 的 baseVersion 不参与服务端冲突判断；update/restore 统一后以
        // cache 当前版本为准（只增不减），避免合并结果因陈旧 baseVersion 被
        // 判冲突而生成伪冲突副本。
        if (!pendingCreate && cachedNote?.version !== undefined) {
          unifiedBaseVersion = Math.max(first.baseVersion, cachedNote.version);
        }
      }

      let draftDeleted = false;
      let payload = first.payload;

      for (const operation of group.slice(1)) {
        if (pendingCreate) {
          if (operation.action === 'delete') {
            draftDeleted = true;
          } else if (operation.action === 'restore') {
            draftDeleted = false;
            payload = operation.payload;
          } else if (operation.action === 'update') {
            payload = operation.payload;
          }
          continue;
        }

        if (operation.payload.blocks) {
          payload = operation.payload;
        }
      }

      if (pendingCreate && draftDeleted) {
        for (const operation of group) {
          if (operation.localSeq !== undefined) await db.outbox.delete(operation.localSeq);
        }
        const draftNoteId = unifiedNoteId ?? first.noteId;
        if (draftNoteId) await db.notes_cache.delete(draftNoteId);
        continue;
      }

      await db.outbox.update(firstSeq, {
        action: pendingCreate ? 'create' : 'update',
        payload,
        status: 'pending',
        lastError: undefined,
        ...(unifiedNoteId !== undefined && unifiedNoteId !== first.noteId ? { noteId: unifiedNoteId } : {}),
        ...(unifiedBaseVersion !== undefined && unifiedBaseVersion !== first.baseVersion ? { baseVersion: unifiedBaseVersion } : {})
      });
      for (const operation of group.slice(1)) {
        if (operation.localSeq !== undefined) await db.outbox.delete(operation.localSeq);
      }
    }
  });
}

// 毒丸可再生路径的兜底：重命名之后 UI 仍可能持旧 id（如同一次 runSync 的 pull
// 失败会让 refreshSilently 不执行，WorkspaceProvider 静默吞掉该错误），用户随后
// 的离线编辑会以 local-note-* 旧 id 入队，且这种单条操作不构成 compaction 组。
// 每次同步开头统一清理与治愈：
// ① 同 clientId 并存的本地草稿陈旧记录（被离线编辑以旧 id put 重建）先并回较新
//    内容再删除——其未落库的编辑同时由对应 outbox 操作携带，删除不丢数据，只
//    消除权威 id 选择与离线兜底渲染的旧 id 污染；
// ② noteId 已不在 cache、但 clientId 能命中 cache 记录的操作改写为当前 id，
//    update/restore 的 baseVersion 推进到该记录 version（只增不减），避免治愈后
//    因陈旧 baseVersion 触发伪冲突副本。delete 的 baseVersion 不推进：后端对
//    删除的版本冲突按 delete_conflict_ignored 策略忽略，属既有设计。
// 需在 recoverInterruptedPushing 之后、compactPendingOperations 之前执行，让被
// 恢复成 failed 的操作也进入治愈范围。
async function healStaleNoteIds(db: JifoDb) {
  const operations = await db.outbox.where('status').anyOf('pending', 'failed').toArray();
  await db.transaction('rw', db.notes_cache, db.outbox, async () => {
    const cachedNotes = await db.notes_cache.toArray();
    const notesByClientId = new Map<string, CachedNote[]>();
    for (const note of cachedNotes) {
      notesByClientId.set(note.clientId, [...(notesByClientId.get(note.clientId) ?? []), note]);
    }
    for (const notes of notesByClientId.values()) {
      if (notes.length < 2) continue;
      const kept = notes.find((note) => !isLocalDraftNoteId(note.id)) ?? notes[0];
      for (const stale of notes) {
        if (stale.id === kept.id) continue;
        if (stale.updatedAt > kept.updatedAt) {
          await db.notes_cache.put({ ...kept, blocks: stale.blocks, updatedAt: stale.updatedAt });
        }
        await db.notes_cache.delete(stale.id);
      }
    }
    for (const operation of operations) {
      if (!operation.noteId || operation.localSeq === undefined) continue;
      if (await db.notes_cache.get(operation.noteId)) continue;
      const cachedNote = await findAuthoritativeCachedNote(db, operation.clientId);
      if (!cachedNote || cachedNote.id === operation.noteId) continue;
      if (operation.action === 'update' || operation.action === 'restore') {
        await db.outbox.update(operation.localSeq, { noteId: cachedNote.id, baseVersion: Math.max(operation.baseVersion, cachedNote.version ?? 0) });
      } else {
        await db.outbox.update(operation.localSeq, { noteId: cachedNote.id });
      }
    }
  });
}

async function persistOperationPayload(db: JifoDb, operation: OutboxOperation) {
  if (operation.localSeq !== undefined) {
    await db.outbox.update(operation.localSeq, { payload: operation.payload });
  }
}

// 本地媒体准备结果:poisonError 存在时该操作是"毒图"操作,不得进入本批推送。
type MediaPreparation = {
  operation: OutboxOperation;
  poisonError?: string;
};

// 推送前先把操作里的本地图片上传并改写为 mediaId。media_cache 记录缺失、或
// 尚无 serverId 且 blob 为空/缺失时,本地已取不回图片内容("毒图"):继续推送
// 会让上传回调抛错并把整批操作一起拖垮(或把无内容的 image block 写上服务端)。
// 此时把 poisonError 报给调用方,只失败该操作,其余操作照常推送。
async function uploadLocalMediaForOperation(db: JifoDb, operation: OutboxOperation, uploadMedia: SyncEngineOptions['uploadMedia']): Promise<MediaPreparation> {
  const blocks = operation.payload.blocks;
  if (!blocks) {
    return { operation };
  }

  let changed = false;
  const rewrittenBlocks: CachedNoteBlock[] = [];
  for (const block of blocks) {
    if (isLocalImageBlock(block)) {
      const cachedMedia = await db.media_cache.where('localId').equals(block.localId).first();
      if (!cachedMedia || (!cachedMedia.serverId && (!cachedMedia.blob || cachedMedia.blob.size === 0))) {
        return { operation, poisonError: 'local_media_unavailable' };
      }
      const existingServerId = cachedMedia.serverId;
      const mediaId = existingServerId ?? (await uploadMedia({ localId: block.localId, url: block.url })).mediaId;
      if (cachedMedia.serverId !== mediaId) {
        await db.media_cache.put({ ...cachedMedia, serverId: mediaId, status: 'uploaded' });
      }
      rewrittenBlocks.push({ type: 'image', mediaId, alt: block.alt });
      changed = true;
      continue;
    }
    rewrittenBlocks.push(block);
  }

  if (!changed) {
    return { operation };
  }

  const rewrittenOperation = {
    ...operation,
    payload: {
      ...operation.payload,
      blocks: rewrittenBlocks
    }
  };
  await persistOperationPayload(db, rewrittenOperation);
  return { operation: rewrittenOperation };
}

async function applyPushResult(db: JifoDb, result: PushResult) {
  if (result.status === 'conflict_copied' && result.note) {
    await db.notes_cache.put(result.note);
  }
}

// 本地草稿推送成功后，notes_cache 的 id 会从 local-note-* 换成服务端 UUID。
// outbox 里仍指向旧 id 的操作（同批推送中被后端拒绝的兄弟操作、推送期间新
// 入队的编辑）必须一并改写，否则它们重试时会带着非 UUID 的 noteId 被后端
// 解析拒绝（api.ts 只对 create 省略 noteId；后端对非法 noteId 返回
// error/bad_request），永久停留在 failed。update/restore 的 baseVersion 同时
// 推进到服务端返回的 version，避免重试时被判版本冲突生成伪冲突副本。
// 不筛 status：同批兄弟操作此时仍是 pushing，同样带着旧 id，必须一起改写。
// 由调用方 settlePushedOperations 持有事务，与 notes_cache 重命名原子生效。
async function remapOutboxNoteId(db: JifoDb, oldNoteId: string, nextNoteId: string, version?: number) {
  const staleOperations = await db.outbox.filter((operation) => operation.noteId === oldNoteId).toArray();
  for (const operation of staleOperations) {
    if (operation.localSeq === undefined) {
      continue;
    }
    if (version !== undefined && (operation.action === 'update' || operation.action === 'restore')) {
      await db.outbox.update(operation.localSeq, { noteId: nextNoteId, baseVersion: version });
    } else {
      await db.outbox.update(operation.localSeq, { noteId: nextNoteId });
    }
  }
}

async function applySuccessfulPushMetadata(db: JifoDb, op: OutboxOperation, result: PushResult) {
  if (result.status === 'conflict_copied' || !op.noteId || (!result.noteId && result.version === undefined)) {
    return;
  }

  const localNote = await db.notes_cache.get(op.noteId);
  if (!localNote) {
    return;
  }

  const nextId = result.noteId ?? localNote.id;
  const updatedNote = {
    ...localNote,
    id: nextId,
    version: result.version ?? localNote.version
  };

  if (nextId !== localNote.id) {
    await db.notes_cache.delete(localNote.id);
    await remapOutboxNoteId(db, localNote.id, nextId, result.version);
  }
  await db.notes_cache.put(updatedNote);
}

async function settlePushedOperations(db: JifoDb, selectedOps: OutboxOperation[], pushResults: PushResult[]) {
  const resultsByOpId = new Map(pushResults.map((result) => [result.opId, result]));
  await db.transaction('rw', db.outbox, db.notes_cache, async () => {
    for (const op of selectedOps) {
      if (op.localSeq === undefined) {
        continue;
      }
      const result = resultsByOpId.get(op.opId);
      if (!result) {
        await db.outbox.update(op.localSeq, { status: 'failed', lastError: 'missing_push_result' });
        continue;
      }
      if (successfulPushStatuses.has(result.status)) {
        await applySuccessfulPushMetadata(db, op, result);
        await db.outbox.delete(op.localSeq);
        continue;
      }
      const lastError = result.code ? `push_status:${result.status}:${result.code}` : `push_status:${result.status}`;
      await db.outbox.update(op.localSeq, { status: 'failed', lastError });
    }
  });
}

async function applyPullChanges(db: JifoDb, changes: PullChangesResult) {
  for (const note of changes.notes) {
    if (note.permanentlyDeletedAt) {
      // 同 clientId 的本地草稿陈旧记录一并清除，避免离线兜底渲染残留幽灵卡
      await db.notes_cache.where('clientId').equals(note.clientId).delete();
      const related = await db.outbox.filter((operation) => operation.noteId === note.id || operation.clientId === note.clientId).toArray();
      for (const operation of related) {
        if (operation.localSeq !== undefined) await db.outbox.delete(operation.localSeq);
      }
    } else {
      await db.notes_cache.put(note);
    }
  }
  if (changes.cursor) {
    await db.sync_state.put({ key: 'cursor', value: changes.cursor });
  }
}

function readCursor(value: unknown): PullCursor | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const cursor = value as Partial<PullCursor>;
  if (typeof cursor.updatedAt !== 'string' || typeof cursor.id !== 'string') {
    return undefined;
  }
  return { updatedAt: cursor.updatedAt, id: cursor.id };
}

async function markPushingAsFailed(db: JifoDb, lastError: string) {
  const pushingOps = await db.outbox.where('status').equals('pushing').toArray();
  await markOperations(db, pushingOps, 'failed', lastError);
}

async function recoverInterruptedPushing(db: JifoDb) {
  const pushingOps = await db.outbox.where('status').equals('pushing').toArray();
  await markOperations(db, pushingOps, 'failed', 'interrupted_sync');
  return pushingOps.length;
}

// 返回拉取到的变更笔记（含删除/恢复标记），供调用方把远端删除精确同步到界面状态；
// 同步被跳过（锁冲突/并发）时返回 undefined。
export async function runSync({ db, uploadMedia, pushOutbox, pullChanges }: SyncEngineOptions): Promise<CachedNote[] | undefined> {
  const lockName = db.name;
  if (runningSyncDbNames.has(lockName)) {
    return undefined;
  }
  runningSyncDbNames.add(lockName);
  let lockOwner: string | undefined;

  try {
    lockOwner = await acquireSyncLock(db);
    if (!lockOwner) {
      return undefined;
    }
    await ensureSyncLock(db, lockOwner);
    const recoveredCount = await recoverInterruptedPushing(db);
    await healStaleNoteIds(db);
    if (recoveredCount === 0) {
      await compactPendingOperations(db);
    }
    const selectedOps = recoveredCount > 0 ? [] : await db.outbox.where('status').anyOf('pending', 'failed').sortBy('localSeq');
    await markOperations(db, selectedOps, 'pushing');

    const pushableOps: OutboxOperation[] = [];
    // 进入本批推送的操作(毒图操作被剔除后不参与 push 与结果回写,避免被
    // settlePushedOperations 以 missing_push_result 覆盖掉毒图专用的 lastError)。
    const pushedSelection: OutboxOperation[] = [];
    try {
      for (const op of selectedOps) {
        const { operation, poisonError } = await uploadLocalMediaForOperation(db, { ...op, status: 'pushing' }, uploadMedia);
        if (poisonError) {
          // 毒图只失败本条操作:标记 failed + 原因后从本批剔除,其余操作照常
          // 推送,runSync 不因单张图片中断。
          await markOperations(db, [op], 'failed', poisonError);
          continue;
        }
        pushableOps.push(operation);
        pushedSelection.push(op);
      }

      if (pushableOps.length > 0) {
        await ensureSyncLock(db, lockOwner);
        const pushResults = await pushOutbox(pushableOps);
        for (const result of pushResults) {
          await applyPushResult(db, result);
        }
        await settlePushedOperations(db, pushedSelection, pushResults);
        if (pushResults.some((result) => result.status === 'conflict_copied' || result.status === 'delete_conflict_ignored')) {
          // A pending local mutation may have skipped the newer server row
          // while still advancing the cursor. Reconcile from the beginning so
          // the original note cannot remain as stale optimistic content.
          await db.sync_state.delete('cursor');
        }
      }
    } catch (error) {
      await markOperations(db, pushedSelection, 'failed', errorMessage(error));
      throw error;
    }

    await ensureSyncLock(db, lockOwner);
    const cursor = readCursor((await db.sync_state.get('cursor'))?.value);
    const changes = await pullChanges(cursor);
    await applyPullChanges(db, changes);
    return changes.notes;
  } catch (error) {
    await markPushingAsFailed(db, errorMessage(error));
    throw error;
  } finally {
    await releaseSyncLock(db, lockOwner);
    runningSyncDbNames.delete(lockName);
  }
}
