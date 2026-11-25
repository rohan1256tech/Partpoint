import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, coupons, productVariants } from '../src/db/schema.js';
import { allocate, commissionFor, couponDiscount, priceOrderGroups } from '../src/modules/orders/pricing.js';
import { api, createTestApp, resetDb, signIn, type TestContext } from './helpers.js';

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

  it('computes commission on goods after discount', () => {
    const [g] = priceOrderGroups([{ wholesalerId: 'w', subtotalPaise: 100_000, commissionBps: null }], {
      discountPaise: 10_000,
      deliveryFeePaise: 4_000,
      defaultCommissionBps: 500,
    });
    expect(g).toEqual({
      wholesalerId: 'w',
      subtotalPaise: 100_000,
      discountPaise: 10_000,
      deliveryFeePaise: 4_000,
      totalPaise: 94_000,
      commissionPaise: 4_500,
    });
    expect(commissionFor(999, 500)).toBe(49); // rounds down
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
/** variant ids: filter (w1, ₹380, slab 10+ ₹350, stock 120), pads (w2, ₹900, MOQ 2, stock 5) */
let filter: string;
let pads: string;

async function product(token: string, body: Record<string, unknown>) {
  const p = await http.post('/v1/wholesaler/products', token, body);
  expect(p.statusCode).toBe(201);
  await http.post(`/v1/wholesaler/products/${p.json().id}/publish`, token);
  return { productId: p.json().id as string, variantId: p.json().variants[0].id as string };
}

beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  http = api(t);
  admin = (await signIn(t, 'admin')).token;
  const categoryId = (await http.post('/v1/admin/categories', admin, { name: 'Engine' })).json().id;
  w1 = await signIn(t, 'wholesaler', { name: 'Bharat Spares' });
  w2 = await signIn(t, 'wholesaler', { name: 'Delhi Auto' });
  retailer = await signIn(t, 'retailer');

  filter = (
    await product(w1.token, {
      categoryId,
      name: 'Oil Filter',
      hsnCode: '84212300',
      variants: [{ name: 'Single', mrpPaise: 45_000, pricePaise: 38_000, stockQty: 120, slabs: [{ minQty: 10, pricePaise: 35_000 }] }],
    })
  ).variantId;
  pads = (
    await product(w2.token, {
      categoryId,
      name: 'Brake Pads',
      variants: [{ name: 'Set', mrpPaise: 120_000, pricePaise: 90_000, stockQty: 5, minOrderQty: 2 }],
    })
  ).variantId;

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

const stockOf = async (variantId: string) =>
  (await t.db.select({ s: productVariants.stockQty }).from(productVariants).where(eq(productVariants.id, variantId)))[0]?.s;

const place = (token = retailer.token, extra: Record<string, unknown> = {}) =>
  http.post('/v1/orders', token, { addressId, idempotencyKey: `key-${Math.random()}`, ...extra });

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
    const productId = (await http.get(`/v1/products?q=oil`, retailer.token)).json().items[0].id;
    expect((await http.put(`/v1/wishlist/${productId}`, retailer.token)).statusCode).toBe(204);
    expect((await http.put(`/v1/wishlist/${productId}`, retailer.token)).statusCode).toBe(204); // idempotent
    expect((await http.get('/v1/wishlist', retailer.token)).json().items.map((p: { id: string }) => p.id)).toEqual([productId]);

    await http.post(`/v1/wholesaler/products/${productId}/hide`, w1.token);
    expect((await http.get('/v1/wishlist', retailer.token)).json().items).toEqual([]);
    expect((await http.put(`/v1/wishlist/${productId}`, retailer.token)).statusCode).toBe(404);

    expect((await http.del(`/v1/wishlist/${productId}`, retailer.token)).statusCode).toBe(204);
  });
});

describe('cart', () => {
  it('prices lines with bulk slabs and groups them by wholesaler', async () => {
    await http.put(`/v1/cart/items/${filter}`, retailer.token, { qty: 10 });
    const cart = (await http.put(`/v1/cart/items/${pads}`, retailer.token, { qty: 2 })).json();

    expect(cart.groups.map((g: { wholesaler: { businessName: string } }) => g.wholesaler.businessName).sort()).toEqual([
      'Bharat Spares',
      'Delhi Auto',
    ]);
    const filterLine = cart.groups.flatMap((g: { lines: unknown[] }) => g.lines).find((l: { variantId: string }) => l.variantId === filter);
    expect(filterLine).toMatchObject({ qty: 10, unitPricePaise: 35_000, lineTotalPaise: 350_000, issue: null });
    expect(cart).toMatchObject({ subtotalPaise: 530_000, totalPaise: 530_000, canCheckout: true, itemCount: 2 });
  });

  it('enforces minimum quantity and stock', async () => {
    const moq = await http.put(`/v1/cart/items/${pads}`, retailer.token, { qty: 1 });
    expect(moq.json().code).toBe('BELOW_MIN_QTY');
    const stock = await http.put(`/v1/cart/items/${pads}`, retailer.token, { qty: 6 });
    expect(stock.json().code).toBe('OUT_OF_STOCK');
  });

  it('flags lines that became unavailable and blocks checkout', async () => {
    await http.put(`/v1/cart/items/${filter}`, retailer.token, { qty: 1 });
    await t.db.update(productVariants).set({ isActive: false }).where(eq(productVariants.id, filter));
    const cart = (await http.get('/v1/cart', retailer.token)).json();
    expect(cart.groups[0].lines[0].issue).toBe('UNAVAILABLE');
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
  it('splits the cart into one order per wholesaler, takes stock and empties the cart', async () => {
    await http.put(`/v1/cart/items/${filter}`, retailer.token, { qty: 10 });
    await http.put(`/v1/cart/items/${pads}`, retailer.token, { qty: 2 });

    const res = await place();
    expect(res.statusCode).toBe(201);
    const placed = res.json();
    expect(placed.orders).toHaveLength(2);
    expect(placed.totalPaise).toBe(530_000);
    expect(placed.orders.reduce((s: number, o: { totalPaise: number }) => s + o.totalPaise, 0)).toBe(530_000);
    for (const o of placed.orders) expect(o.orderNumber).toMatch(/^PP-\d{8}-\d{6}$/);

    expect(await stockOf(filter)).toBe(110);
    expect(await stockOf(pads)).toBe(3);
    expect((await http.get('/v1/cart', retailer.token)).json().itemCount).toBe(0);

    const mine = (await http.get('/v1/orders', retailer.token)).json().items;
    expect(mine).toHaveLength(2);
    const detail = (await http.get(`/v1/orders/${placed.orders[0].id}`, retailer.token)).json();
    expect(detail).toMatchObject({ status: 'placed', commissionPaise: null, address: { line1: 'Shop 4, Gandhi Market' } });
    expect(detail.timeline).toEqual([{ status: 'placed', note: null, at: expect.any(String) }]);
  });

  it('returns the same orders for a retried request and takes stock once', async () => {
    await http.put(`/v1/cart/items/${filter}`, retailer.token, { qty: 3 });
    const body = { addressId, idempotencyKey: 'retry-key-0001' };
    const [a, b] = await Promise.all([http.post('/v1/orders', retailer.token, body), http.post('/v1/orders', retailer.token, body)]);
    const ok = [a, b].filter((r) => r.statusCode === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await http.post('/v1/orders', retailer.token, body);
    expect(again.json().checkoutId).toBe(ok[0]?.json().checkoutId);
    expect(await stockOf(filter)).toBe(117);
  });

  it('never oversells when two retailers race for the last units', async () => {
    const other = await signIn(t, 'retailer');
    const otherAddress = (
      await http.post('/v1/me/addresses', other.token, {
        contactName: 'Asha',
        contactPhone: '9876500000',
        line1: 'Main Road',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
      })
    ).json().id;
    await http.put(`/v1/cart/items/${pads}`, retailer.token, { qty: 5 });
    await http.put(`/v1/cart/items/${pads}`, other.token, { qty: 5 });

    const results = await Promise.all([
      place(),
      http.post('/v1/orders', other.token, { addressId: otherAddress, idempotencyKey: 'race-other-1' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await stockOf(pads)).toBe(0);
  });

  it('rejects an empty cart and someone else’s address', async () => {
    expect((await place()).json().code).toBe('CART_EMPTY');
    const other = await signIn(t, 'retailer');
    await http.put(`/v1/cart/items/${filter}`, other.token, { qty: 1 });
    expect((await http.post('/v1/orders', other.token, { addressId, idempotencyKey: 'steal-address' })).statusCode).toBe(404);
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

  it('previews and applies a coupon, shared across orders by value', async () => {
    await http.put(`/v1/cart/items/${filter}`, retailer.token, { qty: 10 }); // 3,500.00
    await http.put(`/v1/cart/items/${pads}`, retailer.token, { qty: 2 }); // 1,800.00
    const preview = (await http.get('/v1/cart?couponCode=welcome10', retailer.token)).json();
    expect(preview.coupon).toEqual({ code: 'WELCOME10', discountPaise: 50_000 }); // 10% capped at ₹500
    expect(preview.totalPaise).toBe(480_000);

    const placed = (await place(retailer.token, { couponCode: 'welcome10' })).json();
    expect(placed).toMatchObject({ discountPaise: 50_000, totalPaise: 480_000 });
    expect(placed.orders.reduce((s: number, o: { totalPaise: number }) => s + o.totalPaise, 0)).toBe(480_000);

    // One use per retailer.
    await http.put(`/v1/cart/items/${filter}`, retailer.token, { qty: 10 });
    const second = await place(retailer.token, { couponCode: 'WELCOME10' });
    expect(second.statusCode).toBe(400);
    expect(second.json()).toMatchObject({ code: 'COUPON_INVALID', error: 'You have already used this coupon' });
  });

  it('explains why a coupon does not apply', async () => {
    await http.put(`/v1/cart/items/${filter}`, retailer.token, { qty: 1 });
    const cart = (await http.get('/v1/cart?couponCode=WELCOME10', retailer.token)).json();
    expect(cart.coupon).toBeNull();
    expect(cart.couponError).toMatch(/Add items worth ₹620 more/);
  });

  it('applies the admin delivery fee per wholesaler and the minimum order value', async () => {
    const s = await http.patch('/v1/admin/settings', admin, { deliveryFeePaise: 4_000, minOrderPaise: 50_000 });
    expect(s.json()).toMatchObject({ deliveryFeePaise: 4_000, minOrderPaise: 50_000, commissionBps: 500 });

    await http.put(`/v1/cart/items/${filter}`, retailer.token, { qty: 1 }); // ₹380 < ₹500 minimum
    let cart = (await http.get('/v1/cart', retailer.token)).json();
    expect(cart.groups[0].belowMinOrder).toBe(true);
    expect(cart.canCheckout).toBe(false);

    await http.put(`/v1/cart/items/${filter}`, retailer.token, { qty: 2 });
    await http.put(`/v1/cart/items/${pads}`, retailer.token, { qty: 2 });
    cart = (await http.get('/v1/cart', retailer.token)).json();
    expect(cart).toMatchObject({ deliveryFeePaise: 8_000, totalPaise: 76_000 + 180_000 + 8_000, canCheckout: true });

    expect((await http.patch('/v1/admin/settings', admin, { commissionBps: -1 })).statusCode).toBe(400);
    expect((await http.patch('/v1/admin/settings', retailer.token, { commissionBps: 0 })).statusCode).toBe(403);
  });
});

describe('order lifecycle and access', () => {
  async function placedOrderFor(variant: string, qty: number) {
    await http.put(`/v1/cart/items/${variant}`, retailer.token, { qty });
    return (await place()).json().orders[0].id as string;
  }

  it('lets the wholesaler accept and pack, in order', async () => {
    const id = await placedOrderFor(filter, 2);
    expect((await http.post(`/v1/wholesaler/orders/${id}/pack`, w1.token)).statusCode).toBe(409);
    expect((await http.post(`/v1/wholesaler/orders/${id}/accept`, w1.token)).json().status).toBe('accepted');
    const packed = (await http.post(`/v1/wholesaler/orders/${id}/pack`, w1.token)).json();
    expect(packed.timeline.map((e: { status: string }) => e.status)).toEqual(['placed', 'accepted', 'packed']);
    // Too late for the retailer to cancel.
    expect((await http.post(`/v1/orders/${id}/cancel`, retailer.token)).statusCode).toBe(409);
  });

  it('returns stock when an order is cancelled or rejected', async () => {
    const a = await placedOrderFor(filter, 4);
    expect(await stockOf(filter)).toBe(116);
    expect((await http.post(`/v1/orders/${a}/cancel`, retailer.token)).json()).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Cancelled by retailer',
    });
    expect(await stockOf(filter)).toBe(120);

    const b = await placedOrderFor(filter, 4);
    expect((await http.post(`/v1/wholesaler/orders/${b}/reject`, w1.token, {})).statusCode).toBe(400); // reason required
    await http.post(`/v1/wholesaler/orders/${b}/reject`, w1.token, { reason: 'Out of stock at godown' });
    expect(await stockOf(filter)).toBe(120);
  });

  it('shows each party only its own orders, with the right level of detail', async () => {
    const id = await placedOrderFor(filter, 2);
    const otherRetailer = await signIn(t, 'retailer');

    expect((await http.get(`/v1/orders/${id}`, otherRetailer.token)).statusCode).toBe(404);
    expect((await http.get(`/v1/wholesaler/orders/${id}`, w2.token)).statusCode).toBe(404);
    expect((await http.post(`/v1/wholesaler/orders/${id}/accept`, w2.token)).statusCode).toBe(404);
    expect((await http.get('/v1/wholesaler/orders', w2.token)).json().items).toEqual([]);

    const forWholesaler = (await http.get(`/v1/wholesaler/orders/${id}`, w1.token)).json();
    expect(forWholesaler.address).toEqual({ city: 'Nashik', state: 'Maharashtra', pincode: '422001' });
    expect(forWholesaler.commissionPaise).toBe(3_800); // 5% of ₹760
    expect(forWholesaler.retailer.shopName).toMatch(/^Shop/);
  });

  it('lets the admin see everything and cancel with an audit record', async () => {
    const id = await placedOrderFor(filter, 2);
    expect((await http.get(`/v1/admin/orders?wholesalerId=${w1.id}`, admin)).json().items).toHaveLength(1);
    expect((await http.get(`/v1/admin/orders?wholesalerId=${w2.id}`, admin)).json().items).toHaveLength(0);

    const res = await http.post(`/v1/admin/orders/${id}/cancel`, admin, { reason: 'Duplicate order' });
    expect(res.json()).toMatchObject({ status: 'cancelled', cancelReason: 'Duplicate order' });
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'order.cancelByAdmin'));
    expect(log?.entityId).toBe(id);
  });
});
