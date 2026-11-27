import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { accountDeletionRequests, addresses, orders, products, retailerProfiles, sessions, supplierOffers, users } from '../src/db/schema.js';
import { api, catalogProduct, supply, createTestApp, resetDb, signIn, type TestContext } from './helpers.js';

let t: TestContext;
let http: ReturnType<typeof api>;
let admin: string;
let retailer: { id: string; token: string };
let wholesaler: { id: string; token: string };
let variantId: string;
let productId: string;
let addressId: string;

beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  http = api(t);
  admin = (await signIn(t, 'admin')).token;
  retailer = await signIn(t, 'retailer');
  wholesaler = await signIn(t, 'wholesaler');
  await t.db.update(users).set({ phone: '+919876543210' }).where(eq(users.id, retailer.id));
  const categoryId = (await http.post('/v1/admin/categories', admin, { name: 'Batteries' })).json().id;
  const p = await catalogProduct(http, admin, {
    categoryId,
    name: 'Battery for Redmi Note 12',
    variants: [{ name: '5000 mAh', mrpPaise: 50_000, pricePaise: 40_000 }],
  });
  productId = p.productId;
  variantId = p.variantId;
  await supply(http, wholesaler.token, variantId, 38_000, 100);
  addressId = (
    await http.post('/v1/me/addresses', retailer.token, {
      contactName: 'Ravi',
      contactPhone: '9876543210',
      line1: 'Shop 4',
      city: 'Nashik',
      state: 'Maharashtra',
      pincode: '422001',
    })
  ).json().id;
});
afterEach(async () => {
  await t.close();
});

describe('in-app account deletion', () => {
  it('erases personal data, signs the user out everywhere and frees the phone number', async () => {
    await http.put(`/v1/cart/items/${variantId}`, retailer.token, { qty: 1 });
    await http.put(`/v1/wishlist/${productId}`, retailer.token);
    await http.put('/v1/me/push-token', retailer.token, { token: 'retailer-device-token-000001' });

    const res = await http.post('/v1/me/delete-account', retailer.token, { confirm: true, reason: 'Closing shop' });
    expect(res.statusCode).toBe(204);

    const [u] = await t.db.select().from(users).where(eq(users.id, retailer.id));
    expect(u).toMatchObject({ name: 'Deleted user', phone: null, email: null, passwordHash: null });
    expect(u?.deletedAt).toBeInstanceOf(Date);
    const [shop] = await t.db.select().from(retailerProfiles).where(eq(retailerProfiles.userId, retailer.id));
    expect(shop).toMatchObject({ shopName: 'Deleted shop', gstin: null });
    expect(await t.db.select().from(addresses).where(eq(addresses.userId, retailer.id))).toEqual([]);
    const live = await t.db.select().from(sessions).where(eq(sessions.userId, retailer.id));
    expect(live.every((s) => s.revokedAt)).toBe(true);

    expect((await http.get('/v1/me', retailer.token)).statusCode).toBe(401);

    const [req] = await t.db.select().from(accountDeletionRequests);
    expect(req).toMatchObject({ source: 'app', status: 'completed', contact: '+919876543210', reason: 'Closing shop' });

    // The number can be used for a new account.
    await post('/v1/auth/otp/request', { phone: '9876543210' });
    const code = t.messaging.lastCodeFor('+919876543210');
    const verify = await post('/v1/auth/otp/verify', { phone: '9876543210', code, app: 'partpoint', deviceId: 'new-device-01' });
    expect(verify.json().status).toBe('registration_required');
  });

  it('waits until orders in progress are finished, and keeps order records', async () => {
    await http.put(`/v1/cart/items/${variantId}`, retailer.token, { qty: 1 });
    const orderId = (await http.post('/v1/orders', retailer.token, { addressId, idempotencyKey: 'del-order-01' })).json().orders[0].id;

    const blocked = await http.post('/v1/me/delete-account', retailer.token, { confirm: true });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('HAS_OPEN_ORDERS');

    await http.post(`/v1/orders/${orderId}/cancel`, retailer.token);
    expect((await http.post('/v1/me/delete-account', retailer.token, { confirm: true })).statusCode).toBe(204);
    expect(await t.db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId))).toHaveLength(1);
  });

  it('takes a deleted wholesaler’s stock off sale but keeps the catalog product', async () => {
    expect((await http.post('/v1/me/delete-account', wholesaler.token, { confirm: true })).statusCode).toBe(204);
    const [offer] = await t.db.select().from(supplierOffers).where(eq(supplierOffers.wholesalerId, wholesaler.id));
    expect(offer?.isActive).toBe(false);
    const [p] = await t.db.select({ status: products.status }).from(products).where(eq(products.id, productId));
    expect(p?.status).toBe('active');
  });

  it('requires explicit confirmation, works while pending, and is not for admins', async () => {
    expect((await http.post('/v1/me/delete-account', retailer.token, {})).statusCode).toBe(400);
    const pending = await signIn(t, 'delivery', { status: 'pending' });
    expect((await http.post('/v1/me/delete-account', pending.token, { confirm: true })).statusCode).toBe(204);
    expect((await http.post('/v1/me/delete-account', admin, { confirm: true })).statusCode).toBe(403);
  });
});

describe('web deletion requests', () => {
  it('serves a public page with the request form', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/account/delete' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.body).toContain('Delete your Partpoint account');
    expect(res.body).toContain('/v1/account-deletion-requests');
  });

  it('accepts requests without revealing whether an account exists', async () => {
    const known = await post('/v1/account-deletion-requests', { contact: '98765 43210', reason: 'No longer needed' });
    const unknown = await post('/v1/account-deletion-requests', { contact: 'nobody@example.com' });
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.json()).toEqual(unknown.json());
    expect((await post('/v1/account-deletion-requests', { contact: 'not a contact' })).statusCode).toBe(400);
  });

  it('lets the admin complete or reject requests', async () => {
    await post('/v1/account-deletion-requests', { contact: '+919876543210' });
    await post('/v1/account-deletion-requests', { contact: 'nobody@example.com' });
    const queue = (await http.get('/v1/admin/account-deletion-requests?status=requested', admin)).json().items;
    expect(queue).toHaveLength(2);
    const mine = queue.find((r: { contact: string }) => r.contact === '+919876543210');
    const ghost = queue.find((r: { contact: string }) => r.contact === 'nobody@example.com');
    expect(mine.userId).toBe(retailer.id);

    expect((await http.post(`/v1/admin/account-deletion-requests/${mine.id}/complete`, admin, {})).statusCode).toBe(204);
    expect((await t.db.select().from(users).where(eq(users.id, retailer.id)))[0]?.deletedAt).toBeInstanceOf(Date);
    expect((await http.post(`/v1/admin/account-deletion-requests/${mine.id}/complete`, admin, {})).json().code).toBe('ALREADY_PROCESSED');

    expect((await http.post(`/v1/admin/account-deletion-requests/${ghost.id}/reject`, admin, {})).statusCode).toBe(400);
    await http.post(`/v1/admin/account-deletion-requests/${ghost.id}/reject`, admin, { note: 'Could not verify requester' });
    const done = (await http.get('/v1/admin/account-deletion-requests', admin)).json().items;
    expect(done.map((r: { status: string }) => r.status).sort()).toEqual(['completed', 'rejected']);
  });
});

function post(url: string, payload: unknown) {
  return t.app.inject({ method: 'POST', url, payload: payload as object });
}
