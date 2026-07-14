import { ApiClient } from '../../shared/api/client';

export type MediaAsset = {
  id: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  url: string;
  createdAt: string;
};

type MediaItemResponse = {
  item: MediaAsset;
};

export async function uploadMedia(client: ApiClient, file: File): Promise<MediaAsset> {
  const body = new FormData();
  body.append('file', file);

  const response = await client.request<MediaItemResponse>('/media', {
    method: 'POST',
    body
  });
  return response.item;
}

export async function loadMediaObjectUrl(client: ApiClient, mediaId: string): Promise<string> {
  if (!client.requestBlob) {
    throw new Error('media download is not supported by this API client');
  }
  const blob = await client.requestBlob(`/media/${encodeURIComponent(mediaId)}`);
  return URL.createObjectURL(blob);
}
