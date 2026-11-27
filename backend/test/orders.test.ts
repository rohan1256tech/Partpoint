import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, coupons, productVariants, supplierOffers } from '../src/db/schema.js';
import { allocate, couponDiscount, marginFor, orderTotals, splitTotals } from '../src/modules/orders/pricing.js';
import { partNumber } from '../src/modules/orders/orders.service.js';
import { api, catalogProduct, createTestApp, forward, resetDb, signIn, supply, type TestContext } from './helpers.js';

// ---------------------------------------------------------------- pure money maths

describe('order pricing', () => {
  it('allocates a discount exactly, in whole paise', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [30_000, 10_000])).toEqual([750, 250]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    for (const [total, weights] of [
      [997, [3, 7, 11, 13]],
      [1, [1, 1]],
      [12_345, [99_999, 1]],
    ] as const) {
      expect(allocate(total, weights).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('splits an order into parts that add up to it, with the delivery fee on the first part', () => {
    const whole = orderTotals(400_000, 10_001, 4_000);
    const parts = splitTotals([300_000, 100_000], whole);
    expect(parts).toEqual([
      { subtotalPaise: 300_000, discountPaise: 7_501, deliveryFeePaise: 4_000, totalPaise: 296_499 },
      { subtotalPaise: 100_000, discountPaise: 2_500, deliveryFeePaise: 0, totalPaise: 97_500 },
    ]);
    expect(parts.reduce((s, p) => s + p.totalPaise, 0)).toBe(whole.totalPaise);
  });

  it('computes the margin on goods after discount, and numbers split parts', () => {
    expect(marginFor({ subtotalPaise: 100_000, discountPaise: 10_000 }, 80_000)).toBe(10_000);
    expect(orderTotals(5_000, 9_000, 0).discountPaise).toBe(5_000); // never more than the goods
    expect(partNumber('PP-20261127-000042', 2)).toBe('PP-20261127-000042-2');
    expect(partNumber('PP-20261127-000042-2', 3)).toBe('PP-20261127-000042-3');
  });

  it('caps coupon discounts', () => {
    expect(couponDiscount({ discountType: 'percent', discountValue: 1000, maxDiscountPaise: 5_000 }, 100_000)).toBe(5_000);
    expect(couponDiscount({ discountType: 'percent', discountValue: 1000, maxDiscountPaise: null }, 100_000)).toBe(10_000);
    expect(couponDiscount({ discountType: 'flat', discountValue: 50_000, maxDiscountPaise: null }, 20_000)).toBe(20_000);
  });
});

// ---------------------------------------------------------------- API

let t: TestContext;
let http: ReturnType<typeof api>;
let admin: string;
let w1: { id: string; token: string };
let w2: { id: string; token: string };
let retailer: { id: string; token: string };
let addressId: string;
/**
 * display: ₹380 (10+ at ₹350). w1 (Nashik) supplies 120 at ₹340, w2 (Pune) supplies 3 at ₹330.
 * battery: ₹900, MOQ 2. Only w2 supplies it: 5 at ₹800.
 */
let display: string;
let battery: string;

beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  http = api(t);
  admin = (await signIn(t, 'admin')).token;
  const categoryId = (await http.post('/v1/admin/categories', admin, { name: 'Displays' })).json().id;
  w1 = await signIn(t, 'wholesaler', { name: 'Lamington Mobile Hub', city: 'Nashik' });
  w2 = await signIn(t, 'wholesaler', { name: 'Karol Bagh Parts', city: 'Pune' });
  retailer = await signIn(t, 'retailer');

  display = (
    await catalogProduct(http, admin, {
      categoryId,
      name: 'Display for Galaxy A15',
      hsnCode: '85177900',
      variants: [{ name: 'Black', mrpPaise: 45_000, pricePaise: 38_000, slabs: [{ minQty: 10, pricePaise: 35_000 }] }],
    })
  ).variantId;
  battery = (
    await catalogProduct(http, admin, {
      categoryId,
      name: 'Battery for Redmi Note 12',
      variants: [{ name: '5000 mAh', mrpPaise: 120_000, pricePaise: 90_000, minOrderQty: 2 }],
    })
  ).variantId;
  await supply(http, w1.token, display, 34_000, 120);
  await supply(http, w2.token, display, 33_000, 3);
  await supply(http, w2.token, battery, 80_000, 5);

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

const stockOf = async (wholesalerId: string, variantId: string) =>
  (
    await t.db
      .select({ s: supplierOffers.stockQty })
      .from(supplierOffers)
      .where(and(eq(supplierOffers.wholesalerId, wholesalerId), eq(supplierOffers.variantId, variantId)))
  )[0]?.s;

const place = (token = retailer.token, extra: Record<string, unknown> = {}) =>
  http.post('/v1/orders', token, { addressId, idempotencyKey: `key-${Math.random()}`, ...extra });

async function orderOf(lines: [string, number][]) {
  for (const [variant, qty] of lines) await http.put(`/v1/cart/items/${variant}`, retailer.token, { qty });
  const res = await place();
  expect(res.statusCode).toBe(201);
  return res.json().orders[0].id as string;
}

describe('addresses', () => {
  it('makes the first address the default and keeps exactly one default', async () => {
    const list = async () => (await http.get('/v1/me/addresses', retailer.token)).json().items;
    expect((await list())[0]).toMatchObject({ id: addressId, isDefault: true, contactPhone: '+919876543210' });

    const second = (
      await http.post('/v1/me/addresses', retailer.token, {
        label: 'Godown',
        contactName: 'Ravi',
        contactPhone: '9876543210',
        line1: 'Plot 9',
        city: 'Nashik',
        state: 'Maharashtra',
        pincode: '422002',
        isDefault: true,
      })
    ).json();
    expect((await list()).filter((a: { isDefault: boolean }) => a.isDefault).map((a: { id: string }) => a.id)).toEqual([second.id]);

    await http.del(`/v1/me/addresses/${second.id}`, retailer.token);
    expect((await list())[0]).toMatchObject({ id: addressId, isDefault: true });
  });

  it('keeps addresses private to their owner', async () => {
    const other = await signIn(t, 'retailer');
    expect((await http.patch(`/v1/me/addresses/${addressId}`, other.token, { city: 'X' })).statusCode).toBe(404);
    expect((await http.del(`/v1/me/addresses/${addressId}`, other.token)).statusCode).toBe(404);
    expect((await http.get('/v1/me/addresses', other.token)).json().items).toEqual([]);
  });
});

describe('wishlist', () => {
  it('adds, lists and removes; hidden products drop out', async () => {
    const productId = (await http.get(`/v1/products?q=galaxy`, retailer.token)).json().items[0].id;
    expect((await http.put(`/v1/wishlist/${productId}`, retailer.token)).statusCode).toBe(204);
    expect((await http.put(`/v1/wishlist/${productId}`, retailer.token)).statusCode).toBe(204); // idempotent
    expect((await http.get('/v1/wishlist', retailer.token)).json().items.map((p: { id: string }) => p.id)).toEqual([productId]);

    await http.post(`/v1/admin/products/${productId}/hide`, admin, {});
    expect((await http.get('/v1/wishlist', retailer.token)).json().items).toEqual([]);
    expect((await http.put(`/v1/wishlist/${productId}`, retailer.token)).statusCode).toBe(404);

    expect((await http.del(`/v1/wishlist/${productId}`, retailer.token)).statusCode).toBe(204);
  });
});

describe('cart', () => {
  it('prices lines with bulk slabs as one Partpoint order, without supplier names', async () => {
    await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 10 });
    const cart = (await http.put(`/v1/cart/items/${battery}`, retailer.token, { qty: 2 })).json();

    expect(cart.groups).toBeUndefined();
    const line = cart.lines.find((l: { variantId: string }) => l.variantId === display);
    expect(line).toMatchObject({ qty: 10, unitPricePaise: 35_000, lineTotalPaise: 350_000, stockQty: 123, issue: null });
    expect(cart).toMatchObject({ subtotalPaise: 530_000, totalPaise: 530_000, canCheckout: true, itemCount: 2 });
    expect(JSON.stringify(cart)).not.toMatch(/Lamington|Karol/);
  });

  it('enforces minimum quantity and the stock all suppliers have together', async () => {
    expect((await http.put(`/v1/cart/items/${battery}`, retailer.token, { qty: 1 })).json().code).toBe('BELOW_MIN_QTY');
    expect((await http.put(`/v1/cart/items/${battery}`, retailer.token, { qty: 6 })).json().code).toBe('OUT_OF_STOCK');
    expect((await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 123 })).statusCode).toBe(200);
    expect((await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 124 })).json().code).toBe('OUT_OF_STOCK');
  });

  it('stops counting stock of a switched-off offer or a blocked wholesaler', async () => {
    await http.put(`/v1/wholesaler/catalog/variants/${battery}/offer`, w2.token, {
      supplyPricePaise: 80_000,
      stockQty: 5,
      isActive: false,
    });
    expect((await http.put(`/v1/cart/items/${battery}`, retailer.token, { qty: 2 })).json().code).toBe('OUT_OF_STOCK');
    await http.post(`/v1/admin/users/${w1.id}/block`, admin, { reason: 'KYC expired' });
    expect((await http.get(`/v1/products?q=galaxy`, retailer.token)).json().items[0].totalStock).toBe(3);
  });

  it('flags lines that became unavailable and blocks checkout', async () => {
    await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 1 });
    await t.db.update(productVariants).set({ isActive: false }).where(eq(productVariants.id, display));
    const cart = (await http.get('/v1/cart', retailer.token)).json();
    expect(cart.lines[0].issue).toBe('UNAVAILABLE');
    expect(cart.canCheckout).toBe(false);
    const res = await place();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CART_NEEDS_ATTENTION');
  });

  it('is only for retailers', async () => {
    expect((await http.get('/v1/cart', w1.token)).statusCode).toBe(403);
  });
});

describe('placing orders', () => {
  it('creates one order for the admin, takes no stock yet and empties the cart', async () => {
    await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 10 });
    await http.put(`/v1/cart/items/${battery}`, retailer.token, { qty: 2 });

    const res = await place();
    expect(res.statusCode).toBe(201);
    const placed = res.json();
    expect(placed.orders).toHaveLength(1);
    expect(placed.orders[0]).toMatchObject({ totalPaise: 530_000, orderNumber: expect.stringMatching(/^PP-\d{8}-\d{6}$/) });
    expect(await stockOf(w1.id, display)).toBe(120);
    expect((await http.get('/v1/cart', retailer.token)).json().itemCount).toBe(0);

    const detail = (await http.get(`/v1/orders/${placed.orders[0].id}`, retailer.token)).json();
    expect(detail).toMatchObject({ status: 'placed', wholesaler: null, commissionPaise: null, address: { line1: 'Shop 4, Gandhi Market' } });
    expect(detail.timeline).toEqual([{ status: 'placed', note: null, at: expect.any(String) }]);

    // It waits in the admin's queue; no wholesaler can see it yet.
    expect((await http.get('/v1/admin/orders?status=placed', admin)).json().items).toHaveLength(1);
    expect((await http.get('/v1/wholesaler/orders', w1.token)).json().items).toEqual([]);
  });

  it('returns the same order for a retried request', async () => {
    await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 3 });
    const body = { addressId, idempotencyKey: 'retry-key-0001' };
    const [a, b] = await Promise.all([http.post('/v1/orders', retailer.token, body), http.post('/v1/orders', retailer.token, body)]);
    const ok = [a, b].filter((r) => r.statusCode === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await http.post('/v1/orders', retailer.token, body);
    expect(again.json().checkoutId).toBe(ok[0]?.json().checkoutId);
    expect((await http.get('/v1/orders', retailer.token)).json().items).toHaveLength(1);
  });

  it('rejects an empty cart and someone else’s address', async () => {
    expect((await place()).json().code).toBe('CART_EMPTY');
    const other = await signIn(t, 'retailer');
    await http.put(`/v1/cart/items/${display}`, other.token, { qty: 1 });
    expect((await http.post('/v1/orders', other.token, { addressId, idempotencyKey: 'steal-address' })).statusCode).toBe(404);
  });
});

describe('the admin choosing wholesalers', () => {
  it('lists who can supply each item and suggests one who has everything', async () => {
    const id = await orderOf([
      [display, 2],
      [battery, 2],
    ]);
    const options = (await http.get(`/v1/admin/orders/${id}/suppliers`, admin)).json();
    expect(options.deliveryArea).toEqual({ city: 'Nashik', state: 'Maharashtra', pincode: '422001' });
    const [first, second] = options.wholesalers;
    expect(first).toMatchObject({ id: w2.id, coversAll: true, supplyTotalPaise: 2 * 33_000 + 2 * 80_000 });
    expect(second).toMatchObject({ id: w1.id, coversAll: false, sameCity: true, supplyTotalPaise: 2 * 34_000 });
    expect(options.suggestedWholesalerId).toBe(w2.id);
    expect(options.items.find((i: { productName: string }) => i.productName.startsWith('Display')).offers).toHaveLength(2);
  });

  it('prefers a wholesaler in the delivery city when the price is close', async () => {
    await supply(http, w1.token, display, 33_500, 120); // 1.5% dearer than w2, but in Nashik
    const id = await orderOf([[display, 2]]);
    expect((await http.get(`/v1/admin/orders/${id}/suppliers`, admin)).json().suggestedWholesalerId).toBe(w1.id);
  });

  it('forwards a whole order: stock is taken and supply prices are frozen', async () => {
    const id = await orderOf([[display, 10]]);
    const fwd = await forward(http, admin, id, w1.id);
    expect(fwd).toMatchObject({
      status: 'forwarded',
      wholesaler: { id: w1.id, businessName: 'Lamington Mobile Hub' },
      supplyTotalPaise: 340_000,
      commissionPaise: 350_000 - 340_000,
    });
    expect(await stockOf(w1.id, display)).toBe(110);

    // Supply prices stay as they were at forwarding, whatever the wholesaler changes later.
    await supply(http, w1.token, display, 36_000, 110);
    expect((await http.get(`/v1/wholesaler/orders/${id}`, w1.token)).json()).toMatchObject({
      supplyTotalPaise: 340_000,
      commissionPaise: null,
      address: { city: 'Nashik', state: 'Maharashtra', pincode: '422001' },
    });
    // The retailer still buys from Partpoint.
    const forRetailer = (await http.get(`/v1/orders/${id}`, retailer.token)).json();
    expect(forRetailer).toMatchObject({ status: 'forwarded', wholesaler: null, supplyTotalPaise: null });
    expect(forRetailer.items[0].supplyUnitPricePaise).toBeNull();
    expect(forRetailer.timeline.map((e: { status: string }) => e.status)).toEqual(['placed']);

    expect((await http.post(`/v1/admin/orders/${id}/forward`, admin, { wholesalerId: w2.id })).statusCode).toBe(409);
  });

  it('splits an order across wholesalers into parts that add up to the original', async () => {
    await t.db.insert(coupons).values({ code: 'SAVE', discountType: 'flat', discountValue: 10_001, minOrderPaise: 0, perUserLimit: 5 });
    await http.patch('/v1/admin/settings', admin, { deliveryFeePaise: 4_000 });
    await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 10 }); // ₹3,500
    await http.put(`/v1/cart/items/${battery}`, retailer.token, { qty: 2 }); // ₹1,800
    const placed = (await place(retailer.token, { couponCode: 'SAVE' })).json();
    const id = placed.orders[0].id;
    const items = (await http.get(`/v1/admin/orders/${id}`, admin)).json().items;
    const itemOf = (name: string) => items.find((i: { productName: string }) => i.productName.startsWith(name)).id;

    const res = await http.post(`/v1/admin/orders/${id}/forward`, admin, {
      assignments: [
        { itemId: itemOf('Display'), wholesalerId: w1.id },
        { itemId: itemOf('Battery'), wholesalerId: w2.id },
      ],
    });
    expect(res.statusCode).toBe(200);
    const first = res.json();
    expect(first.siblings).toHaveLength(1);
    const part2 = (await http.get(`/v1/admin/orders/${first.siblings[0].id}`, admin)).json();
    expect(part2.orderNumber).toBe(`${first.orderNumber}-2`);
    expect(first.items.map((i: { productName: string }) => i.productName)).toEqual(['Display for Galaxy A15']);
    expect(part2).toMatchObject({ status: 'forwarded', wholesaler: { id: w2.id }, deliveryFeePaise: 0, itemCount: 1 });
    expect(first.deliveryFeePaise).toBe(4_000);
    expect(first.totalPaise + part2.totalPaise).toBe(placed.totalPaise);
    expect(first.discountPaise + part2.discountPaise).toBe(10_001);
    expect(part2.commissionPaise).toBe(180_000 - part2.discountPaise - 160_000);

    // Each wholesaler sees only its own part; the retailer sees both, without names.
    expect((await http.get('/v1/wholesaler/orders', w1.token)).json().items.map((o: { id: string }) => o.id)).toEqual([id]);
    expect((await http.get('/v1/wholesaler/orders', w2.token)).json().items.map((o: { id: string }) => o.id)).toEqual([part2.id]);
    const mine = (await http.get('/v1/orders', retailer.token)).json().items;
    expect(mine).toHaveLength(2);
    expect(mine.every((o: { wholesaler: unknown }) => o.wholesaler === null)).toBe(true);
  });

  it('refuses a wholesaler without enough stock, and every item needs a wholesaler', async () => {
    const id = await orderOf([
      [display, 5],
      [battery, 2],
    ]);
    const short = await http.post(`/v1/admin/orders/${id}/forward`, admin, { wholesalerId: w2.id });
    expect(short.statusCode).toBe(409);
    expect(short.json().code).toBe('SUPPLIER_OUT_OF_STOCK');
    expect(short.json().error).toMatch(/has 3 of Display for Galaxy A15/);
    expect(await stockOf(w2.id, battery)).toBe(5); // nothing taken

    expect((await http.post(`/v1/admin/orders/${id}/forward`, admin, { wholesalerId: w1.id })).json().code).toBe('SUPPLIER_OUT_OF_STOCK');
    expect((await http.post(`/v1/admin/orders/${id}/forward`, admin, {})).statusCode).toBe(400);
    expect((await http.post(`/v1/admin/orders/${id}/forward`, admin, { wholesalerId: retailer.id })).json().code).toBe(
      'INVALID_WHOLESALER',
    );
    expect((await http.post(`/v1/admin/orders/${id}/forward`, w1.token, { wholesalerId: w1.id })).statusCode).toBe(403);
  });

  it('never takes more than a wholesaler has when two orders race for the last units', async () => {
    const a = await orderOf([[battery, 3]]);
    const b = await orderOf([[battery, 3]]);
    const results = await Promise.all([
      http.post(`/v1/admin/orders/${a}/forward`, admin, { wholesalerId: w2.id }),
      http.post(`/v1/admin/orders/${b}/forward`, admin, { wholesalerId: w2.id }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await stockOf(w2.id, battery)).toBe(2);
  });
});

describe('coupons and settings', () => {
  beforeEach(async () => {
    await t.db.insert(coupons).values({
      code: 'WELCOME10',
      discountType: 'percent',
      discountValue: 1000,
      maxDiscountPaise: 50_000,
      minOrderPaise: 100_000,
      perUserLimit: 1,
    });
  });

  it('previews and applies a coupon once per retailer', async () => {
    await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 10 }); // 3,500.00
    await http.put(`/v1/cart/items/${battery}`, retailer.token, { qty: 2 }); // 1,800.00
    const preview = (await http.get('/v1/cart?couponCode=welcome10', retailer.token)).json();
    expect(preview.coupon).toEqual({ code: 'WELCOME10', discountPaise: 50_000 }); // 10% capped at ₹500
    expect(preview.totalPaise).toBe(480_000);

    const placed = (await place(retailer.token, { couponCode: 'welcome10' })).json();
    expect(placed).toMatchObject({ discountPaise: 50_000, totalPaise: 480_000 });

    await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 10 });
    const second = await place(retailer.token, { couponCode: 'WELCOME10' });
    expect(second.statusCode).toBe(400);
    expect(second.json()).toMatchObject({ code: 'COUPON_INVALID', error: 'You have already used this coupon' });
  });

  it('explains why a coupon does not apply', async () => {
    await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 1 });
    const cart = (await http.get('/v1/cart?couponCode=WELCOME10', retailer.token)).json();
    expect(cart.coupon).toBeNull();
    expect(cart.couponError).toMatch(/Add items worth ₹620 more/);
  });

  it('applies the admin delivery fee once per order and the minimum order value', async () => {
    const s = await http.patch('/v1/admin/settings', admin, { deliveryFeePaise: 4_000, minOrderPaise: 50_000 });
    expect(s.json()).toMatchObject({ deliveryFeePaise: 4_000, minOrderPaise: 50_000 });

    await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 1 }); // ₹380 < ₹500 minimum
    let cart = (await http.get('/v1/cart', retailer.token)).json();
    expect(cart.belowMinOrder).toBe(true);
    expect(cart.canCheckout).toBe(false);

    await http.put(`/v1/cart/items/${display}`, retailer.token, { qty: 2 });
    await http.put(`/v1/cart/items/${battery}`, retailer.token, { qty: 2 });
    cart = (await http.get('/v1/cart', retailer.token)).json();
    expect(cart).toMatchObject({ deliveryFeePaise: 4_000, totalPaise: 76_000 + 180_000 + 4_000, canCheckout: true });

    expect((await http.patch('/v1/admin/settings', admin, { deliveryFeePaise: -1 })).statusCode).toBe(400);
    expect((await http.patch('/v1/admin/settings', retailer.token, { deliveryFeePaise: 0 })).statusCode).toBe(403);
  });
});

describe('order lifecycle and access', () => {
  it('lets the wholesaler accept and pack a forwarded order, in order', async () => {
    const id = await orderOf([[display, 2]]);
    expect((await http.post(`/v1/wholesaler/orders/${id}/accept`, w1.token)).statusCode).toBe(404); // not theirs yet
    await forward(http, admin, id, w1.id);
    expect((await http.post(`/v1/wholesaler/orders/${id}/pack`, w1.token)).statusCode).toBe(409);
    expect((await http.post(`/v1/wholesaler/orders/${id}/accept`, w1.token)).json().status).toBe('accepted');
    const packed = (await http.post(`/v1/wholesaler/orders/${id}/pack`, w1.token)).json();
    expect(packed.timeline.map((e: { status: string }) => e.status)).toEqual(['forwarded', 'accepted', 'packed']);
    const forRetailer = (await http.get(`/v1/orders/${id}`, retailer.token)).json();
    expect(forRetailer.timeline.map((e: { status: string }) => e.status)).toEqual(['placed', 'accepted', 'packed']);
    // Too late for the retailer to cancel.
    expect((await http.post(`/v1/orders/${id}/cancel`, retailer.token)).statusCode).toBe(409);
  });

  it('lets a wholesaler hand an order back to the admin, who forwards it to someone else', async () => {
    const id = await orderOf([[display, 3]]);
    await forward(http, admin, id, w1.id);
    await http.post(`/v1/wholesaler/orders/${id}/accept`, w1.token);
    expect(await stockOf(w1.id, display)).toBe(117);

    expect((await http.post(`/v1/wholesaler/orders/${id}/reject`, w1.token, {})).statusCode).toBe(400); // reason required
    expect((await http.post(`/v1/wholesaler/orders/${id}/reject`, w1.token, { reason: 'Damaged in godown' })).statusCode).toBe(200);
    expect(await stockOf(w1.id, display)).toBe(120);
    expect((await http.get(`/v1/wholesaler/orders/${id}`, w1.token)).statusCode).toBe(404);

    const back = (await http.get(`/v1/admin/orders/${id}`, admin)).json();
    expect(back).toMatchObject({ status: 'placed', wholesaler: null, commissionPaise: null });
    expect(back.timeline.at(-1)).toMatchObject({ status: 'placed', note: 'Returned by wholesaler: Damaged in godown' });

    const again = await forward(http, admin, id, w2.id);
    expect(again).toMatchObject({ status: 'forwarded', supplyTotalPaise: 3 * 33_000 });
    // The retailer never saw any of this.
    const forRetailer = (await http.get(`/v1/orders/${id}`, retailer.token)).json();
    expect(forRetailer.timeline.map((e: { status: string }) => e.status)).toEqual(['placed']);
    expect(JSON.stringify(forRetailer)).not.toMatch(/godown|Karol|Lamington/);
  });

  it('returns stock to the wholesaler when a forwarded order is cancelled', async () => {
    const a = await orderOf([[display, 4]]);
    expect((await http.post(`/v1/orders/${a}/cancel`, retailer.token)).json()).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Cancelled by retailer',
    });
    const b = await orderOf([[display, 4]]);
    await forward(http, admin, b, w1.id);
    expect(await stockOf(w1.id, display)).toBe(116);
    await http.post(`/v1/orders/${b}/cancel`, retailer.token);
    expect(await stockOf(w1.id, display)).toBe(120);
  });

  it('shows each party only its own orders', async () => {
    const id = await orderOf([[display, 2]]);
    await forward(http, admin, id, w1.id);
    const otherRetailer = await signIn(t, 'retailer');

    expect((await http.get(`/v1/orders/${id}`, otherRetailer.token)).statusCode).toBe(404);
    expect((await http.get(`/v1/wholesaler/orders/${id}`, w2.token)).statusCode).toBe(404);
    expect((await http.post(`/v1/wholesaler/orders/${id}/accept`, w2.token)).statusCode).toBe(404);
    expect((await http.get('/v1/wholesaler/orders', w2.token)).json().items).toEqual([]);
    expect((await http.get(`/v1/wholesaler/orders/${id}`, w1.token)).json().retailer.shopName).toMatch(/^Shop/);
  });

  it('lets the admin see everything and cancel with an audit record', async () => {
    const id = await orderOf([[display, 2]]);
    await forward(http, admin, id, w1.id);
    expect((await http.get(`/v1/admin/orders?wholesalerId=${w1.id}`, admin)).json().items).toHaveLength(1);
    expect((await http.get(`/v1/admin/orders?wholesalerId=${w2.id}`, admin)).json().items).toHaveLength(0);

    const res = await http.post(`/v1/admin/orders/${id}/cancel`, admin, { reason: 'Duplicate order' });
    expect(res.json()).toMatchObject({ status: 'cancelled', cancelReason: 'Duplicate order' });
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'order.cancelByAdmin'));
    expect(log?.entityId).toBe(id);
    expect(await stockOf(w1.id, display)).toBe(120);
  });
});
