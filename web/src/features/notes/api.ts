import { ApiClient } from '../../shared/api/client';
import { apiBaseUrl } from '../../shared/api/baseUrl';
import { TagNode } from '../tags/TagTree';
import { Note } from './NoteCard';
import { NoteBlock } from './NoteEditor';

export type ApiNoteBlock =
  | { type: 'paragraph'; text?: string; content?: string }
  | { type: 'image'; mediaId?: string; url?: string; alt?: string };

export type ApiNote = {
  id: string;
  clientId: string;
  content?: { blocks?: ApiNoteBlock[] };
  plainText?: string;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  version?: number;
};

export type ListNotesOptions = {
  trash?: boolean;
  search?: string;
  tagPath?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
};

export type ListNotesResult = {
  items: ApiNote[];
  page: {
    limit: number;
    offset: number;
    hasMore: boolean;
    nextCursor?: string;
  };
};

export type NoteStats = {
  total: number;
};

type ApiItemResponse = {
  item: ApiNote;
};

function newId(prefix: string) {
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

export function toApiBlocks(blocks: NoteBlock[]): ApiNoteBlock[] {
  return blocks.map((block) => {
    if (block.type === 'paragraph') {
      return { type: 'paragraph', text: block.content };
    }
    if (block.mediaId) {
      return { type: 'image', mediaId: block.mediaId, alt: block.alt };
    }
    return { type: 'image', url: block.url, alt: block.alt };
  });
}

export function fromApiBlocks(blocks: ApiNoteBlock[] | undefined, plainText = ''): NoteBlock[] {
  const converted = (blocks ?? [])
    .map((block): NoteBlock | undefined => {
      if (block.type === 'paragraph') {
        const content = block.text ?? block.content ?? '';
        return content.trim() ? { type: 'paragraph', content } : undefined;
      }
      if (block.type === 'image') {
        const url = block.url ?? (block.mediaId ? `${apiBaseUrl()}/media/${block.mediaId}` : '');
        return url ? { type: 'image', url, mediaId: block.mediaId, alt: block.alt } : undefined;
      }
      return undefined;
    })
    .filter((block): block is NoteBlock => Boolean(block));

  if (converted.length > 0 || !plainText.trim()) {
    return converted;
  }

  return [{ type: 'paragraph', content: plainText }];
}

export function plainTextFromBlocks(blocks: NoteBlock[]) {
  return blocks
    .map((block) => {
      if (block.type === 'paragraph') {
        return block.content;
      }
      return block.alt ? `[图片] ${block.alt}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

// expandTagPath 与后端 backend/internal/tags/parser.go 的 expandPath 对齐:
// 每段 TrimSpace、过滤空段(#a//b、#/a/b/ 的空段不产生路径),并展开祖先路径
// (#a/b 同时命中 a 与 a/b 两级标签)。
function expandTagPath(path: string): string[] {
  const segments = path.split('/').map((segment) => segment.trim()).filter(Boolean);
  const expanded: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    expanded.push(segments.slice(0, i + 1).join('/'));
  }
  return expanded;
}

// 与后端 ExtractTagPaths 同口径:按出现顺序收集 # 标签,展开祖先并全局去重。
export function extractTagPaths(text: string) {
  const matches = text.match(/#[^\s#]+/g) ?? [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const match of matches) {
    for (const path of expandTagPath(match.slice(1))) {
      if (seen.has(path)) {
        continue;
      }
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

function tagIdsForNote(note: ApiNote, tags: TagNode[]) {
  const paths = extractTagPaths(note.plainText ?? '');
  const tagByPath = new Map(tags.map((tag) => [tag.path ?? tag.id, tag]));
  return paths.map((path) => tagByPath.get(path)?.id).filter((id): id is string => Boolean(id));
}

export function fromApiNote(note: ApiNote, tags: TagNode[] = []): Note {
  return {
    id: note.id,
    clientId: note.clientId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    version: note.version,
    deletedAt: note.deletedAt,
    blocks: fromApiBlocks(note.content?.blocks, note.plainText),
    tagIds: tagIdsForNote(note, tags)
  };
}

function notePayload(blocks: NoteBlock[], clientId?: string) {
  return {
    ...(clientId ? { clientId } : {}),
    content: { blocks: toApiBlocks(blocks) },
    plainText: plainTextFromBlocks(blocks)
  };
}

export function listNoteStats(client: ApiClient): Promise<NoteStats> {
  return client.request<NoteStats>('/notes/stats');
}

export async function listNotes(client: ApiClient, options: ListNotesOptions = {}): Promise<ListNotesResult> {
  const params = new URLSearchParams();
  if (options.trash) {
    params.set('trash', 'true');
  }
  if (options.search?.trim()) {
    params.set('search', options.search.trim());
  }
  if (options.tagPath?.trim()) {
    params.set('tagPath', options.tagPath.trim());
  }
  if (typeof options.limit === 'number') {
    params.set('limit', String(options.limit));
  }
  if (typeof options.offset === 'number') {
    params.set('offset', String(options.offset));
  }
  if (options.cursor) {
    params.set('cursor', options.cursor);
  }
  const response = await client.request<ListNotesResult>(`/notes${params.size ? `?${params.toString()}` : ''}`);
  return {
    items: response.items,
    page: response.page ?? { limit: options.limit ?? 0, offset: options.offset ?? 0, hasMore: false }
  };
}

export async function createNote(client: ApiClient, blocks: NoteBlock[]) {
  const response = await client.request<ApiItemResponse>('/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(notePayload(blocks, newId('web-note')))
  });
  return response.item;
}

export async function updateNote(client: ApiClient, id: string, blocks: NoteBlock[]) {
  const response = await client.request<ApiItemResponse>(`/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(notePayload(blocks))
  });
  return response.item;
}

export async function deleteNote(client: ApiClient, id: string) {
  const response = await client.request<ApiItemResponse>(`/notes/${id}`, { method: 'DELETE' });
  return response.item;
}

export async function restoreNote(client: ApiClient, id: string) {
  const response = await client.request<ApiItemResponse>(`/notes/${id}/restore`, { method: 'POST' });
  return response.item;
}
