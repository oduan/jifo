import { describe, expect, test, vi } from 'vitest';

import { ApiClient } from '../../shared/api/client';
import { loadMediaObjectUrl, uploadMedia } from './api';

describe('media api', () => {
  test('uploads multipart file', async () => {
    const request = vi.fn(async () => ({ item: { id: 'm1', kind: 'image', mimeType: 'image/png', sizeBytes: 3, checksum: 'sum', url: '/api/media/m1', createdAt: '2026-01-01T00:00:00Z' } }));
    const client = { request } as unknown as ApiClient;
    const file = new File(['png'], 'photo.png', { type: 'image/png' });
    const result = await uploadMedia(client, file);
    expect(result.id).toBe('m1');
    expect(request.mock.calls[0][0]).toBe('/media');
    expect(request.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });

  test('downloads protected media as object URL', async () => {
    const requestBlob = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:media') });
    const client = { request: vi.fn(), requestBlob } as unknown as ApiClient;
    await expect(loadMediaObjectUrl(client, 'm1')).resolves.toBe('blob:media');
    expect(requestBlob).toHaveBeenCalledWith('/media/m1');
  });
});
