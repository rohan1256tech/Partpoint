import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { createTestApp, type TestContext } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
});

describe('error responses', () => {
  it('hides details of unexpected server errors', async () => {
    t = await createTestApp();
    t.app.get('/boom', async () => {
      throw new Error('connection string postgres://secret@db');
    });
    const res = await t.app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal Server Error', code: 'INTERNAL', statusCode: 500 });
  });

  it('passes through deliberate service errors', async () => {
    t = await createTestApp();
    t.app.get('/down', async () => {
      throw new AppError(503, 'DELIVERY_FAILED', 'Could not send the code');
    });
    const res = await t.app.inject({ method: 'GET', url: '/down' });
    expect(res.json()).toEqual({ error: 'Could not send the code', code: 'DELIVERY_FAILED', statusCode: 503 });
  });
});
