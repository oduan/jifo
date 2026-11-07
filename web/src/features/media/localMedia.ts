import { ApiClient } from '../../shared/api/client';
import { JifoDb } from '../../storage/db';
import { isNetworkFailure } from '../notes/notesRepository';
import { NoteBlock } from '../notes/NoteEditor';
import { uploadMedia } from './api';

function newId(prefix: string) {
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

// 离线兜底:把待上传图片的 blob 缓存进 media_cache(状态 local_pending),并
// 返回带 localId 的图片块。该块随后随笔记进入 outbox,由同步引擎在恢复联网后
// 先上传媒体、再把块改写为 mediaId(见 syncEngine 的 uploadLocalMediaForOperation)。
export async function cachePendingMedia(db: JifoDb, file: Blob): Promise<string> {
  const localId = newId('local-media');
  await db.media_cache.put({
    id: localId,
    localId,
    status: 'local_pending',
    blob: file,
    createdAt: new Date().toISOString()
  });
  return localId;
}

// 从 media_cache 读回离线缓存的图片 blob,生成可直接展示的 object URL。
// 调用方负责 revoke(编辑器缩略图在卸载时回收,NoteCard 由卡片统一回收)。
export async function loadLocalMediaObjectUrl(db: JifoDb, localId: string): Promise<string> {
  const cached = await db.media_cache.where('localId').equals(localId).first();
  if (!cached?.blob) {
    throw new Error('local media is unavailable');
  }
  return URL.createObjectURL(cached.blob);
}

// 图片上传入口:在线成功返回 mediaId 块;检测到离线、或上传因网络故障
// (NetworkError,与 notesRepository 的离线口径一致)失败时降级为本地缓存,
// 返回 localId 块,交由同步管线在恢复联网后上传。服务端错误(5xx/409 等)
// 不做离线兜底,原样上抛给调用方提示。
export async function uploadImageBlock({ client, db, file }: { client: ApiClient; db: JifoDb | null; file: File }): Promise<Extract<NoteBlock, { type: 'image' }>> {
  if (db && !navigator.onLine) {
    const localId = await cachePendingMedia(db, file);
    return { type: 'image', localId, alt: file.name };
  }
  try {
    const asset = await uploadMedia(client, file);
    return { type: 'image', mediaId: asset.id, url: URL.createObjectURL(file), alt: file.name };
  } catch (uploadError) {
    if (!db || !isNetworkFailure(uploadError)) throw uploadError;
    const localId = await cachePendingMedia(db, file);
    return { type: 'image', localId, alt: file.name };
  }
}
