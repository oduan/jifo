import Dexie, { Table } from 'dexie';

export type CachedNoteBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'image'; url?: string; localId?: string; mediaId?: string; alt?: string };

export type CachedNote = {
  id: string;
  clientId: string;
  blocks: CachedNoteBlock[];
  createdAt?: string;
  updatedAt: string;
  deletedAt?: string | null;
  permanentlyDeletedAt?: string | null;
  version?: number;
  conflictOfNoteId?: string;
  conflictReason?: string;
};

export type CachedMedia = {
  id: string;
  localId?: string;
  serverId?: string;
  status: 'local_pending' | 'uploaded' | 'failed' | string;
  blob?: Blob;
  createdAt: string;
};

export type OutboxEntity = 'note' | 'media';
export type OutboxAction = 'create' | 'update' | 'delete' | 'restore';
export type OutboxStatus = 'pending' | 'pushing' | 'failed';

export type OutboxOperation = {
  localSeq?: number;
  opId: string;
  entity: OutboxEntity;
  action: OutboxAction;
  noteId?: string;
  clientId: string;
  baseVersion: number;
  payload: Record<string, unknown> & { blocks?: CachedNoteBlock[] };
  createdAt: string;
  status: OutboxStatus;
  lastError?: string;
};

export type SyncState = {
  key: string;
  value: unknown;
};

export class JifoDb extends Dexie {
  notes_cache!: Table<CachedNote, string>;
  media_cache!: Table<CachedMedia, string>;
  outbox!: Table<OutboxOperation, number>;
  sync_state!: Table<SyncState, string>;

  constructor(name = 'jifo') {
    super(name);
    this.version(1).stores({
      notes_cache: 'id, clientId, updatedAt, deletedAt, permanentlyDeletedAt',
      media_cache: 'id, localId, serverId, status',
      outbox: '++localSeq, opId, entity, action, createdAt, status',
      sync_state: 'key'
    });
  }
}

export function createJifoDb(name?: string) {
  return new JifoDb(name);
}
