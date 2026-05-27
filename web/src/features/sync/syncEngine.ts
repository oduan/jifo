import { CachedNote, CachedNoteBlock, JifoDb, OutboxOperation } from '../../storage/db';

export type MediaUploadInput = {
  localId: string;
  url?: string;
};

export type MediaUploadResult = {
  mediaId: string;
};

export type PushResult = {
  opId: string;
  status: 'created' | 'updated' | 'deleted' | 'restored' | 'delete_conflict_ignored' | 'conflict_copied' | 'duplicate' | string;
  noteId?: string;
  version?: number;
  note?: CachedNote;
};

export type PullCursor = {
  updatedAt: string;
  id: string;
};

export type PullChangesResult = {
  cursor: PullCursor;
  notes: CachedNote[];
};

export type SyncEngineOptions = {
  db: JifoDb;
  uploadMedia: (input: MediaUploadInput) => Promise<MediaUploadResult>;
  pushOutbox: (operations: OutboxOperation[]) => Promise<PushResult[]>;
  pullChanges: (cursor?: PullCursor) => Promise<PullChangesResult>;
};

const runningSyncDbNames = new Set<string>();
const successfulPushStatuses = new Set(['created', 'updated', 'deleted', 'restored', 'delete_conflict_ignored', 'conflict_copied', 'duplicate']);

function isLocalImageBlock(block: CachedNoteBlock): block is Extract<CachedNoteBlock, { type: 'image' }> & { localId: string } {
  return block.type === 'image' && Boolean(block.localId) && !block.mediaId;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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

async function persistOperationPayload(db: JifoDb, operation: OutboxOperation) {
  if (operation.localSeq !== undefined) {
    await db.outbox.update(operation.localSeq, { payload: operation.payload });
  }
}

async function uploadLocalMediaForOperation(db: JifoDb, operation: OutboxOperation, uploadMedia: SyncEngineOptions['uploadMedia']): Promise<OutboxOperation> {
  const blocks = operation.payload.blocks;
  if (!blocks) {
    return operation;
  }

  let changed = false;
  const rewrittenBlocks: CachedNoteBlock[] = [];
  for (const block of blocks) {
    if (isLocalImageBlock(block)) {
      const cachedMedia = await db.media_cache.where('localId').equals(block.localId).first();
      const existingServerId = cachedMedia?.serverId;
      const mediaId = existingServerId ?? (await uploadMedia({ localId: block.localId, url: block.url })).mediaId;
      if (cachedMedia && cachedMedia.serverId !== mediaId) {
        await db.media_cache.put({ ...cachedMedia, serverId: mediaId, status: 'uploaded' });
      }
      rewrittenBlocks.push({ type: 'image', mediaId, alt: block.alt });
      changed = true;
      continue;
    }
    rewrittenBlocks.push(block);
  }

  if (!changed) {
    return operation;
  }

  const rewrittenOperation = {
    ...operation,
    payload: {
      ...operation.payload,
      blocks: rewrittenBlocks
    }
  };
  await persistOperationPayload(db, rewrittenOperation);
  return rewrittenOperation;
}

async function applyPushResult(db: JifoDb, result: PushResult) {
  if (result.status === 'conflict_copied' && result.note) {
    await db.notes_cache.put(result.note);
  }
}

async function settlePushedOperations(db: JifoDb, selectedOps: OutboxOperation[], pushResults: PushResult[]) {
  const resultsByOpId = new Map(pushResults.map((result) => [result.opId, result]));
  await db.transaction('rw', db.outbox, async () => {
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
        await db.outbox.delete(op.localSeq);
        continue;
      }
      await db.outbox.update(op.localSeq, { status: 'failed', lastError: `push_status:${result.status}` });
    }
  });
}

async function applyPullChanges(db: JifoDb, changes: PullChangesResult) {
  for (const note of changes.notes) {
    await db.notes_cache.put(note);
  }
  await db.sync_state.put({ key: 'cursor', value: changes.cursor });
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

export async function runSync({ db, uploadMedia, pushOutbox, pullChanges }: SyncEngineOptions) {
  const lockName = db.name;
  if (runningSyncDbNames.has(lockName)) {
    return;
  }
  runningSyncDbNames.add(lockName);

  try {
    const recoveredCount = await recoverInterruptedPushing(db);
    const selectedOps = recoveredCount > 0 ? [] : await db.outbox.where('status').anyOf('pending', 'failed').sortBy('localSeq');
    await markOperations(db, selectedOps, 'pushing');

    const pushableOps: OutboxOperation[] = [];
    try {
      for (const op of selectedOps) {
        pushableOps.push(await uploadLocalMediaForOperation(db, { ...op, status: 'pushing' }, uploadMedia));
      }

      if (pushableOps.length > 0) {
        const pushResults = await pushOutbox(pushableOps);
        for (const result of pushResults) {
          await applyPushResult(db, result);
        }
        await settlePushedOperations(db, selectedOps, pushResults);
      }
    } catch (error) {
      await markOperations(db, selectedOps, 'failed', errorMessage(error));
      throw error;
    }

    const cursor = readCursor((await db.sync_state.get('cursor'))?.value);
    const changes = await pullChanges(cursor);
    await applyPullChanges(db, changes);
  } catch (error) {
    await markPushingAsFailed(db, errorMessage(error));
    throw error;
  } finally {
    runningSyncDbNames.delete(lockName);
  }
}
