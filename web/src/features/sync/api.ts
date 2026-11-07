import { ApiClient } from '../../shared/api/client';
import { ApiNoteBlock } from '../notes/api';
import { CachedNote, CachedNoteBlock, OutboxOperation } from '../../storage/db';
import { PullChangesResult, PullCursor, PushResult, normalizePushStatus } from './syncEngine';

const PULL_PAGE_SIZE = 100;

function toApiBlock(block: CachedNoteBlock): ApiNoteBlock {
  if (block.type === 'paragraph') return { type: 'paragraph', text: block.content };
  return { type: 'image', mediaId: block.mediaId, url: block.mediaId ? undefined : block.url, alt: block.alt };
}

function fromApiBlock(block: ApiNoteBlock): CachedNoteBlock | undefined {
  if (block.type === 'paragraph') return { type: 'paragraph', content: block.text ?? block.content ?? '' };
  if (!block.mediaId && !block.url) return undefined;
  return { type: 'image', mediaId: block.mediaId, url: block.url, alt: block.alt };
}

function plainText(blocks: CachedNoteBlock[]) {
  return blocks.filter((block): block is Extract<CachedNoteBlock, { type: 'paragraph' }> => block.type === 'paragraph').map((block) => block.content).join('\n\n');
}

// 后端 /sync/push 单批最多 500 条操作,超出整批 400 拒绝(backend/internal/sync/handler.go
// maxPushOperations)。客户端按 400 一批分批顺序推送,结果按批次顺序拼接,
// 避免离线积压超过上限时所有操作一起被 400 打回。
const PUSH_BATCH_SIZE = 400;

function toPushOperation(operation: OutboxOperation) {
  const blocks = operation.payload.blocks ?? [];
  return {
    opId: operation.opId,
    entity: operation.entity,
    action: operation.action,
    clientId: operation.clientId,
    // A Web offline draft uses a local-note-* cache key. Creates are
    // identified by clientId; sending that local key as noteId would be
    // rejected by the backend UUID parser.
    noteId: operation.action === 'create' ? undefined : operation.noteId,
    baseVersion: operation.baseVersion,
    payload: { blocks: blocks.map(toApiBlock), plainText: plainText(blocks) }
  };
}

export async function pushOutbox(client: ApiClient, operations: OutboxOperation[]): Promise<PushResult[]> {
  const results: PushResult[] = [];
  for (let start = 0; start < operations.length; start += PUSH_BATCH_SIZE) {
    const batch = operations.slice(start, start + PUSH_BATCH_SIZE);
    const response = await client.request<{ results: Array<Omit<PushResult, 'status'> & { status: string }> }>('/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: batch.map(toPushOperation) })
    });
    results.push(...response.results.map((result) => ({ ...result, status: normalizePushStatus(result.status) })));
  }
  return results;
}

type PullNote = {
  id: string;
  clientId: string;
  content?: { blocks?: ApiNoteBlock[] };
  plainText?: string;
  version?: number;
  updatedAt: string;
  deletedAt?: string | null;
  permanentlyDeletedAt?: string | null;
};

type PullResponse = {
  notes: PullNote[];
  cursor?: PullCursor | null;
  nextCursor?: PullCursor | null;
};

export async function pullChanges(client: ApiClient, initialCursor?: PullCursor): Promise<PullChangesResult> {
  let cursor = initialCursor;
  const notes: CachedNote[] = [];
  for (;;) {
    const params = new URLSearchParams({ limit: String(PULL_PAGE_SIZE) });
    if (cursor?.updatedAt) params.set('updatedAt', cursor.updatedAt);
    if (cursor?.id) params.set('id', cursor.id);
    const response = await client.request<PullResponse>(`/sync/pull?${params.toString()}`);
    notes.push(...response.notes.map((note) => ({
      id: note.id,
      clientId: note.clientId,
      blocks: (note.content?.blocks ?? []).map(fromApiBlock).filter((block): block is CachedNoteBlock => Boolean(block)),
      updatedAt: note.updatedAt,
      deletedAt: note.deletedAt,
      permanentlyDeletedAt: note.permanentlyDeletedAt,
      version: note.version
    })));
    const next = response.nextCursor ?? response.cursor ?? undefined;
    if (!next || response.notes.length < PULL_PAGE_SIZE || (cursor && next.updatedAt === cursor.updatedAt && next.id === cursor.id)) {
      cursor = next ?? cursor;
      break;
    }
    cursor = next;
  }
  return { cursor, notes };
}
