import { CachedNote, CachedNoteBlock, JifoDb, OutboxAction, OutboxOperation } from '../../storage/db';

type BaseNoteOperationInput = {
  noteId?: string;
  clientId: string;
  baseVersion?: number;
  blocks?: CachedNoteBlock[];
  createdAt?: string;
  opId?: string;
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
