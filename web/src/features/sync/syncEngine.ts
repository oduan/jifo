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
  status: 'created' | 'updated' | 'deleted' | 'restored' | 'delete_conflict_ignored' | 'conflict_copied' | string;
  noteId?: string;
  version?: number;
  note?: CachedNote;
};

export type PullChangesResult = {
  cursor: string;
  notes: CachedNote[];
};

export type SyncEngineOptions = {
  db: JifoDb;
  uploadMedia: (input: MediaUploadInput) => Promise<MediaUploadResult>;
  pushOutbox: (operations: OutboxOperation[]) => Promise<PushResult[]>;
  pullChanges: (cursor?: unknown) => Promise<PullChangesResult>;
};

function isLocalImageBlock(block: CachedNoteBlock): block is Extract<CachedNoteBlock, { type: 'image' }> & { localId: string } {
  return block.type === 'image' && Boolean(block.localId) && !block.mediaId;
}

async function uploadLocalMediaForOperation(db: JifoDb, operation: OutboxOperation, uploadMedia: SyncEngineOptions['uploadMedia']): Promise<OutboxOperation> {
  const blocks = operation.payload.blocks;
  if (!blocks) {
    return operation;
  }

  const rewrittenBlocks: CachedNoteBlock[] = [];
  for (const block of blocks) {
    if (isLocalImageBlock(block)) {
      const result = await uploadMedia({ localId: block.localId, url: block.url });
      const cachedMedia = await db.media_cache.where('localId').equals(block.localId).first();
      if (cachedMedia) {
        await db.media_cache.put({ ...cachedMedia, serverId: result.mediaId, status: 'uploaded' });
      }
      rewrittenBlocks.push({ type: 'image', mediaId: result.mediaId, alt: block.alt });
      continue;
    }
    rewrittenBlocks.push(block);
  }

  return {
    ...operation,
    payload: {
      ...operation.payload,
      blocks: rewrittenBlocks
    }
  };
}

async function applyPushResult(db: JifoDb, result: PushResult) {
  if (result.status === 'conflict_copied' && result.note) {
    await db.notes_cache.put(result.note);
  }
}

async function applyPullChanges(db: JifoDb, changes: PullChangesResult) {
  for (const note of changes.notes) {
    await db.notes_cache.put(note);
  }
  await db.sync_state.put({ key: 'cursor', value: changes.cursor });
}

export async function runSync({ db, uploadMedia, pushOutbox, pullChanges }: SyncEngineOptions) {
  const pendingOps = await db.outbox.where('status').equals('pending').sortBy('localSeq');
  const pushableOps: OutboxOperation[] = [];

  for (const op of pendingOps) {
    pushableOps.push(await uploadLocalMediaForOperation(db, op, uploadMedia));
  }

  if (pushableOps.length > 0) {
    const pushResults = await pushOutbox(pushableOps);
    for (const result of pushResults) {
      await applyPushResult(db, result);
    }
    const pushedOpIds = new Set(pushResults.map((result) => result.opId));
    await db.transaction('rw', db.outbox, async () => {
      for (const op of pendingOps) {
        if (pushedOpIds.has(op.opId) && op.localSeq !== undefined) {
          await db.outbox.delete(op.localSeq);
        }
      }
    });
  }

  const cursor = (await db.sync_state.get('cursor'))?.value;
  const changes = await pullChanges(cursor);
  await applyPullChanges(db, changes);
}
