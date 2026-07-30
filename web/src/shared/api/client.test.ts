import { describe, expect, test } from 'vitest';

import { ApiError, NetworkError, createApiClient } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('createApiClient', () => {
  test('wraps fetch connectivity failures (TypeError) in NetworkError', async () => {
    const client = createApiClient({
      baseUrl: '/api',
      getAccessToken: () => null,
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      }
    });

    await expect(client.request('/notes')).rejects.toBeInstanceOf(NetworkError);
  });

  test('does not convert HTTP errors into NetworkError', async () => {
    const client = createApiClient({
      baseUrl: '/api',
      getAccessToken: () => null,
      fetchImpl: async () => jsonResponse({ error: { message: 'boom' } }, 500)
    });

    const failure = await client.request('/notes').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(500);
  });

  test('does not convert abort/timeout errors into NetworkError', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const client = createApiClient({
      baseUrl: '/api',
      getAccessToken: () => null,
      fetchImpl: async () => {
        throw abortError;
      }
    });

    await expect(client.request('/notes')).rejects.toBe(abortError);
  });

  test('joins baseUrl with trailing slash and path without duplicating separators', async () => {
    const urls: string[] = [];
    const client = createApiClient({
      baseUrl: 'https://example.com/api/',
      getAccessToken: () => null,
      fetchImpl: async (input) => {
        urls.push(String(input));
        return jsonResponse({ ok: true });
      }
    });

    await client.request('/notes');
    await client.request('tags');

    expect(urls).toEqual(['https://example.com/api/notes', 'https://example.com/api/tags']);
  });

  test('passes an abort signal through to fetch and applies a default timeout', async () => {
    let receivedSignal: AbortSignal | null | undefined;
    const client = createApiClient({
      baseUrl: '/api',
      getAccessToken: () => null,
      fetchImpl: async (_input, init) => {
        receivedSignal = init?.signal;
        return jsonResponse({ ok: true });
      }
    });

    const controller = new AbortController();
    await client.request('/notes', { signal: controller.signal });

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });
});
