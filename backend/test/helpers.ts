import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { createDb, type Database } from '../src/db/index.js';
import type { Messaging } from '../src/lib/messaging.js';
import { users, wholesalerProfiles, retailerProfiles } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/password.js';
import type { PresignedUpload, Storage, StoredObject } from '../src/lib/storage.js';
import { testDatabaseUrl } from './global-setup.js';

/** In-memory object store; tests "upload" with put(). */
export class FakeStorage implements Storage {
  readonly objects = new Map<string, StoredObject>();
  presignUpload(key: string, contentType: string, sizeBytes: number): PresignedUpload {
    const headers = { 'content-type': contentType, 'content-length': String(sizeBytes) };
    return { method: 'PUT', url: `https://r2.test/${key}?signed`, headers, expiresAt: new Date().toISOString() };
  }
  put(key: string, size = 20_000, contentType: string | null = 'image/webp') {
    this.objects.set(key, { size, contentType });
  }
  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
  publicUrl(key: string) {
    return `https://img.test/${key}`;
  }
}

export const DEMO_PHONE = '+919000000001';
export const DEMO_OTP = '123456';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testDatabaseUrl(),
    JWT_SECRET: 'test-jwt-secret-000000000000000000000000',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-0000000000000000000000',
    OTP_SECRET: 'test-otp-secret-000000000000000000000000000',
    DEMO_PHONES: DEMO_PHONE,
    DEMO_OTP,
    ...overrides,
  });
}

/** Records every message instead of sending it, so tests can read the codes. */
export class FakeMessaging implements Messaging {
  readonly sent: { to: string; code: string }[] = [];
  sms = { sendOtp: async (phone: string, code: string) => void this.sent.push({ to: phone, code }) };
  mail = {
    send: async (to: string, _subject: string, text: string) => {
      const code = /\b(\d{6})\b/.exec(text)?.[1] ?? '';
      this.sent.push({ to, code });
    },
  };
  lastCodeFor(to: string): string {
    const msg = this.sent.findLast((m) => m.to === to);
    if (!msg) throw new Error(`no message sent to ${to}`);
    return msg.code;
  }
}

export interface TestContext {
  app: FastifyInstance;
  db: Database;
  messaging: FakeMessaging;
  storage: FakeStorage;
  close: () => Promise<void>;
}

export async function createTestApp(
  envOverrides: Record<string, string> = {},
  opts: { realStorage?: boolean } = {},
): Promise<TestContext> {
  const env = testEnv(envOverrides);
  const { db, pool } = createDb(env.DATABASE_URL, 5);
  const messaging = new FakeMessaging();
  const storage = new FakeStorage();
  const app = await buildApp({
    env,
    db,
    messaging,
    ...(opts.realStorage ? {} : { storage }),
    checks: { postgres: async () => void (await pool.query('SELECT 1')) },
  });
  return {
    app,
    db,
    messaging,
    storage,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

let seq = 0;
const PASSWORD = 'test-password-123';
let passwordHash: Promise<string> | undefined;

/**
 * Creates a user directly in the database (approved by default) and signs in through the API.
 * Returns the user id and an access token.
 */
export async function signIn(
  t: TestContext,
  role: 'admin' | 'retailer' | 'wholesaler' | 'delivery',
  opts: { status?: 'pending' | 'approved' | 'blocked'; name?: string; city?: string } = {},
): Promise<{ id: string; token: string }> {
  passwordHash ??= hashPassword(PASSWORD);
  const email = `${role}-${++seq}@partpoint.test`;
  const [user] = await t.db
    .insert(users)
    .values({
      role,
      status: opts.status ?? 'approved',
      name: opts.name ?? `${role} ${seq}`,
      email,
      passwordHash: await passwordHash,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id });
  const id = (user as { id: string }).id;
  if (role === 'wholesaler') {
    await t.db.insert(wholesalerProfiles).values({
      userId: id,
      businessName: opts.name ?? `Wholesaler ${seq}`,
      addressLine: '1 Market Road',
      city: opts.city ?? 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    });
  }
  if (role === 'retailer') await t.db.insert(retailerProfiles).values({ userId: id, shopName: `Shop ${seq}` });

  const app = role === 'admin' ? 'admin' : role === 'delivery' ? 'delivery' : 'partpoint';
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/login/email',
    payload: { email, password: PASSWORD, app, deviceId: `device-${seq}-xxxx` },
  });
  if (res.statusCode !== 200) throw new Error(`signIn failed: ${res.statusCode} ${res.body}`);
  return { id, token: res.json().tokens.accessToken };
}

/** Thin inject wrapper: api(t).post(url, body, token). */
export function api(t: TestContext) {
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE') => (url: string, token?: string, payload?: unknown) =>
    t.app.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    });
  return { get: call('GET'), post: call('POST'), patch: call('PATCH'), del: call('DELETE') };
}

/** Empties every application table (migrations bookkeeping lives in another schema). */
export async function resetDb(db: Database): Promise<void> {
  const { rows } = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
}
