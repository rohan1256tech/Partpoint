import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, createTestApp, resetDb, signIn, type TestContext } from './helpers.js';

let t: TestContext;
let http: ReturnType<typeof api>;

beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  http = api(t);
});
afterEach(async () => {
  await t.close();
});

async function withDevice(role: 'retailer' | 'wholesaler' | 'delivery', token: string, opts: { status?: 'pending' | 'approved' } = {}) {
  const u = await signIn(t, role, opts);
  expect((await http.put('/v1/me/push-token', u.token, { token })).statusCode).toBe(204);
  return u;
}

describe('admin announcements', () => {
  it('reaches approved users of the chosen role only, and is kept in the history', async () => {
    const admin = (await signIn(t, 'admin')).token;
    await withDevice('retailer', 'retailer-device-token-000000001');
    await withDevice('retailer', 'retailer-device-token-000000002');
    await withDevice('retailer', 'pending-retailer-token-0000003', { status: 'pending' });
    await withDevice('wholesaler', 'wholesaler-device-token-0000004');

    const sent = await http.post('/v1/admin/announcements', admin, { audience: 'retailer', title: 'Diwali offer', body: '10% off brake parts this week' });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ audience: 'retailer', recipients: 2, devices: 2 });
    await t.pushes();

    const reached = t.push.sent.map((s) => s.token).sort();
    expect(reached).toEqual(['retailer-device-token-000000001', 'retailer-device-token-000000002']);
    expect(t.push.sent[0]?.message).toMatchObject({ title: 'Diwali offer', data: { type: 'announcement' } });

    const history = (await http.get('/v1/admin/announcements', admin)).json().items;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ title: 'Diwali offer', audience: 'retailer', recipients: 2 });
  });

  it('can reach everyone, and validates and restricts input', async () => {
    const admin = (await signIn(t, 'admin')).token;
    await withDevice('retailer', 'retailer-device-token-000000001');
    await withDevice('delivery', 'delivery-device-token-000000001');
    const all = await http.post('/v1/admin/announcements', admin, { audience: 'all', title: 'App update', body: 'Please update to the latest version' });
    expect(all.json().recipients).toBe(2);

    expect((await http.post('/v1/admin/announcements', admin, { audience: 'all', title: 'x', body: 'y' })).statusCode).toBe(400);
    const retailer = await signIn(t, 'retailer');
    expect((await http.post('/v1/admin/announcements', retailer.token, { audience: 'all', title: 'Hello', body: 'Hello all' })).statusCode).toBe(403);
  });
});
