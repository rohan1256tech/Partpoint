import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/index.js';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL, env.DATABASE_POOL_MAX);

const app = await buildApp({
  env,
  db,
  checks: {
    postgres: async () => {
      await pool.query('SELECT 1');
    },
  },
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: env.PORT, host: env.HOST });
