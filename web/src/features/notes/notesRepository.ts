import { ApiClient, NetworkError } from '../../shared/api/client';
import { CachedNote, CachedNoteBlock, JifoDb } from '../../storage/db';
import { createOfflineNote, deleteNoteOutboxOperation, restoreNoteOutboxOperation, updateNoteOutboxOperation } from '../sync/outbox';
import { TagNode } from '../tags/TagTree';
import { createNote as apiCreateNote, deleteNote as apiDeleteNote, restoreNote as apiRestoreNote, updateNote as apiUpdateNote, fromApiNote } from './api';
import { Note } from './NoteCard';
import { NoteBlock } from './NoteEditor';

export function isNetworkFailure(error: unknown) {
  // Only genuine connectivity failures go to the offline outbox; server
  // errors (5xx/409) and timeouts must surface to the caller instead.
  return error instanceof NetworkError;
}

export function toCachedBlocks(blocks: NoteBlock[]): CachedNoteBlock[] {
  return blocks.map((block) => block.type === 'paragraph' ? { type: 'paragraph', content: block.content } : { type: 'image', url: block.url, mediaId: block.mediaId, alt: block.alt });
}

export function fromCachedNote(note: CachedNote): Note {
  return {
    id: note.id,
    clientId: note.clientId,
    createdAt: note.createdAt ?? note.updatedAt,
    updatedAt: note.updatedAt,
    version: note.version,
    deletedAt: note.deletedAt,
    blocks: note.blocks,
    tagIds: []
  };
}

export function cachedPlainText(note: CachedNote) {
  return note.blocks.filter((block): block is Extract<CachedNoteBlock, { type: 'paragraph' }> => block.type === 'paragraph').map((block) => block.content).join('\n\n');
}

export function cachedHasTag(note: CachedNote, tagPath: string) {
  const wanted = tagPath.trim();
  if (!wanted) return true;
  const tags = cachedPlainText(note).match(/#[^\s#]+/g) ?? [];
  return tags.some((tag) => {
    const path = tag.slice(1);
    return path === wanted || path.startsWith(`${wanted}/`);
  });
}

function newLocalId(prefix: string) {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export type NotesRepository = {
  create(blocks: NoteBlock[], tags: TagNode[]): Promise<Note>;
  update(id: string, blocks: NoteBlock[], current: Note, tags: TagNode[]): Promise<Note>;
  remove(id: string, current: Note): Promise<void>;
  restore(id: string, current: Note, tags: TagNode[]): Promise<Note>;
};

export function createNotesRepository({ client, db }: { client: ApiClient; db: JifoDb | null }): NotesRepository {
  const cacheNote = (note: Note) => {
    if (!db) return Promise.resolve<string | void>(undefined);
    return db.notes_cache.put({
      id: note.id,
      clientId: note.clientId,
      blocks: toCachedBlocks(note.blocks),
      createdAt: note.createdAt,
      updatedAt: note.updatedAt ?? note.createdAt,
      deletedAt: note.deletedAt ?? null,
      version: note.version
    });
  };

  return {
    async create(blocks, tags) {
      try {
        const item = await apiCreateNote(client, blocks);
        const note = fromApiNote(item, tags);
        await cacheNote(note);
        return note;
      } catch (error) {
        if (!db || !isNetworkFailure(error)) throw error;
        const { note } = await createOfflineNote(db, { clientId: newLocalId('web-note'), blocks: toCachedBlocks(blocks) });
        return fromCachedNote(note);
      }
    },

    async update(id, blocks, current, tags) {
      try {
        const item = await apiUpdateNote(client, id, blocks);
        const note = fromApiNote(item, tags);
        await cacheNote(note);
        return note;
      } catch (error) {
        if (!db || !isNetworkFailure(error)) throw error;
        const cached: CachedNote = { id, clientId: current.clientId, blocks: toCachedBlocks(blocks), createdAt: current.createdAt, updatedAt: new Date().toISOString(), version: current.version };
        const operation = updateNoteOutboxOperation({ noteId: id, clientId: current.clientId, baseVersion: current.version, blocks: cached.blocks });
        await db.transaction('rw', db.notes_cache, db.outbox, async () => {
          await db.notes_cache.put(cached);
          await db.outbox.add(operation);
        });
        return { ...fromCachedNote(cached), tagIds: current.tagIds };
      }
    },

    async remove(id, current) {
      const deletedAt = new Date().toISOString();
      try {
        await apiDeleteNote(client, id);
        if (db) await db.notes_cache.update(id, { deletedAt, updatedAt: deletedAt });
      } catch (error) {
        if (!db || !isNetworkFailure(error)) throw error;
        const operation = deleteNoteOutboxOperation({ noteId: id, clientId: current.clientId, baseVersion: current.version });
        await db.transaction('rw', db.notes_cache, db.outbox, async () => {
          await db.notes_cache.update(id, { deletedAt, updatedAt: deletedAt });
          await db.outbox.add(operation);
        });
      }
    },

    async restore(id, current, tags) {
      const pendingDeletes = db
        ? await db.outbox
            .filter(
              (operation) =>
                operation.entity === 'note' &&
                operation.noteId === id &&
                operation.action === 'delete' &&
                (operation.status === 'pending' || operation.status === 'failed')
            )
            .toArray()
        : [];
      if (db && pendingDeletes.length > 0) {
        const restoredAt = new Date().toISOString();
        await db.transaction('rw', db.notes_cache, db.outbox, async () => {
          await db.notes_cache.update(id, { deletedAt: null, updatedAt: restoredAt });
          for (const operation of pendingDeletes) {
            if (operation.localSeq !== undefined) {
              await db.outbox.delete(operation.localSeq);
            }
          }
        });
        return { ...current, deletedAt: null, updatedAt: restoredAt };
      }

      try {
        const item = await apiRestoreNote(client, id);
        const note = fromApiNote(item, tags);
        await cacheNote(note);
        return note;
      } catch (error) {
        if (!db || !isNetworkFailure(error)) throw error;
        const blocks = toCachedBlocks(current.blocks);
        const operation = restoreNoteOutboxOperation({ noteId: id, clientId: current.clientId, baseVersion: current.version, blocks });
        const updatedAt = new Date().toISOString();
        await db.transaction('rw', db.notes_cache, db.outbox, async () => {
          await db.notes_cache.update(id, { deletedAt: null, updatedAt, blocks });
          await db.outbox.add(operation);
        });
        return { ...current, deletedAt: null, updatedAt, blocks: current.blocks };
      }
    }
  };
}
