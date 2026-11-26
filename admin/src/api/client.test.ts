import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, errorMessage, onSessionChange, refreshSession, setAccessToken } from './client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('sends the access token and the cookie credentials', async () => {
    setAccessToken('access-1');
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await api.get('/v1/me');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/v1/me');
    expect(init.credentials).toBe('include');
    expect(init.headers.authorization).toBe('Bearer access-1');
  });

  it('refreshes once on 401 and retries the request', async () => {
    setAccessToken('expired');
    fetchMock
      .mockResolvedValueOnce(json(401, { code: 'TOKEN_EXPIRED', error: 'Token expired' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'fresh' }))
      .mockResolvedValueOnce(json(200, { id: 'u1' }));
    await expect(api.get('/v1/me')).resolves.toEqual({ id: 'u1' });
    expect(fetchMock.mock.calls[1]![0]).toBe('/v1/auth/token/refresh');
    expect(fetchMock.mock.calls[2]![1].headers.authorization).toBe('Bearer fresh');
  });

  it('shares one refresh between concurrent callers', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const a = refreshSession();
    const b = refreshSession();
    resolve(json(200, { accessToken: 'x' }));
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ends the session when the refresh fails', async () => {
    const seen: boolean[] = [];
    const off = onSessionChange((s) => seen.push(s));
    setAccessToken('expired');
    fetchMock
      .mockResolvedValueOnce(json(401, { code: 'TOKEN_EXPIRED', error: 'Token expired' }))
      .mockResolvedValueOnce(json(401, { code: 'INVALID_REFRESH_TOKEN', error: 'Session expired' }));
    await expect(api.get('/v1/me')).rejects.toMatchObject({ status: 401 });
    expect(seen.at(-1)).toBe(false);
    off();
  });

  it('turns API errors into readable messages', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { code: 'VALIDATION_FAILED', error: 'Request validation failed', details: [{ path: 'reason', message: 'Required' }] }),
    );
    const err = await api.post('/v1/x', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(errorMessage(err)).toBe('Request validation failed: reason – Required');
  });
});
