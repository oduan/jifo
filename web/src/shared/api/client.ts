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

/** Thrown only when the request never reached the server (offline, DNS, CORS). */
export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

function withDefaultTimeout(external: AbortSignal | null | undefined): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
    return external ?? undefined;
  }
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  if (!external) {
    return timeout;
  }
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([external, timeout]) : external;
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

    let response: Response;
    try {
      response = await fetcher(joinUrl(options.baseUrl, path), {
        ...init,
        headers,
        signal: withDefaultTimeout(init.signal)
      });
    } catch (fetchError) {
      if (fetchError instanceof TypeError) {
        throw new NetworkError('network request failed', { cause: fetchError });
      }
      throw fetchError;
    }

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
    let response: Response;
    try {
      response = await fetcher(joinUrl(options.baseUrl, path), { ...init, headers, signal: withDefaultTimeout(init.signal) });
    } catch (fetchError) {
      if (fetchError instanceof TypeError) {
        throw new NetworkError('network request failed', { cause: fetchError });
      }
      throw fetchError;
    }
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
