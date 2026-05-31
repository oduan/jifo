import { ApiClient } from '../../shared/api/client';
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
};

export type ListNotesResult = {
  items: ApiNote[];
  page: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
};

type ApiItemResponse = {
  item: ApiNote;
};

function newId(prefix: string) {
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

function displayTimestamp(value: string | undefined) {
  const timestamp = value ?? new Date().toISOString();
  const match = timestamp.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})/);
  if (match) {
    return `${match[1]} ${match[2]}`;
  }
  return timestamp.slice(0, 19).replace('T', ' ');
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
        const url = block.url ?? (block.mediaId ? `/api/media/${block.mediaId}` : '');
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

function extractTagPaths(text: string) {
  const matches = text.match(/#[^\s#]+/g) ?? [];
  return [...new Set(matches.map((match) => match.slice(1).replace(/^\/+|\/+$/g, '')).filter(Boolean))];
}

function tagIdsForNote(note: ApiNote, tags: TagNode[]) {
  const paths = extractTagPaths(note.plainText ?? '');
  const tagByPath = new Map(tags.map((tag) => [tag.path ?? tag.id, tag]));
  return paths.map((path) => tagByPath.get(path)?.id).filter((id): id is string => Boolean(id));
}

export function fromApiNote(note: ApiNote, tags: TagNode[] = []): Note {
  return {
    id: note.id,
    createdAt: displayTimestamp(note.createdAt),
    updatedAt: note.updatedAt,
    version: note.version,
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
