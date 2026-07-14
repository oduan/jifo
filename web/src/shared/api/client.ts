export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiClientOptions = {
  baseUrl: string;
  getAccessToken: () => string | null;
  refreshAccessToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export type ApiClient = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  requestBlob?: (path: string, init?: RequestInit) => Promise<Blob>;
};

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetcher = options.fetchImpl ?? fetch;

  const request = async <T>(
    path: string,
    init: RequestInit = {},
    allowRefresh = true,
    accessTokenOverride?: string
  ): Promise<T> => {
    const token = accessTokenOverride ?? options.getAccessToken();
    const headers = new Headers(init.headers ?? undefined);

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetcher(`${options.baseUrl}${path}`, {
      ...init,
      headers
    });

    if (response.status === 401 && allowRefresh && options.refreshAccessToken) {
      const refreshedToken = await options.refreshAccessToken();
      if (refreshedToken) {
        return request<T>(path, init, false, refreshedToken);
      }
    }

    if (!response.ok) {
      const bodyText = await response.text();
      let message = 'Request failed';
      let body: unknown = bodyText || undefined;

      if (bodyText) {
        try {
          body = JSON.parse(bodyText) as unknown;
          const maybeError = body as { error?: { message?: string; code?: string } };
          message = maybeError.error?.message || maybeError.error?.code || message;
        } catch {
          message = bodyText;
        }
      }

      throw new ApiError(message, response.status, body);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    return (await response.text()) as T;
  };

  const requestBlob = async (path: string, init: RequestInit = {}, allowRefresh = true, accessTokenOverride?: string): Promise<Blob> => {
    const token = accessTokenOverride ?? options.getAccessToken();
    const headers = new Headers(init.headers ?? undefined);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const response = await fetcher(`${options.baseUrl}${path}`, { ...init, headers });
    if (response.status === 401 && allowRefresh && options.refreshAccessToken) {
      const refreshedToken = await options.refreshAccessToken();
      if (refreshedToken) {
        return requestBlob(path, init, false, refreshedToken);
      }
    }
    if (!response.ok) {
      throw new ApiError('Request failed', response.status);
    }
    return response.blob();
  };

  return { request, requestBlob };
}
