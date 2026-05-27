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
      throw new ApiError('Request failed', response.status, bodyText || undefined);
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

  return { request };
}
