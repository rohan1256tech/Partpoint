import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { createDb, type Database } from '../src/db/index.js';
import type { Messaging } from '../src/lib/messaging.js';
import { testDatabaseUrl } from './global-setup.js';

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
  close: () => Promise<void>;
}

export async function createTestApp(envOverrides: Record<string, string> = {}): Promise<TestContext> {
  const env = testEnv(envOverrides);
  const { db, pool } = createDb(env.DATABASE_URL, 5);
  const messaging = new FakeMessaging();
  const app = await buildApp({
    env,
    db,
    messaging,
    checks: { postgres: async () => void (await pool.query('SELECT 1')) },
  });
  return {
    app,
    db,
    messaging,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
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
