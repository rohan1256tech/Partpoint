import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { createDb } from './index.js';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL, 1);

try {
  await migrate(db, { migrationsFolder: './drizzle' });
  process.stdout.write('Migrations applied.\n');
} finally {
  await pool.end();
}
