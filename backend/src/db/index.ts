import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>['db'];

export function createDb(url: string, max = 10) {
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30_000 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}
