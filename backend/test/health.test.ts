import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/index.js';
import { FakeMessaging, testEnv } from './helpers.js';

const env = testEnv();
// Health tests stub the probe; the pool is never connected.
const { db, pool } = createDb(env.DATABASE_URL, 1);
let app: FastifyInstance | undefined;

afterAll(async () => {
  await pool.end();
});

afterEach(async () => {
  await app?.close();
});

const build = (postgres: () => Promise<void>) =>
  buildApp({ env, db, messaging: new FakeMessaging(), checks: { postgres } });

describe('GET /health', () => {
  it('returns 200 when postgres responds', async () => {
    app = await build(async () => {});
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', postgres: 'connected' });
  });

  it('returns 503 when postgres is down', async () => {
    app = await build(async () => {
      throw new Error('ECONNREFUSED');
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', postgres: 'unavailable' });
  });

  it('sets security headers', async () => {
    app = await build(async () => {});
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('does not leak internals on unknown routes', async () => {
    app = await build(async () => {});
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});
