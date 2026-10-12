import { apiErrorSchema } from '@payscope/shared/api-error';
import { getPublicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/browser';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export type ApiFetchDeps = {
  baseUrl: string;
  fetch: typeof fetch;
  getAccessToken: () => Promise<string | null>;
  refreshAccessToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

async function toError(response: Response): Promise<ApiClientError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(body);
  if (!parsed.success) {
    return new ApiClientError(response.status, 'UNKNOWN', `Request failed (${response.status})`);
  }
  const { code, message, requestId } = parsed.data.error;
  return new ApiClientError(response.status, code, message, requestId);
}

export function createApiFetch(deps: ApiFetchDeps) {
  const send = async (path: string, init: RequestInit | undefined, token: string | null) => {
    const headers = new Headers(init?.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    return deps.fetch(`${deps.baseUrl}${path}`, { ...init, headers });
  };

  return async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
    let response = await send(path, init, await deps.getAccessToken());

    if (response.status === 401) {
      const first = await toError(response);
      const refreshed = first.code === 'TOKEN_EXPIRED' ? await deps.refreshAccessToken() : null;
      if (refreshed) response = await send(path, init, refreshed);
      if (response.status === 401) {
        await deps.signOut();
        throw refreshed ? await toError(response) : first;
      }
    }

    if (!response.ok) throw await toError(response);
    if (response.status === 204) return undefined;
    return response.json();
  };
}

/** For client components only; built per call so env and the browser session are read lazily. */
export function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const supabase = createClient();
  return createApiFetch({
    baseUrl: getPublicEnv().NEXT_PUBLIC_API_URL,
    fetch: (input, requestInit) => fetch(input, requestInit),
    getAccessToken: async () =>
      (await supabase.auth.getSession()).data.session?.access_token ?? null,
    refreshAccessToken: async () =>
      (await supabase.auth.refreshSession()).data.session?.access_token ?? null,
    signOut: async () => {
      await supabase.auth.signOut();
      window.location.assign('/login');
    },
  })(path, init);
}
