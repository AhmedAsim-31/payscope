import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiFetch, type ApiFetchDeps } from './api-client';

const errorBody = (code: string) => ({
  error: { code, message: `${code} message`, requestId: 'req-1' },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(responses: Response[], overrides: Partial<ApiFetchDeps> = {}) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  const deps = {
    baseUrl: 'http://api.test',
    fetch: fetchMock,
    getAccessToken: vi.fn().mockResolvedValue('old-token'),
    refreshAccessToken: vi.fn().mockResolvedValue('new-token'),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } satisfies ApiFetchDeps;
  return { fetchMock, deps, apiFetch: createApiFetch(deps) };
}

const authHeader = (call: unknown[]) =>
  new Headers((call[1] as RequestInit).headers).get('authorization');

describe('apiFetch', () => {
  it('sends the bearer token and parses JSON', async () => {
    const { apiFetch, fetchMock } = setup([json(200, { userId: 'u1', email: 'a@b.c' })]);
    await expect(apiFetch('/api/v1/me')).resolves.toEqual({ userId: 'u1', email: 'a@b.c' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/api/v1/me');
    expect(authHeader(fetchMock.mock.calls[0] ?? [])).toBe('Bearer old-token');
  });

  it('refreshes once on TOKEN_EXPIRED and retries with the new token', async () => {
    const { apiFetch, fetchMock, deps } = setup([
      json(401, errorBody('TOKEN_EXPIRED')),
      json(200, { ok: true }),
    ]);
    await expect(apiFetch('/api/v1/me')).resolves.toEqual({ ok: true });
    expect(deps.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(authHeader(fetchMock.mock.calls[1] ?? [])).toBe('Bearer new-token');
    expect(deps.signOut).not.toHaveBeenCalled();
  });

  it('signs out and throws on a second 401', async () => {
    const { apiFetch, fetchMock, deps } = setup([
      json(401, errorBody('TOKEN_EXPIRED')),
      json(401, errorBody('TOKEN_EXPIRED')),
    ]);
    await expect(apiFetch('/api/v1/me')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deps.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(deps.signOut).toHaveBeenCalledTimes(1);
  });

  it('signs out when refresh yields no token', async () => {
    const { apiFetch, deps } = setup([json(401, errorBody('TOKEN_EXPIRED'))], {
      refreshAccessToken: vi.fn().mockResolvedValue(null),
    });
    await expect(apiFetch('/api/v1/me')).rejects.toBeInstanceOf(ApiClientError);
    expect(deps.signOut).toHaveBeenCalledTimes(1);
  });

  it('signs out immediately on a non-refreshable 401', async () => {
    const { apiFetch, deps } = setup([json(401, errorBody('INVALID_TOKEN'))]);
    await expect(apiFetch('/api/v1/me')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(deps.refreshAccessToken).not.toHaveBeenCalled();
    expect(deps.signOut).toHaveBeenCalledTimes(1);
  });

  it('throws a typed error on 503 without signing out', async () => {
    const { apiFetch, deps } = setup([json(503, errorBody('AUTH_UNAVAILABLE'))]);
    const error = await apiFetch('/api/v1/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 503, code: 'AUTH_UNAVAILABLE', requestId: 'req-1' });
    expect(deps.signOut).not.toHaveBeenCalled();
    expect(deps.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('maps a non-API error body to UNKNOWN', async () => {
    const { apiFetch } = setup([new Response('oops', { status: 500 })]);
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 500, code: 'UNKNOWN' });
  });
});
