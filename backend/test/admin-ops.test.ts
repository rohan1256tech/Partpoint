import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { retailerProfiles } from '../src/db/schema.js';
import { csvCell, toCsv } from '../src/lib/csv.js';
import { deliveryOtp } from '../src/modules/orders/delivery-otp.js';
import { api, createTestApp, resetDb, signIn, testEnv, type TestContext } from './helpers.js';

const BOM = String.fromCharCode(0xfeff);

describe('CSV writer', () => {
  it('quotes and neutralises spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+91 98')).toBe("'+91 98");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe('-5'); // numbers are data, not formulas
    expect(csvCell(null)).toBe('');
    expect(toCsv(['a'], [['x']])).toBe(`${BOM}a\r\nx\r\n`);
  });
});

let t: TestContext;
let http: ReturnType<typeof api>;
let admin: string;
let wholesaler: { id: string; token: string };
let retailer: { id: string; token: string };
let rider: { id: string; token: string };
let productId: string;
let variantId: string;
let addressId: string;
const otpSecret = testEnv().OTP_SECRET;

beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  http = api(t);
  admin = (await signIn(t, 'admin')).token;
  wholesaler = await signIn(t, 'wholesaler', { name: 'Bharat Spares' });
  retailer = await signIn(t, 'retailer', { name: 'Ravi Sharma' });
  rider = await signIn(t, 'delivery');
  const categoryId = (await http.post('/v1/admin/categories', admin, { name: 'Engine' })).json().id;
  const p = (
    await http.post('/v1/wholesaler/products', wholesaler.token, {
      categoryId,
      name: 'Oil Filter',
      variants: [{ name: 'Single', mrpPaise: 50_000, pricePaise: 40_000, stockQty: 1_000 }],
    })
  ).json();
  await http.post(`/v1/wholesaler/products/${p.id}/publish`, wholesaler.token);
  productId = p.id;
  variantId = p.variants[0].id;
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

async function placedOrder(qty = 5, extra: Record<string, unknown> = {}): Promise<string> {
  await http.put(`/v1/cart/items/${variantId}`, retailer.token, { qty });
  const res = await http.post('/v1/orders', retailer.token, { addressId, idempotencyKey: `k-${Math.random()}`, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json().orders[0].id;
}

/** Runs an order all the way to delivered. 5 × ₹400 = ₹2,000 goods by default. */
async function deliveredOrder(qty = 5): Promise<string> {
  const id = await placedOrder(qty);
  await http.post(`/v1/wholesaler/orders/${id}/accept`, wholesaler.token);
  await http.post(`/v1/wholesaler/orders/${id}/pack`, wholesaler.token);
  await http.post(`/v1/admin/orders/${id}/assign`, admin, { deliveryPartnerId: rider.id });
  await http.post(`/v1/delivery/orders/${id}/accept`, rider.token);
  await http.post(`/v1/delivery/orders/${id}/pickup`, rider.token);
  const done = await http.post(`/v1/delivery/orders/${id}/deliver`, rider.token, { otp: deliveryOtp(otpSecret, id) });
  expect(done.json().status).toBe('delivered');
  return id;
}

describe('coupons (admin)', () => {
  it('creates coupons that work at checkout and counts their use', async () => {
    const c = await http.post('/v1/admin/coupons', admin, {
      code: 'diwali25',
      discountType: 'flat',
      discountValue: 25_000,
      minOrderPaise: 100_000,
    });
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ code: 'DIWALI25', isActive: true, perUserLimit: 1 });

    await placedOrder(5, { couponCode: 'DIWALI25' });
    const list = (await http.get('/v1/admin/coupons', admin)).json().items;
    expect(list[0]).toMatchObject({ code: 'DIWALI25', timesUsed: 1 });

    await http.patch(`/v1/admin/coupons/${c.json().id}`, admin, { isActive: false });
    await http.put(`/v1/cart/items/${variantId}`, retailer.token, { qty: 5 });
    expect((await http.get('/v1/cart?couponCode=DIWALI25', retailer.token)).json().couponError).toBe('This coupon is not valid');
  });

  it('validates coupon rules', async () => {
    await http.post('/v1/admin/coupons', admin, { code: 'SAVE10', discountType: 'percent', discountValue: 1000 });
    expect((await http.post('/v1/admin/coupons', admin, { code: 'save10', discountType: 'flat', discountValue: 1 })).statusCode).toBe(409);
    expect((await http.post('/v1/admin/coupons', admin, { code: 'TOOMUCH', discountType: 'percent', discountValue: 10_001 })).statusCode).toBe(400);
    const backwards = await http.post('/v1/admin/coupons', admin, {
      code: 'BACKWARDS',
      discountType: 'flat',
      discountValue: 100,
      startsAt: '2026-12-10T00:00:00+05:30',
      endsAt: '2026-12-01T00:00:00+05:30',
    });
    expect(backwards.json().error).toMatch(/end date/);
    expect((await http.post('/v1/admin/coupons', retailer.token, { code: 'HACK', discountType: 'flat', discountValue: 1 })).statusCode).toBe(403);
  });
});

describe('banners', () => {
  const imageKey = 'banners/0b8e3a6e-1f2a-4c1e-9d6b-2a7e5b9c1d00.webp';

  it('shows only live banners in order, and reflects edits immediately', async () => {
    const a = (await http.post('/v1/admin/banners', admin, { title: 'Diwali sale', imageKey, sortOrder: 2 })).json();
    await http.post('/v1/admin/banners', admin, { title: 'Brakes week', imageKey, sortOrder: 1, linkType: 'category', linkValue: a.id });
    await http.post('/v1/admin/banners', admin, { title: 'Old', imageKey, endsAt: '2020-01-01T00:00:00Z' });
    await http.post('/v1/admin/banners', admin, { title: 'Off', imageKey, isActive: false });

    const live = async () => (await http.get('/v1/banners', retailer.token)).json().items.map((b: { title: string }) => b.title);
    expect(await live()).toEqual(['Brakes week', 'Diwali sale']);
    expect((await http.get('/v1/banners', retailer.token)).json().items[1].imageUrl).toBe(`https://img.test/${imageKey}`);

    await http.patch(`/v1/admin/banners/${a.id}`, admin, { isActive: false });
    expect(await live()).toEqual(['Brakes week']);
    expect((await http.del(`/v1/admin/banners/${a.id}`, admin)).statusCode).toBe(204);
    expect((await http.get('/v1/admin/banners', admin)).json().items).toHaveLength(3);
  });

  it('validates banners', async () => {
    expect((await http.post('/v1/admin/banners', admin, { title: 'X', imageKey: 'products/x.webp' })).statusCode).toBe(400);
    const noLink = await http.post('/v1/admin/banners', admin, { title: 'X', imageKey, linkType: 'product' });
    expect(noLink.json().code).toBe('INVALID_BANNER');
  });
});

describe('reviews and moderation', () => {
  it('lets a retailer review products of a delivered order and keeps the rating current', async () => {
    const pending = await placedOrder(1);
    const early = await http.put(`/v1/orders/${pending}/reviews/${productId}`, retailer.token, { rating: 5 });
    expect(early.json().code).toBe('NOT_DELIVERED');

    const id = await deliveredOrder();
    expect((await http.put(`/v1/orders/${id}/reviews/${productId}`, retailer.token, { rating: 4, comment: 'Good fit' })).statusCode).toBe(200);
    let product = (await http.get(`/v1/products/${productId}`, retailer.token)).json();
    expect(product).toMatchObject({ ratingAvg: 4, ratingCount: 1 });

    // Editing replaces the review instead of adding another.
    await http.put(`/v1/orders/${id}/reviews/${productId}`, retailer.token, { rating: 2, comment: 'Leaked after a week' });
    product = (await http.get(`/v1/products/${productId}`, retailer.token)).json();
    expect(product).toMatchObject({ ratingAvg: 2, ratingCount: 1 });

    const reviews = (await http.get(`/v1/products/${productId}/reviews`, wholesaler.token)).json().items;
    expect(reviews).toEqual([
      { id: expect.any(String), rating: 2, comment: 'Leaked after a week', reviewerName: 'Ravi', createdAt: expect.any(String) },
    ]);
  });

  it('only accepts reviews from the order’s retailer, for products in it', async () => {
    const id = await deliveredOrder();
    const other = await signIn(t, 'retailer');
    expect((await http.put(`/v1/orders/${id}/reviews/${productId}`, other.token, { rating: 5 })).statusCode).toBe(404);
    const unrelated = '00000000-0000-4000-8000-000000000000';
    expect((await http.put(`/v1/orders/${id}/reviews/${unrelated}`, retailer.token, { rating: 5 })).json().code).toBe('NOT_IN_ORDER');
    expect((await http.put(`/v1/orders/${id}/reviews/${productId}`, retailer.token, { rating: 6 })).statusCode).toBe(400);
  });

  it('handles reports: the admin hides a review, which stops counting', async () => {
    const id = await deliveredOrder();
    const review = (await http.put(`/v1/orders/${id}/reviews/${productId}`, retailer.token, { rating: 1, comment: 'Spam spam' })).json();

    expect((await http.post(`/v1/reviews/${review.id}/report`, retailer.token, { reason: 'Mine' })).json().code).toBe('OWN_REVIEW');
    expect((await http.post(`/v1/reviews/${review.id}/report`, wholesaler.token, { reason: 'Fake review' })).statusCode).toBe(204);
    expect((await http.post(`/v1/reviews/${review.id}/report`, wholesaler.token, { reason: 'Again' })).statusCode).toBe(204);

    const queue = (await http.get('/v1/admin/reviews?reported=true', admin)).json().items;
    expect(queue).toMatchObject([{ id: review.id, openReports: 1, reportReasons: ['Fake review'], productName: 'Oil Filter' }]);

    expect((await http.post(`/v1/admin/reviews/${review.id}/hide`, admin)).statusCode).toBe(204);
    expect((await http.get(`/v1/products/${productId}/reviews`, retailer.token)).json().items).toEqual([]);
    expect((await http.get(`/v1/products/${productId}`, retailer.token)).json()).toMatchObject({ ratingAvg: 0, ratingCount: 0 });
    expect((await http.get('/v1/admin/reviews?reported=true', admin)).json().items).toEqual([]);

    await http.post(`/v1/admin/reviews/${review.id}/unhide`, admin);
    expect((await http.get(`/v1/products/${productId}`, retailer.token)).json().ratingCount).toBe(1);
  });
});

describe('finance', () => {
  it('tracks what each wholesaler is owed and the payouts against it', async () => {
    await deliveredOrder(5); // goods ₹2,000, commission 5% = ₹100 → owed ₹1,900
    await placedOrder(5); // not delivered: not owed yet

    const [row] = (await http.get('/v1/admin/finance/wholesalers', admin)).json().items;
    expect(row).toMatchObject({
      wholesalerId: wholesaler.id,
      deliveredOrders: 1,
      goodsPaise: 200_000,
      commissionPaise: 10_000,
      owedPaise: 190_000,
      paidPaise: 0,
      balancePaise: 190_000,
    });

    const tooMuch = await http.post(`/v1/admin/finance/wholesalers/${wholesaler.id}/payouts`, admin, {
      amountPaise: 190_001,
      reference: 'UTR123456',
    });
    expect(tooMuch.json()).toMatchObject({ code: 'PAYOUT_EXCEEDS_BALANCE', error: 'The outstanding balance is ₹1900.00' });

    const paid = await http.post(`/v1/admin/finance/wholesalers/${wholesaler.id}/payouts`, admin, {
      amountPaise: 150_000,
      reference: 'UTR123456',
    });
    expect(paid.statusCode).toBe(201);

    const mine = (await http.get('/v1/wholesaler/finance', wholesaler.token)).json();
    expect(mine.balance).toMatchObject({ paidPaise: 150_000, balancePaise: 40_000 });
    expect(mine.payouts).toMatchObject([{ amountPaise: 150_000, reference: 'UTR123456' }]);
  });

  it('never pays out more than the balance, even when two payouts race', async () => {
    await deliveredOrder(5);
    const pay = () =>
      http.post(`/v1/admin/finance/wholesalers/${wholesaler.id}/payouts`, admin, { amountPaise: 190_000, reference: 'UTR-RACE' });
    const results = await Promise.all([pay(), pay()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 400]);
    expect((await http.get('/v1/wholesaler/finance', wholesaler.token)).json().balance.balancePaise).toBe(0);
  });

  it('settles delivery partner earnings', async () => {
    await http.patch('/v1/admin/settings', admin, { deliveryEarningPaise: 3_000 });
    await deliveredOrder();
    await deliveredOrder();
    expect((await http.get('/v1/admin/finance/delivery', admin)).json().items).toMatchObject([
      { partnerId: rider.id, unpaidPaise: 6_000, unpaidDeliveries: 2 },
    ]);
    const settled = await http.post(`/v1/admin/finance/delivery/${rider.id}/settle`, admin, { reference: 'UPI-778899' });
    expect(settled.json()).toEqual({ amountPaise: 6_000, deliveries: 2 });
    expect((await http.get('/v1/delivery/earnings', rider.token)).json()).toMatchObject({ unpaidPaise: 0, allTimePaise: 6_000 });
    expect((await http.post(`/v1/admin/finance/delivery/${rider.id}/settle`, admin, { reference: 'UPI-778899' })).json().code).toBe(
      'NOTHING_TO_SETTLE',
    );
  });
});

describe('dashboard and reports', () => {
  it('summarises the business', async () => {
    await signIn(t, 'retailer', { status: 'pending' });
    await deliveredOrder(5);
    await placedOrder(2);
    const cancelled = await placedOrder(1);
    await http.post(`/v1/orders/${cancelled}/cancel`, retailer.token);

    const d = (await http.get('/v1/admin/dashboard', admin)).json();
    expect(d.users).toEqual({ pendingApprovals: 1, retailers: 1, wholesalers: 1, deliveryPartners: 1 });
    expect(d.orders).toMatchObject({ today: 2, thisMonth: 2, byStatus: { delivered: 1, placed: 1, cancelled: 1 } });
    expect(d.sales).toMatchObject({ gmvTodayPaise: 280_000, commissionThisMonthPaise: 10_000 });
    expect(d.last30Days).toHaveLength(30);
    expect(d.last30Days.at(-1)).toMatchObject({ orders: 2, gmvPaise: 280_000 });
    expect(d.topProducts[0]).toMatchObject({ name: 'Oil Filter', qty: 7 });
    expect((await http.get('/v1/admin/dashboard', wholesaler.token)).statusCode).toBe(403);
  });

  it('exports orders as CSV, safe to open in Excel', async () => {
    await t.db.update(retailerProfiles).set({ shopName: '=HYPERLINK("http://evil")' }).where(eq(retailerProfiles.userId, retailer.id));
    const id = await deliveredOrder(5);
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

    const res = await http.get(`/v1/admin/reports/orders.csv?from=${today}&to=${today}`, admin);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="partpoint-orders-${today}-to-${today}.csv"`);
    const lines = res.body.replace(BOM, '').trim().split('\r\n');
    expect(lines[0]).toMatch(/^Order number,Placed at \(IST\),Status,Retailer/);
    expect(lines).toHaveLength(2);
    const order = (await http.get(`/v1/admin/orders/${id}`, admin)).json();
    expect(lines[1]).toContain(order.orderNumber);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(lines[1]).toContain(',2000.00,0.00,0.00,2000.00,100.00,');
  });

  it('validates report ranges', async () => {
    expect((await http.get('/v1/admin/reports/orders.csv?from=2026-11-10&to=2026-11-01', admin)).statusCode).toBe(400);
    expect((await http.get('/v1/admin/reports/orders.csv?from=2024-01-01&to=2026-01-01', admin)).statusCode).toBe(400);
    expect((await http.get('/v1/admin/reports/orders.csv?from=yesterday&to=today', admin)).statusCode).toBe(400);
  });

  it('gives wholesalers their own sales report', async () => {
    await deliveredOrder(5);
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const report = (await http.get(`/v1/wholesaler/reports/sales?from=${today}&to=${today}`, wholesaler.token)).json();
    expect(report).toMatchObject({
      deliveredOrders: 1,
      goodsPaise: 200_000,
      commissionPaise: 10_000,
      netPaise: 190_000,
      products: [{ name: 'Oil Filter', variant: 'Single', qty: 5, salesPaise: 200_000 }],
    });
    const csv = await http.get(`/v1/wholesaler/reports/sales?from=${today}&to=${today}&format=csv`, wholesaler.token);
    expect(csv.body).toContain('Oil Filter,Single,5,2000.00');

    // Another wholesaler sees nothing of it.
    const other = await signIn(t, 'wholesaler');
    expect((await http.get(`/v1/wholesaler/reports/sales?from=${today}&to=${today}`, other.token)).json().deliveredOrders).toBe(0);
  });
});
