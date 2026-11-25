import { existsSync } from 'node:fs';
import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';

/**
 * Integration tests run against a real Postgres in a separate `<db>_test` database.
 * URL: TEST_DATABASE_URL, else DATABASE_URL (from the environment or backend/.env) with `_test` appended.
 */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Set TEST_DATABASE_URL or DATABASE_URL to run integration tests');
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/^\//, '')}_test`;
  return url.toString();
}

export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/i.test(dbName)) throw new Error(`Unsafe test database name: ${dbName}`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }

  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
  process.env.TEST_DATABASE_URL = url.toString();
}
