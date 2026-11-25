import type { Env } from '../config/env.js';
import { AppError } from './errors.js';
import { presignUrl } from './sigv4.js';

export interface PresignedUpload {
  method: 'PUT';
  url: string;
  /** The client must send exactly these headers; they are part of the signature. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface StoredObject {
  size: number;
  contentType: string | null;
}

/** Object storage for images. Bytes never pass through the API: clients upload directly. */
export interface Storage {
  presignUpload(key: string, contentType: string, sizeBytes: number): PresignedUpload;
  /** Returns null when the object does not exist. */
  head(key: string): Promise<StoredObject | null>;
  publicUrl(key: string): string;
}

export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export class R2Storage implements Storage {
  private readonly host: string;

  constructor(
    private readonly cfg: {
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
      publicBaseUrl: string;
    },
  ) {
    this.host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  }

  private sign(method: 'PUT' | 'HEAD', key: string, expires: number, headers?: Record<string, string>) {
    return presignUrl({
      method,
      host: this.host,
      path: `/${this.cfg.bucket}/${key}`,
      region: 'auto',
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      expiresInSeconds: expires,
      ...(headers ? { headers } : {}),
    });
  }

  presignUpload(key: string, contentType: string, sizeBytes: number): PresignedUpload {
    const headers = { 'content-type': contentType, 'content-length': String(sizeBytes) };
    return {
      method: 'PUT',
      url: this.sign('PUT', key, UPLOAD_URL_TTL_SECONDS, headers),
      headers,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async head(key: string): Promise<StoredObject | null> {
    const res = await fetch(this.sign('HEAD', key, 60), { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 HEAD responded ${res.status}`);
    return { size: Number(res.headers.get('content-length') ?? 0), contentType: res.headers.get('content-type') };
  }

  publicUrl(key: string): string {
    return `${this.cfg.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
}

/** Used when R2 is not configured (local development without credentials). */
export class UnconfiguredStorage implements Storage {
  constructor(private readonly publicBaseUrl = 'http://localhost/r2-not-configured') {}
  presignUpload(): PresignedUpload {
    throw new AppError(503, 'STORAGE_NOT_CONFIGURED', 'Image storage is not configured');
  }
  async head(): Promise<StoredObject | null> {
    return null;
  }
  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }
}

export function createStorage(env: Env): Storage {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL } = env;
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME && R2_PUBLIC_URL) {
    return new R2Storage({
      accountId: R2_ACCOUNT_ID,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      bucket: R2_BUCKET_NAME,
      publicBaseUrl: R2_PUBLIC_URL,
    });
  }
  return new UnconfiguredStorage(R2_PUBLIC_URL);
}
