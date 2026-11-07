import { CachedNote, CachedNoteBlock, JifoDb, OutboxAction, OutboxOperation } from '../../storage/db';

type BaseNoteOperationInput = {
  noteId?: string;
  clientId: string;
  baseVersion?: number;
  blocks?: CachedNoteBlock[];
  createdAt?: string;
  opId?: string;
  /** 见 OutboxOperation.force:推送时省略 baseVersion,服务端强制应用。 */
  force?: boolean;
};

type CreateOfflineNoteInput = {
  noteId?: string;
  clientId: string;
  blocks: CachedNoteBlock[];
  createdAt?: string;
  opId?: string;
};

function newId(prefix: string) {
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

// 本地草稿的 note id 前缀（createOfflineNote 生成）。重命名发生后，cache/outbox
// 中残留的 local-note-* 都属于已被服务端 UUID 取代的旧身份。
export function isLocalDraftNoteId(id: string) {
  return id.startsWith('local-note-');
}

// 同一 clientId 在 notes_cache 里可能并存两条记录：服务端 UUID 记录，以及重命名
// 后被离线编辑以旧 id put 重建的 local-note-* 记录。等值 clientId 的索引游标按
// 主键（id）升序返回，local-note-* 字典序小于 UUID 会先命中陈旧记录，因此显式
// 优先非本地草稿记录；无法区分时退回第一条。
export async function findAuthoritativeCachedNote(db: JifoDb, clientId: string): Promise<CachedNote | undefined> {
  const candidates = await db.notes_cache.where('clientId').equals(clientId).toArray();
  if (candidates.length <= 1) {
    return candidates[0];
  }
  return candidates.find((note) => !isLocalDraftNoteId(note.id)) ?? candidates[0];
}

function nowIso() {
  return new Date().toISOString();
}

function noteOperation(action: OutboxAction, input: BaseNoteOperationInput): OutboxOperation {
  return {
    opId: input.opId ?? newId('op'),
    entity: 'note',
    action,
    noteId: input.noteId,
    clientId: input.clientId,
    baseVersion: input.baseVersion ?? 0,
    ...(input.force ? { force: true } : {}),
    payload: input.blocks ? { blocks: input.blocks } : {},
    createdAt: input.createdAt ?? nowIso(),
    status: 'pending'
  };
}

export function createNoteOutboxOperation(input: BaseNoteOperationInput & { blocks: CachedNoteBlock[] }) {
  return noteOperation('create', { ...input, baseVersion: input.baseVersion ?? 0 });
}

export function updateNoteOutboxOperation(input: BaseNoteOperationInput & { noteId: string; blocks: CachedNoteBlock[] }) {
  return noteOperation('update', input);
}

export function deleteNoteOutboxOperation(input: BaseNoteOperationInput & { noteId: string }) {
  return noteOperation('delete', input);
}

export function restoreNoteOutboxOperation(input: BaseNoteOperationInput & { noteId: string; blocks: CachedNoteBlock[] }) {
  return noteOperation('restore', input);
}

export async function enqueueOutboxOperation(db: JifoDb, operation: OutboxOperation) {
  return db.outbox.add(operation);
}

export async function createOfflineNote(db: JifoDb, input: CreateOfflineNoteInput): Promise<{ note: CachedNote; operation: OutboxOperation }> {
  const createdAt = input.createdAt ?? nowIso();
  const note: CachedNote = {
    id: input.noteId ?? newId('local-note'),
    clientId: input.clientId,
    blocks: input.blocks,
    createdAt,
    updatedAt: createdAt,
    version: 0
  };
  const operation = createNoteOutboxOperation({
    noteId: note.id,
    clientId: input.clientId,
    blocks: input.blocks,
    createdAt,
    opId: input.opId
  });

  await db.transaction('rw', db.notes_cache, db.outbox, async () => {
    await db.notes_cache.put(note);
    await db.outbox.add(operation);
  });

  return { note, operation };
}
