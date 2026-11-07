import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiClient, ApiError, NetworkError } from '../../shared/api/client';
import { createJifoDb } from '../../storage/db';
import { cachePendingMedia, loadLocalMediaObjectUrl, uploadImageBlock } from './localMedia';

// jsdom 的 navigator.onLine 是原型只读属性，测试里用实例属性遮蔽后删除还原。
function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

afterEach(() => {
  delete (window.navigator as { onLine?: boolean }).onLine;
});

describe('localMedia 离线图片缓存', () => {
  let db = createJifoDb('local-media');

  beforeEach(async () => {
    await db.delete();
    db = createJifoDb('local-media');
  });

  test('cachePendingMedia 把 blob 写入 media_cache，状态 local_pending 且带 localId', async () => {
    // jsdom Blob 过不了 fake-indexeddb 的 structuredClone（会被摊平成普通对象），
    // 媒体内容统一用 Node 原生 Blob 构造。
    const localId = await cachePendingMedia(db, new NodeBlob(['png-bytes'], { type: 'image/png' }));

    const cached = await db.media_cache.where('localId').equals(localId).first();
    expect(cached).toMatchObject({ localId, status: 'local_pending' });
    expect(cached?.blob?.size).toBe(9);
    expect(cached?.createdAt).toBeTruthy();
  });

  test('loadLocalMediaObjectUrl 从 media_cache 生成 object URL，记录缺失时抛错', async () => {
    const localId = await cachePendingMedia(db, new NodeBlob(['png-bytes']));

    const url = await loadLocalMediaObjectUrl(db, localId);
    expect(url).toMatch(/^blob:/);

    await expect(loadLocalMediaObjectUrl(db, 'local-media-missing')).rejects.toThrow('local media is unavailable');
  });
});

describe('uploadImageBlock 离线降级', () => {
  let db = createJifoDb('local-media-upload');
  const client = { request: vi.fn() } as unknown as ApiClient;
  const file = new NodeFile(['png-bytes'], 'offline.png', { type: 'image/png' });

  beforeEach(async () => {
    await db.delete();
    db = createJifoDb('local-media-upload');
    vi.clearAllMocks();
  });

  test('检测到离线时不请求网络，blob 落 media_cache 并返回 localId 图片块', async () => {
    setOnline(false);

    const block = await uploadImageBlock({ client, db, file });

    expect(client.request).not.toHaveBeenCalled();
    expect(block).toEqual({ type: 'image', localId: expect.any(String), alt: 'offline.png' });
    const cached = await db.media_cache.where('localId').equals((block as { localId: string }).localId).first();
    expect(cached).toMatchObject({ status: 'local_pending' });
    expect(cached?.blob?.size).toBe(9);
  });

  test('在线上传遭遇 NetworkError 时同样降级为本地缓存', async () => {
    setOnline(true);
    vi.mocked(client.request).mockRejectedValue(new NetworkError('network request failed'));

    const block = await uploadImageBlock({ client, db, file });

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(block).toEqual({ type: 'image', localId: expect.any(String), alt: 'offline.png' });
    expect(await db.media_cache.where('status').equals('local_pending').count()).toBe(1);
  });

  test('服务端错误不做离线兜底，原样上抛且不写 media_cache', async () => {
    setOnline(true);
    vi.mocked(client.request).mockRejectedValue(new ApiError('server exploded', 500));

    await expect(uploadImageBlock({ client, db, file })).rejects.toThrow('server exploded');
    expect(await db.media_cache.count()).toBe(0);
  });

  test('在线上传成功返回 mediaId 图片块并附带预览 object URL', async () => {
    setOnline(true);
    vi.mocked(client.request).mockResolvedValue({
      item: { id: 'server-media-1', kind: 'image', mimeType: 'image/png', sizeBytes: 9, checksum: 'x', url: '/media/server-media-1', createdAt: '2026-05-30T00:00:00Z' }
    });

    const block = await uploadImageBlock({ client, db, file });

    expect(block).toEqual({ type: 'image', mediaId: 'server-media-1', url: expect.stringMatching(/^blob:/), alt: 'offline.png' });
    expect(await db.media_cache.count()).toBe(0);
  });
});
