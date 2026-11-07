import { ApiClient, NetworkError } from '../../shared/api/client';
import { CachedNote, CachedNoteBlock, JifoDb } from '../../storage/db';
import { createOfflineNote, deleteNoteOutboxOperation, findAuthoritativeCachedNote, isLocalDraftNoteId, restoreNoteOutboxOperation, updateNoteOutboxOperation } from '../sync/outbox';
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
  return blocks.map((block) => block.type === 'paragraph' ? { type: 'paragraph', content: block.content } : { type: 'image', url: block.url, localId: block.localId, mediaId: block.mediaId, alt: block.alt });
}

// 图片块仍持有 localId 且未回填 mediaId,说明图片本体还躺在 media_cache 里
// 等待同步引擎上传。这类变更不能直连 API(服务端会收到无 mediaId 的图片块,
// 回读时该块会被丢弃,图片就丢了),必须走离线 outbox:由同步引擎先传图片、
// 把块改写为 mediaId 后再推送笔记。
export function hasPendingLocalImage(blocks: NoteBlock[]): boolean {
  return blocks.some((block) => block.type === 'image' && Boolean(block.localId) && !block.mediaId);
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
  // 界面可能仍持重命名前的旧 id：本地草稿推送成功后 notes_cache 已改用服务端
  // UUID，但同一次同步的 pull 失败会让界面停留旧 id（refreshSilently 未执行）。
  // 变更前先反查当前记录，把 API 请求、outbox 入队与 cache 写入都落到当前 id
  // 上——否则旧 id 会被后端按非 UUID 拒绝（永久 failed），离线编辑还会以旧 id
  // 重建 cache 记录，造成同 clientId 双记录。无记录可反查时保持原 id，由既有
  // 错误路径兜底。
  const resolveCurrentRecord = async (id: string, clientId: string): Promise<CachedNote | undefined> => {
    if (!db) return undefined;
    const authoritative = await findAuthoritativeCachedNote(db, clientId);
    if (authoritative && authoritative.id !== id && isLocalDraftNoteId(id)) {
      return authoritative;
    }
    return (await db.notes_cache.get(id)) ?? authoritative;
  };

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
      // 含待上传图片的变更即使当前在线也走离线队列:直连 API 会把无 mediaId 的
      // 图片块写上服务端;入队后由同步引擎先传图片再推送笔记。
      if (db && hasPendingLocalImage(blocks)) {
        const { note } = await createOfflineNote(db, { clientId: newLocalId('web-note'), blocks: toCachedBlocks(blocks) });
        return fromCachedNote(note);
      }
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
      const resolved = await resolveCurrentRecord(id, current.clientId);
      const targetId = resolved?.id ?? id;
      const applyOfflineUpdate = async (database: JifoDb) => {
        const cachedBlocks = toCachedBlocks(blocks);
        const cached: CachedNote = { id: targetId, clientId: current.clientId, blocks: cachedBlocks, createdAt: resolved?.createdAt ?? current.createdAt, updatedAt: new Date().toISOString(), version: resolved?.version ?? current.version };
        const operation = updateNoteOutboxOperation({ noteId: targetId, clientId: current.clientId, baseVersion: resolved?.version ?? current.version, blocks: cachedBlocks });
        await database.transaction('rw', database.notes_cache, database.outbox, async () => {
          await database.notes_cache.put(cached);
          await database.outbox.add(operation);
        });
        return { ...fromCachedNote(cached), tagIds: current.tagIds };
      };

      // 含待上传图片的变更即使当前在线也走离线队列(理由同 create)
      if (db && hasPendingLocalImage(blocks)) {
        return applyOfflineUpdate(db);
      }
      try {
        const item = await apiUpdateNote(client, targetId, blocks);
        const note = fromApiNote(item, tags);
        await cacheNote(note);
        return note;
      } catch (error) {
        if (!db || !isNetworkFailure(error)) throw error;
        return applyOfflineUpdate(db);
      }
    },

    async remove(id, current) {
      const resolved = await resolveCurrentRecord(id, current.clientId);
      const targetId = resolved?.id ?? id;
      const deletedAt = new Date().toISOString();
      try {
        await apiDeleteNote(client, targetId);
        if (db) await db.notes_cache.update(targetId, { deletedAt, updatedAt: deletedAt });
      } catch (error) {
        if (!db || !isNetworkFailure(error)) throw error;
        const operation = deleteNoteOutboxOperation({ noteId: targetId, clientId: current.clientId, baseVersion: resolved?.version ?? current.version });
        await db.transaction('rw', db.notes_cache, db.outbox, async () => {
          await db.notes_cache.update(targetId, { deletedAt, updatedAt: deletedAt });
          await db.outbox.add(operation);
        });
      }
    },

    async restore(id, current, tags) {
      const resolved = await resolveCurrentRecord(id, current.clientId);
      const targetId = resolved?.id ?? id;
      const pendingDeletes = db
        ? await db.outbox
            .filter(
              (operation) =>
                operation.entity === 'note' &&
                operation.noteId === targetId &&
                operation.action === 'delete' &&
                (operation.status === 'pending' || operation.status === 'failed')
            )
            .toArray()
        : [];
      if (db && pendingDeletes.length > 0) {
        const restoredAt = new Date().toISOString();
        await db.transaction('rw', db.notes_cache, db.outbox, async () => {
          await db.notes_cache.update(targetId, { deletedAt: null, updatedAt: restoredAt });
          for (const operation of pendingDeletes) {
            if (operation.localSeq !== undefined) {
              await db.outbox.delete(operation.localSeq);
            }
          }
        });
        return { ...current, id: targetId, deletedAt: null, updatedAt: restoredAt };
      }

      const applyOfflineRestore = async (database: JifoDb) => {
        const blocks = toCachedBlocks(current.blocks);
        const operation = restoreNoteOutboxOperation({ noteId: targetId, clientId: current.clientId, baseVersion: resolved?.version ?? current.version, blocks });
        const updatedAt = new Date().toISOString();
        await database.transaction('rw', database.notes_cache, database.outbox, async () => {
          await database.notes_cache.update(targetId, { deletedAt: null, updatedAt, blocks });
          await database.outbox.add(operation);
        });
        return { ...current, id: targetId, deletedAt: null, updatedAt, blocks: current.blocks };
      };

      // 回收站恢复的内容仍带未上传图片时同样入离线队列(理由同 create)
      if (db && hasPendingLocalImage(current.blocks)) {
        return applyOfflineRestore(db);
      }

      try {
        const item = await apiRestoreNote(client, targetId);
        const note = fromApiNote(item, tags);
        await cacheNote(note);
        return note;
      } catch (error) {
        if (!db || !isNetworkFailure(error)) throw error;
        return applyOfflineRestore(db);
      }
    }
  };
}
