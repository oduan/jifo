import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiClient, NetworkError } from '../../shared/api/client';
import { CachedNote, createJifoDb } from '../../storage/db';
import { createNote as apiCreateNote, deleteNote as apiDeleteNote, restoreNote as apiRestoreNote, updateNote as apiUpdateNote } from './api';
import { cachedHasTag, createNotesRepository, hasPendingLocalImage, toCachedBlocks } from './notesRepository';
import { Note } from './NoteCard';
import { NoteBlock } from './NoteEditor';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  restoreNote: vi.fn()
}));

describe('cachedHasTag', () => {
  const note: CachedNote = {
    id: 'n1',
    clientId: 'c1',
    blocks: [{ type: 'paragraph', content: '#foo/child #foobar #工作' }],
    updatedAt: '2026-01-01T00:00:00Z'
  };

  test('匹配标签本身或后代，但不匹配相同前缀', () => {
    expect(cachedHasTag(note, 'foo')).toBe(true);
    expect(cachedHasTag(note, 'foo/child')).toBe(true);
    expect(cachedHasTag(note, 'fo')).toBe(false);
    expect(cachedHasTag(note, 'work')).toBe(false);
  });
});

describe('toCachedBlocks / hasPendingLocalImage', () => {
  test('图片块保留 localId，未回填 mediaId 的待上传图片块可被识别', () => {
    const blocks: NoteBlock[] = [
      { type: 'paragraph', content: 'text' },
      { type: 'image', localId: 'local-media-1', alt: 'paste.png' },
      { type: 'image', mediaId: 'server-media-1', url: 'blob:preview', alt: 'photo.png' }
    ];

    expect(toCachedBlocks(blocks)).toEqual([
      { type: 'paragraph', content: 'text' },
      { type: 'image', localId: 'local-media-1', alt: 'paste.png' },
      { type: 'image', url: 'blob:preview', mediaId: 'server-media-1', alt: 'photo.png' }
    ]);
    expect(hasPendingLocalImage(blocks)).toBe(true);
    expect(hasPendingLocalImage([{ type: 'paragraph', content: '纯文本' }])).toBe(false);
    expect(hasPendingLocalImage([{ type: 'image', mediaId: 'm1', url: 'blob:x' }])).toBe(false);
    expect(hasPendingLocalImage([{ type: 'image', localId: 'local-media-1', mediaId: 'm1' }])).toBe(false);
  });
});

describe('createNotesRepository 离线 id 解析', () => {
  let db = createJifoDb('notes-repository-id-resolution');

  // 界面上仍持重命名前旧 id 的卡片（pull 失败导致 refreshSilently 未执行）
  const current: Note = {
    id: 'local-note-1',
    clientId: 'web-note-client-1',
    createdAt: '2026-05-27T00:00:00Z',
    updatedAt: '2026-05-27T00:00:00Z',
    version: 0,
    deletedAt: null,
    blocks: [{ type: 'paragraph', content: 'draft' }],
    tagIds: []
  };

  beforeEach(async () => {
    await db.delete();
    db = createJifoDb('notes-repository-id-resolution');
    vi.clearAllMocks();
  });

  test('界面持旧 id 时离线编辑落到服务端当前记录，不再以旧 id 入队或重建 cache 记录', async () => {
    await db.notes_cache.put({
      id: 'server-note-1',
      clientId: 'web-note-client-1',
      blocks: [{ type: 'paragraph', content: 'server state' }],
      createdAt: '2026-05-27T00:00:00Z',
      updatedAt: '2026-05-27T00:30:00Z',
      version: 1
    });
    vi.mocked(apiUpdateNote).mockRejectedValue(new NetworkError('offline'));

    const repository = createNotesRepository({ client: {} as ApiClient, db });
    const updated = await repository.update('local-note-1', [{ type: 'paragraph', content: 'offline edit' }], current, []);

    expect(apiUpdateNote).toHaveBeenCalledWith(expect.anything(), 'server-note-1', expect.anything());
    expect(updated.id).toBe('server-note-1');
    const [operation] = await db.outbox.toArray();
    expect(operation).toMatchObject({ action: 'update', noteId: 'server-note-1', baseVersion: 1 });
    expect(await db.notes_cache.get('local-note-1')).toBeUndefined();
    expect((await db.notes_cache.get('server-note-1'))?.blocks).toEqual([{ type: 'paragraph', content: 'offline edit' }]);
  });

  test('界面持旧 id 时离线删除以服务端当前 id 入队并标记当前记录', async () => {
    await db.notes_cache.put({
      id: 'server-note-1',
      clientId: 'web-note-client-1',
      blocks: [{ type: 'paragraph', content: 'server state' }],
      createdAt: '2026-05-27T00:00:00Z',
      updatedAt: '2026-05-27T00:30:00Z',
      version: 1
    });
    vi.mocked(apiDeleteNote).mockRejectedValue(new NetworkError('offline'));

    const repository = createNotesRepository({ client: {} as ApiClient, db });
    await repository.remove('local-note-1', current);

    const [operation] = await db.outbox.toArray();
    expect(operation).toMatchObject({ action: 'delete', noteId: 'server-note-1', baseVersion: 1 });
    expect(await db.notes_cache.get('local-note-1')).toBeUndefined();
    expect((await db.notes_cache.get('server-note-1'))?.deletedAt).toBeTruthy();
  });
});

describe('createNotesRepository 撤销删除与在途推送', () => {
  let db = createJifoDb('notes-repository-undo-inflight');

  const current: Note = {
    id: 'server-note-1',
    clientId: 'web-note-client-1',
    createdAt: '2026-05-27T00:00:00Z',
    updatedAt: '2026-05-27T00:00:00Z',
    version: 1,
    deletedAt: '2026-05-27T01:00:00Z',
    blocks: [{ type: 'paragraph', content: 'deleted note' }],
    tagIds: []
  };

  beforeEach(async () => {
    await db.delete();
    db = createJifoDb('notes-repository-undo-inflight');
    vi.clearAllMocks();
    await db.notes_cache.put({
      id: 'server-note-1',
      clientId: 'web-note-client-1',
      blocks: [{ type: 'paragraph', content: 'deleted note' }],
      createdAt: '2026-05-27T00:00:00Z',
      updatedAt: '2026-05-27T01:00:00Z',
      version: 1,
      deletedAt: '2026-05-27T01:00:00Z'
    });
  });

  test('删除操作正在推送(pushing)时撤销:保留在途操作并补 force restore,不走在线恢复', async () => {
    await db.outbox.add({
      opId: 'op-delete-1',
      entity: 'note',
      action: 'delete',
      noteId: 'server-note-1',
      clientId: 'web-note-client-1',
      baseVersion: 1,
      payload: {},
      createdAt: '2026-05-27T01:00:00Z',
      status: 'pushing'
    });

    const repository = createNotesRepository({ client: {} as ApiClient, db });
    const restored = await repository.restore('server-note-1', current, []);

    expect(apiRestoreNote).not.toHaveBeenCalled();
    expect(restored.deletedAt).toBeNull();
    const operations = await db.outbox.toArray();
    const deletes = operations.filter((operation) => operation.action === 'delete');
    const restores = operations.filter((operation) => operation.action === 'restore');
    // 在途删除由同步自行结算,不在这里移除;恢复操作必须 force(推送省略 baseVersion)
    expect(deletes).toHaveLength(1);
    expect(restores).toHaveLength(1);
    expect(restores[0]).toMatchObject({ noteId: 'server-note-1', force: true });
    expect((await db.notes_cache.get('server-note-1'))?.deletedAt).toBeNull();
  });

  test('outbox 无删除痕迹时离线恢复:入队 force restore,避免过期 baseVersion 触发冲突副本', async () => {
    vi.mocked(apiRestoreNote).mockRejectedValue(new NetworkError('offline'));

    const repository = createNotesRepository({ client: {} as ApiClient, db });
    const restored = await repository.restore('server-note-1', current, []);

    expect(restored.deletedAt).toBeNull();
    const [operation] = await db.outbox.toArray();
    expect(operation).toMatchObject({ action: 'restore', noteId: 'server-note-1', force: true });
    expect((await db.notes_cache.get('server-note-1'))?.deletedAt).toBeNull();
  });

  test('未离开本地的删除(pending/failed)撤销仍直接移除,不追加恢复操作', async () => {
    await db.outbox.add({
      opId: 'op-delete-2',
      entity: 'note',
      action: 'delete',
      noteId: 'server-note-1',
      clientId: 'web-note-client-1',
      baseVersion: 1,
      payload: {},
      createdAt: '2026-05-27T01:00:00Z',
      status: 'failed',
      lastError: 'network request failed'
    });

    const repository = createNotesRepository({ client: {} as ApiClient, db });
    const restored = await repository.restore('server-note-1', current, []);

    expect(apiRestoreNote).not.toHaveBeenCalled();
    expect(restored.deletedAt).toBeNull();
    expect(await db.outbox.toArray()).toEqual([]);
    expect((await db.notes_cache.get('server-note-1'))?.deletedAt).toBeNull();
  });
});

describe('createNotesRepository 待上传图片的离线队列', () => {
  let db = createJifoDb('notes-repository-pending-image');

  // 图片块带 localId 且未回填 mediaId 时，即使当前在线也必须走离线 outbox，
  // 由同步引擎先上传图片再推送笔记；直连 API 会把无 mediaId 的图片块写上服务端。
  const current: Note = {
    id: 'n1',
    clientId: 'client-pending-image',
    createdAt: '2026-05-27T00:00:00Z',
    updatedAt: '2026-05-27T00:00:00Z',
    version: 1,
    deletedAt: null,
    blocks: [{ type: 'paragraph', content: '原文' }],
    tagIds: []
  };
  const pendingImageBlocks: NoteBlock[] = [
    { type: 'paragraph', content: '离线粘贴' },
    { type: 'image', localId: 'local-media-1', alt: 'paste.png' }
  ];

  beforeEach(async () => {
    await db.delete();
    db = createJifoDb('notes-repository-pending-image');
    vi.clearAllMocks();
  });

  test('在线提交含 localId 图片块的新笔记时不调用创建接口，直接离线入队', async () => {
    const repository = createNotesRepository({ client: {} as ApiClient, db });

    const note = await repository.create(pendingImageBlocks, []);

    expect(apiCreateNote).not.toHaveBeenCalled();
    expect(note.id).toMatch(/^local-note-/);
    expect(note.blocks).toEqual(pendingImageBlocks);
    const [operation] = await db.outbox.toArray();
    expect(operation).toMatchObject({ action: 'create' });
    expect((await db.notes_cache.get(note.id))?.blocks).toEqual(pendingImageBlocks);
  });

  test('在线提交含 localId 图片块的编辑时不调用更新接口，入离线队列等待同步先传图', async () => {
    const repository = createNotesRepository({ client: {} as ApiClient, db });

    const updated = await repository.update('n1', pendingImageBlocks, current, []);

    expect(apiUpdateNote).not.toHaveBeenCalled();
    const [operation] = await db.outbox.toArray();
    expect(operation).toMatchObject({ action: 'update', noteId: 'n1', baseVersion: 1 });
    expect(operation.payload.blocks).toEqual(pendingImageBlocks);
    expect(updated.blocks).toEqual(pendingImageBlocks);
    expect((await db.notes_cache.get('n1'))?.blocks).toEqual(pendingImageBlocks);
  });

  test('恢复仍带待上传图片的笔记时不调用恢复接口，图片块随恢复操作入队', async () => {
    const repository = createNotesRepository({ client: {} as ApiClient, db });

    const restored = await repository.restore('n1', { ...current, deletedAt: '2026-05-27T01:00:00Z', blocks: pendingImageBlocks }, []);

    expect(apiRestoreNote).not.toHaveBeenCalled();
    expect(restored.deletedAt).toBeNull();
    const [operation] = await db.outbox.toArray();
    expect(operation).toMatchObject({ action: 'restore', noteId: 'n1' });
    expect(operation.payload.blocks).toEqual(pendingImageBlocks);
  });

  test('已回填 mediaId 的图片块不触发离线队列，正常走在线路径', async () => {
    vi.mocked(apiUpdateNote).mockResolvedValue({
      id: 'n1',
      clientId: 'client-pending-image',
      createdAt: '2026-05-27T00:00:00Z',
      updatedAt: '2026-05-27T02:00:00Z',
      version: 2,
      deletedAt: null,
      content: { blocks: [{ type: 'image', mediaId: 'server-media-1', alt: 'photo.png' }] },
      plainText: ''
    });

    const repository = createNotesRepository({ client: {} as ApiClient, db });
    await repository.update('n1', [{ type: 'image', mediaId: 'server-media-1', url: 'blob:preview', alt: 'photo.png' }], current, []);

    expect(apiUpdateNote).toHaveBeenCalledTimes(1);
    expect(await db.outbox.toArray()).toHaveLength(0);
  });
});
