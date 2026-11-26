/**
 * API client for the admin panel.
 *
 * - The access token (15 min) lives only in memory.
 * - The refresh token is an httpOnly cookie set by the API; this code never sees it.
 * - On a 401 the client refreshes once (shared by concurrent requests) and retries.
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** A stable id for this browser, so sessions are device-bound like the mobile apps. */
export function deviceId(): string {
  const KEY = 'pp_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `web-${crypto.randomUUID()}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const l of listeners) l(token !== null);
}

/** Called when the session ends (refresh failed), so the UI can show the sign-in page. */
export function onSessionChange(listener: (signedIn: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: string; code?: string; details?: unknown };
    return new ApiError(res.status, body.code ?? 'ERROR', body.error ?? res.statusText, body.details);
  } catch {
    return new ApiError(res.status, 'ERROR', res.statusText || 'Request failed');
  }
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/v1/auth/token/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId() }),
      });
      if (!res.ok) {
        setAccessToken(null);
        return false;
      }
      const tokens = (await res.json()) as { accessToken: string };
      setAccessToken(tokens.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Skip the Authorization header and the refresh-on-401 retry (sign-in endpoints). */
  anonymous?: boolean;
}

function url(path: string, query?: RequestOptions['query']): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${BASE}${path}${s ? `?${s}` : ''}`;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (!opts.anonymous && accessToken) headers.authorization = `Bearer ${accessToken}`;
  return fetch(url(path, opts.query), {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

async function raw(path: string, opts: RequestOptions = {}): Promise<Response> {
  let res = await send(path, opts);
  if (res.status === 401 && !opts.anonymous && (await refreshSession())) {
    res = await send(path, opts);
  }
  if (!res.ok) throw await toError(res);
  return res;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await raw(path, opts);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Downloads a file (CSV, invoice PDF) using the current session. */
  async download(path: string, query?: RequestOptions['query']): Promise<void> {
    const res = await raw(path, { query });
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download';
    const href = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href, download: name });
    a.click();
    URL.revokeObjectURL(href);
  },
};

/** Human-readable message for any error thrown by the client. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const first = Array.isArray(err.details) ? (err.details[0] as { path?: string; message?: string } | undefined) : undefined;
    return first?.message ? `${err.message}: ${first.path ? `${first.path} – ` : ''}${first.message}` : err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
