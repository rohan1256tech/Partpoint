import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { pushTokens } from '../src/db/schema.js';
import { deliveryOtp } from '../src/modules/orders/delivery-otp.js';
import { api, createTestApp, resetDb, signIn, testEnv, type TestContext } from './helpers.js';

describe('delivery OTP', () => {
  it('is a stable 4-digit code per order', () => {
    const a = deliveryOtp('secret-a', '6f1c2c1e-0000-4000-8000-000000000001');
    expect(a).toMatch(/^\d{4}$/);
    expect(deliveryOtp('secret-a', '6f1c2c1e-0000-4000-8000-000000000001')).toBe(a);
    expect(deliveryOtp('secret-b', '6f1c2c1e-0000-4000-8000-000000000001')).not.toBe(a);
  });
});

let t: TestContext;
let http: ReturnType<typeof api>;
let admin: string;
let wholesaler: { id: string; token: string };
let retailer: { id: string; token: string };
let rider: { id: string; token: string };
let variantId: string;
let addressId: string;
const otpSecret = testEnv().OTP_SECRET;

beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  http = api(t);
  admin = (await signIn(t, 'admin')).token;
  wholesaler = await signIn(t, 'wholesaler', { name: 'Bharat Spares' });
  retailer = await signIn(t, 'retailer');
  rider = await signIn(t, 'delivery', { name: 'Raju' });

  const categoryId = (await http.post('/v1/admin/categories', admin, { name: 'Engine' })).json().id;
  const p = (
    await http.post('/v1/wholesaler/products', wholesaler.token, {
      categoryId,
      name: 'Oil Filter',
      variants: [{ name: 'Single', mrpPaise: 45_000, pricePaise: 38_000, stockQty: 100 }],
    })
  ).json();
  await http.post(`/v1/wholesaler/products/${p.id}/publish`, wholesaler.token);
  variantId = p.variants[0].id;
  addressId = (
    await http.post('/v1/me/addresses', retailer.token, {
      contactName: 'Ravi',
      contactPhone: '9876543210',
      line1: 'Shop 4, Gandhi Market',
      city: 'Nashik',
      state: 'Maharashtra',
      pincode: '422001',
    })
  ).json().id;
});
afterEach(async () => {
  await t.close();
});

/** A packed order, ready for assignment. */
async function packedOrder(): Promise<string> {
  await http.put(`/v1/cart/items/${variantId}`, retailer.token, { qty: 2 });
  const id = (await http.post('/v1/orders', retailer.token, { addressId, idempotencyKey: `k-${Math.random()}` })).json()
    .orders[0].id;
  await http.post(`/v1/wholesaler/orders/${id}/accept`, wholesaler.token);
  await http.post(`/v1/wholesaler/orders/${id}/pack`, wholesaler.token);
  return id;
}

describe('delivery flow', () => {
  it('runs from assignment to OTP-confirmed delivery and records earnings', async () => {
    await http.patch('/v1/admin/settings', admin, { deliveryEarningPaise: 3_000 });
    const id = await packedOrder();

    const partners = (await http.get('/v1/admin/delivery-partners?available=true', admin)).json().items;
    expect(partners).toMatchObject([{ id: rider.id, name: 'Raju', isAvailable: true, activeDeliveries: 0 }]);

    const assigned = await http.post(`/v1/admin/orders/${id}/assign`, admin, { deliveryPartnerId: rider.id });
    expect(assigned.json()).toMatchObject({ status: 'assigned', deliveryAccepted: false, deliveryPartner: { name: 'Raju' } });

    // The rider sees the job, with pickup point and drop address.
    expect((await http.get('/v1/delivery/orders?scope=active', rider.token)).json().items.map((o: { id: string }) => o.id)).toEqual([id]);
    const job = (await http.get(`/v1/delivery/orders/${id}`, rider.token)).json();
    expect(job.pickup).toMatchObject({ businessName: 'Bharat Spares', city: 'Pune' });
    expect(job.address).toMatchObject({ line1: 'Shop 4, Gandhi Market', contactPhone: '+919876543210' });
    expect(job.commissionPaise).toBeNull();
    expect(job.deliveryOtp).toBeNull();

    const early = await http.post(`/v1/delivery/orders/${id}/pickup`, rider.token);
    expect(early.json().code).toBe('ACCEPT_FIRST');
    expect((await http.post(`/v1/delivery/orders/${id}/accept`, rider.token)).json().deliveryAccepted).toBe(true);
    expect((await http.post(`/v1/delivery/orders/${id}/pickup`, rider.token)).json().status).toBe('picked_up');

    // The retailer now sees the handover code and who is bringing the goods.
    const forRetailer = (await http.get(`/v1/orders/${id}`, retailer.token)).json();
    const code = deliveryOtp(otpSecret, id);
    expect(forRetailer.deliveryOtp).toBe(code);
    expect(forRetailer.deliveryPartner).toMatchObject({ name: 'Raju', phone: expect.stringMatching(/^\+91/) });

    await http.post(`/v1/delivery/orders/${id}/out-for-delivery`, rider.token);
    const wrong = code === '0000' ? '1111' : '0000';
    const bad = await http.post(`/v1/delivery/orders/${id}/deliver`, rider.token, { otp: wrong });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: 'DELIVERY_OTP_INVALID', error: 'Wrong code. 4 attempt(s) left' });

    const done = await http.post(`/v1/delivery/orders/${id}/deliver`, rider.token, { otp: code });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ status: 'delivered', deliveredAt: expect.any(String) });
    expect(done.json().timeline.map((e: { status: string }) => e.status)).toEqual([
      'placed',
      'accepted',
      'packed',
      'assigned',
      'assigned',
      'picked_up',
      'out_for_delivery',
      'delivered',
    ]);

    // After delivery the rider keeps only the area, not the address, phone or pickup details.
    const after = (await http.get(`/v1/delivery/orders/${id}`, rider.token)).json();
    expect(after.address).toEqual({ city: 'Nashik', state: 'Maharashtra', pincode: '422001' });
    expect(after.pickup).toBeNull();
    expect((await http.get(`/v1/orders/${id}`, retailer.token)).json().deliveryOtp).toBeNull();

    const earnings = (await http.get('/v1/delivery/earnings', rider.token)).json();
    expect(earnings).toMatchObject({ todayPaise: 3_000, allTimePaise: 3_000, unpaidPaise: 3_000, deliveredCount: 1 });
    expect(earnings.recent[0]).toMatchObject({ orderId: id, amountPaise: 3_000, paidOut: false });
    expect((await http.get('/v1/delivery/orders?scope=history', rider.token)).json().items).toHaveLength(1);
  });

  it('only assigns packed orders to approved, available delivery partners', async () => {
    await http.put(`/v1/cart/items/${variantId}`, retailer.token, { qty: 1 });
    const placed = (await http.post('/v1/orders', retailer.token, { addressId, idempotencyKey: 'not-packed-1' })).json()
      .orders[0].id;
    expect((await http.post(`/v1/admin/orders/${placed}/assign`, admin, { deliveryPartnerId: rider.id })).statusCode).toBe(409);

    const id = await packedOrder();
    await http.patch('/v1/delivery/availability', rider.token, { isAvailable: false });
    const off = await http.post(`/v1/admin/orders/${id}/assign`, admin, { deliveryPartnerId: rider.id });
    expect(off.json().code).toBe('PARTNER_UNAVAILABLE');
    const notRider = await http.post(`/v1/admin/orders/${id}/assign`, admin, { deliveryPartnerId: retailer.id });
    expect(notRider.json().code).toBe('PARTNER_NOT_FOUND');
  });

  it('sends a declined job back to the queue and removes the rider’s access', async () => {
    const id = await packedOrder();
    await http.post(`/v1/admin/orders/${id}/assign`, admin, { deliveryPartnerId: rider.id });
    expect((await http.post(`/v1/delivery/orders/${id}/decline`, rider.token, { reason: 'Bike puncture' })).statusCode).toBe(204);

    const o = (await http.get(`/v1/admin/orders/${id}`, admin)).json();
    expect(o).toMatchObject({ status: 'packed', deliveryPartner: null });
    expect(o.timeline.at(-1)).toMatchObject({ status: 'packed', note: 'Declined by delivery partner: Bike puncture' });
    expect((await http.get(`/v1/delivery/orders/${id}`, rider.token)).statusCode).toBe(404);
  });

  it('keeps riders out of each other’s jobs and tells a replaced rider', async () => {
    const other = await signIn(t, 'delivery', { name: 'Suresh' });
    const id = await packedOrder();
    await http.post(`/v1/admin/orders/${id}/assign`, admin, { deliveryPartnerId: rider.id });
    await http.put('/v1/me/push-token', rider.token, { token: 'rider-device-token-0000000001' });

    expect((await http.get(`/v1/delivery/orders/${id}`, other.token)).statusCode).toBe(404);
    expect((await http.post(`/v1/delivery/orders/${id}/accept`, other.token)).statusCode).toBe(404);

    await http.post(`/v1/admin/orders/${id}/assign`, admin, { deliveryPartnerId: other.id });
    expect((await http.get(`/v1/delivery/orders/${id}`, rider.token)).statusCode).toBe(404);
    expect((await http.get(`/v1/delivery/orders/${id}`, other.token)).statusCode).toBe(200);
    await t.pushes();
    expect(t.push.titlesFor('rider-device-token-0000000001')).toContain('Delivery reassigned');
  });

  it('locks the code after 5 wrong attempts until an admin resets it', async () => {
    const id = await packedOrder();
    await http.post(`/v1/admin/orders/${id}/assign`, admin, { deliveryPartnerId: rider.id });
    await http.post(`/v1/delivery/orders/${id}/accept`, rider.token);
    await http.post(`/v1/delivery/orders/${id}/pickup`, rider.token);
    const code = deliveryOtp(otpSecret, id);
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) await http.post(`/v1/delivery/orders/${id}/deliver`, rider.token, { otp: wrong });

    const locked = await http.post(`/v1/delivery/orders/${id}/deliver`, rider.token, { otp: code });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe('DELIVERY_OTP_LOCKED');

    await http.post(`/v1/admin/orders/${id}/reset-delivery-otp`, admin);
    expect((await http.post(`/v1/delivery/orders/${id}/deliver`, rider.token, { otp: code })).json().status).toBe('delivered');
  });

  it('is closed to other roles', async () => {
    expect((await http.get('/v1/delivery/orders', retailer.token)).statusCode).toBe(403);
    expect((await http.get('/v1/admin/delivery-partners', rider.token)).statusCode).toBe(403);
  });
});

describe('push notifications', () => {
  it('tells each party about the order events that concern them', async () => {
    await http.put('/v1/me/push-token', retailer.token, { token: 'retailer-device-token-000001' });
    await http.put('/v1/me/push-token', wholesaler.token, { token: 'wholesaler-device-token-0001' });
    await http.put('/v1/me/push-token', rider.token, { token: 'rider-device-token-0000000001' });

    const id = await packedOrder();
    await http.post(`/v1/admin/orders/${id}/assign`, admin, { deliveryPartnerId: rider.id });
    await t.pushes();

    expect(t.push.titlesFor('wholesaler-device-token-0001')).toEqual(['New order']);
    expect(t.push.titlesFor('retailer-device-token-000001')).toEqual(['Order accepted', 'Order packed']);
    expect(t.push.titlesFor('rider-device-token-0000000001')).toEqual(['New delivery']);
    const msg = t.push.sent.find((s) => s.message.title === 'New delivery')?.message;
    expect(msg?.data).toEqual({ type: 'order', orderId: id, status: 'assigned' });
    // No personal data in pushes: just the order number.
    expect(msg?.body).toMatch(/^PP-\d{8}-\d{6} is assigned to you$/);
  });

  it('tells a user when their account is approved', async () => {
    const pending = await signIn(t, 'retailer', { status: 'pending' });
    await http.put('/v1/me/push-token', pending.token, { token: 'pending-device-token-00000001' });
    await http.post(`/v1/admin/users/${pending.id}/approve`, admin, {});
    await t.pushes();
    expect(t.push.titlesFor('pending-device-token-00000001')).toEqual(['Account approved']);
  });

  it('forgets tokens of uninstalled apps', async () => {
    await http.put('/v1/me/push-token', wholesaler.token, { token: 'dead-device-token-0000000001' });
    await packedOrder();
    await t.pushes();
    expect(await t.db.select().from(pushTokens).where(eq(pushTokens.token, 'dead-device-token-0000000001'))).toEqual([]);
  });

  it('moves a device token to whoever signed in last', async () => {
    const token = 'shared-device-token-00000001';
    await http.put('/v1/me/push-token', retailer.token, { token });
    await http.put('/v1/me/push-token', wholesaler.token, { token });
    const rows = await t.db.select().from(pushTokens).where(eq(pushTokens.token, token));
    expect(rows.map((r) => r.userId)).toEqual([wholesaler.id]);
  });
});
