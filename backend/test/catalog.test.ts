import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, users } from '../src/db/schema.js';
import { pricingProblems, unitPriceFor } from '../src/modules/catalog/pricing.js';
import { api, createTestApp, resetDb, signIn, type TestContext } from './helpers.js';

// ---------------------------------------------------------------- pure pricing rules

describe('bulk pricing', () => {
  const v = { pricePaise: 10_000, mrpPaise: 12_000, minOrderQty: 1, slabs: [{ minQty: 10, pricePaise: 9_000 }, { minQty: 50, pricePaise: 8_000 }] };

  it('picks the best slab reached', () => {
    expect(unitPriceFor(v, 1)).toBe(10_000);
    expect(unitPriceFor(v, 9)).toBe(10_000);
    expect(unitPriceFor(v, 10)).toBe(9_000);
    expect(unitPriceFor(v, 49)).toBe(9_000);
    expect(unitPriceFor(v, 500)).toBe(8_000);
  });

  it('does not depend on slab order', () => {
    expect(unitPriceFor({ ...v, slabs: [...v.slabs].reverse() }, 60)).toBe(8_000);
  });

  it('accepts consistent pricing', () => {
    expect(pricingProblems(v)).toEqual([]);
  });

  it('rejects inconsistent pricing', () => {
    expect(pricingProblems({ ...v, pricePaise: 13_000 })).toContain('Price cannot be higher than MRP');
    expect(pricingProblems({ ...v, slabs: [{ minQty: 10, pricePaise: 10_000 }] })[0]).toMatch(/cheaper/);
    expect(pricingProblems({ ...v, slabs: [{ minQty: 10, pricePaise: 9_000 }, { minQty: 20, pricePaise: 9_500 }] })[0]).toMatch(/cheaper/);
    expect(pricingProblems({ ...v, minOrderQty: 10, slabs: [{ minQty: 10, pricePaise: 9_000 }] })[0]).toMatch(/minimum order/);
    expect(pricingProblems({ ...v, slabs: [{ minQty: 10, pricePaise: 9_000 }, { minQty: 10, pricePaise: 8_000 }] })[0]).toMatch(/Duplicate/);
  });
});

// ---------------------------------------------------------------- API

let t: TestContext;
let http: ReturnType<typeof api>;
let admin: string;
let catId: string; // "Engine" > "Filters"
let filtersId: string;
let brandId: string;

beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  http = api(t);
  admin = (await signIn(t, 'admin')).token;
  catId = (await http.post('/v1/admin/categories', admin, { name: 'Engine Parts' })).json().id;
  filtersId = (await http.post('/v1/admin/categories', admin, { name: 'Oil Filters', parentId: catId })).json().id;
  brandId = (await http.post('/v1/admin/brands', admin, { name: 'Bosch' })).json().id;
});
afterEach(async () => {
  await t.close();
});

const productBody = (over: Record<string, unknown> = {}) => ({
  categoryId: filtersId,
  brandId,
  name: 'Oil Filter for Swift 1.2',
  partNumber: 'F-002-H20',
  hsnCode: '84212300',
  gstRateBps: 1800,
  variants: [
    {
      name: 'Single',
      mrpPaise: 45_000,
      pricePaise: 38_000,
      stockQty: 120,
      slabs: [{ minQty: 10, pricePaise: 35_000 }],
    },
    { name: 'Box of 5', mrpPaise: 220_000, pricePaise: 180_000, stockQty: 30 },
  ],
  ...over,
});

async function liveProduct(token: string, over: Record<string, unknown> = {}) {
  const created = await http.post('/v1/wholesaler/products', token, productBody(over));
  expect(created.statusCode).toBe(201);
  const id = created.json().id as string;
  expect((await http.post(`/v1/wholesaler/products/${id}/publish`, token)).statusCode).toBe(200);
  return id;
}

describe('taxonomy', () => {
  it('serves an active two-level category tree and brands', async () => {
    const buyer = (await signIn(t, 'retailer')).token;
    const res = await http.get('/v1/categories', buyer);
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toMatchObject([
      { name: 'Engine Parts', slug: 'engine-parts', children: [{ name: 'Oil Filters', slug: 'oil-filters' }] },
    ]);
    expect((await http.get('/v1/brands', buyer)).json().items).toMatchObject([{ name: 'Bosch', slug: 'bosch' }]);
  });

  it('reflects admin changes immediately (cache is cleared on write)', async () => {
    const buyer = (await signIn(t, 'retailer')).token;
    await http.get('/v1/categories', buyer); // warm the cache
    await http.patch(`/v1/admin/categories/${filtersId}`, admin, { isActive: false });
    expect((await http.get('/v1/categories', buyer)).json().items[0].children).toEqual([]);
  });

  it('allows only one level of nesting', async () => {
    const res = await http.post('/v1/admin/categories', admin, { name: 'Too Deep', parentId: filtersId });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CATEGORY_DEPTH');
  });

  it('rejects duplicate slugs', async () => {
    const res = await http.post('/v1/admin/brands', admin, { name: 'BOSCH' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SLUG_TAKEN');
  });

  it('is admin-only to change', async () => {
    const wholesaler = (await signIn(t, 'wholesaler')).token;
    expect((await http.post('/v1/admin/categories', wholesaler, { name: 'X' })).statusCode).toBe(403);
  });
});

describe('wholesaler products', () => {
  it('creates a draft that buyers cannot see until it is published', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const buyer = (await signIn(t, 'retailer')).token;

    const created = await http.post('/v1/wholesaler/products', w, productBody());
    expect(created.statusCode).toBe(201);
    const p = created.json();
    expect(p).toMatchObject({ status: 'draft', category: { name: 'Oil Filters' }, brand: { name: 'Bosch' } });
    expect(p.variants[0]).toMatchObject({ name: 'Single', pricePaise: 38_000, slabs: [{ minQty: 10, pricePaise: 35_000 }] });

    expect((await http.get(`/v1/products/${p.id}`, buyer)).statusCode).toBe(404);
    expect((await http.get('/v1/products', buyer)).json().items).toHaveLength(0);

    await http.post(`/v1/wholesaler/products/${p.id}/publish`, w);
    const list = (await http.get('/v1/products', buyer)).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      name: 'Oil Filter for Swift 1.2',
      brandName: 'Bosch',
      minPricePaise: 38_000,
      mrpPaise: 45_000,
      totalStock: 150,
      statusReason: null,
    });
    expect((await http.get(`/v1/products/${p.id}`, buyer)).statusCode).toBe(200);
  });

  it('never lets a wholesaler see or change another wholesaler’s product', async () => {
    const a = (await signIn(t, 'wholesaler')).token;
    const b = (await signIn(t, 'wholesaler')).token;
    const id = await liveProduct(a);
    const variantId = (await http.get(`/v1/wholesaler/products/${id}`, a)).json().variants[0].id;

    expect((await http.get(`/v1/wholesaler/products/${id}`, b)).statusCode).toBe(404);
    expect((await http.patch(`/v1/wholesaler/products/${id}`, b, { name: 'Hijacked' })).statusCode).toBe(404);
    expect((await http.post(`/v1/wholesaler/products/${id}/hide`, b)).statusCode).toBe(404);
    expect((await http.patch(`/v1/wholesaler/products/variants/${variantId}`, b, { pricePaise: 1 })).statusCode).toBe(404);
    expect((await http.post(`/v1/wholesaler/products/${id}/images/upload-url`, b, { contentType: 'image/webp', sizeBytes: 100 })).statusCode).toBe(404);
    expect((await http.get('/v1/wholesaler/products', b)).json().items).toHaveLength(0);
    expect((await http.get(`/v1/wholesaler/products/${id}`, a)).json().name).toBe('Oil Filter for Swift 1.2');
  });

  it('keeps wholesaler routes away from other roles and pending users', async () => {
    const retailer = (await signIn(t, 'retailer')).token;
    const pending = (await signIn(t, 'wholesaler', { status: 'pending' })).token;
    expect((await http.post('/v1/wholesaler/products', retailer, productBody())).statusCode).toBe(403);
    const res = await http.post('/v1/wholesaler/products', pending, productBody());
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ACCOUNT_PENDING');
  });

  it('validates pricing on create and on variant updates', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const bad = await http.post(
      '/v1/wholesaler/products',
      w,
      productBody({ variants: [{ name: 'X', mrpPaise: 100, pricePaise: 200 }] }),
    );
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('INVALID_PRICING');

    const p = (await http.post('/v1/wholesaler/products', w, productBody())).json();
    const variantId = p.variants.find((v: { name: string }) => v.name === 'Single').id;
    // Raising the base price above an existing slab is fine; raising the slab above the base is not.
    const notCheaper = await http.patch(`/v1/wholesaler/products/variants/${variantId}`, w, {
      slabs: [{ minQty: 10, pricePaise: 39_000 }],
    });
    expect(notCheaper.statusCode).toBe(400);

    const ok = await http.patch(`/v1/wholesaler/products/variants/${variantId}`, w, {
      stockQty: 5,
      slabs: [
        { minQty: 10, pricePaise: 36_000 },
        { minQty: 100, pricePaise: 33_000 },
      ],
    });
    expect(ok.statusCode).toBe(200);
    const v = ok.json().variants.find((x: { id: string }) => x.id === variantId);
    expect(v).toMatchObject({ stockQty: 5, slabs: [{ minQty: 10 }, { minQty: 100 }] });
  });

  it('rejects unsupported GST rates and malformed HSN codes', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    expect((await http.post('/v1/wholesaler/products', w, productBody({ gstRateBps: 1500 }))).statusCode).toBe(400);
    expect((await http.post('/v1/wholesaler/products', w, productBody({ hsnCode: '12345' }))).statusCode).toBe(400);
  });

  it('cannot publish without an active variant', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const p = (await http.post('/v1/wholesaler/products', w, productBody())).json();
    for (const v of p.variants) await http.patch(`/v1/wholesaler/products/variants/${v.id}`, w, { isActive: false });
    const res = await http.post(`/v1/wholesaler/products/${p.id}/publish`, w);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('NO_ACTIVE_VARIANT');
  });
});

describe('product images', () => {
  it('uploads directly to storage, then attaches after checking the object', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const id = await liveProduct(w);

    const url = await http.post(`/v1/wholesaler/products/${id}/images/upload-url`, w, {
      contentType: 'image/webp',
      sizeBytes: 25_000,
    });
    expect(url.statusCode).toBe(200);
    const { objectKey, upload } = url.json();
    expect(objectKey).toMatch(new RegExp(`^products/${id}/[0-9a-f-]{36}\\.webp$`));
    expect(upload.headers).toEqual({ 'content-type': 'image/webp', 'content-length': '25000' });

    const early = await http.post(`/v1/wholesaler/products/${id}/images`, w, { objectKey });
    expect(early.statusCode).toBe(400);
    expect(early.json().code).toBe('IMAGE_NOT_UPLOADED');

    t.storage.put(objectKey, 25_000);
    const attached = await http.post(`/v1/wholesaler/products/${id}/images`, w, { objectKey });
    expect(attached.statusCode).toBe(201);
    expect(attached.json().images).toEqual([{ id: expect.any(String), url: `https://img.test/${objectKey}`, sortOrder: 0 }]);

    const buyer = (await signIn(t, 'retailer')).token;
    expect((await http.get('/v1/products', buyer)).json().items[0].thumbnailUrl).toBe(`https://img.test/${objectKey}`);

    const imageId = attached.json().images[0].id;
    expect((await http.del(`/v1/wholesaler/products/${id}/images/${imageId}`, w)).json().images).toEqual([]);
  });

  it('only accepts WebP up to 1 MB', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const id = await liveProduct(w);
    expect(
      (await http.post(`/v1/wholesaler/products/${id}/images/upload-url`, w, { contentType: 'image/jpeg', sizeBytes: 10 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await http.post(`/v1/wholesaler/products/${id}/images/upload-url`, w, { contentType: 'image/webp', sizeBytes: 2_000_000 }))
        .statusCode,
    ).toBe(400);

    // An object that turns out not to be WebP (client ignored the signed headers) is refused.
    const { objectKey } = (
      await http.post(`/v1/wholesaler/products/${id}/images/upload-url`, w, { contentType: 'image/webp', sizeBytes: 10 })
    ).json();
    t.storage.put(objectKey, 10, 'image/png');
    expect((await http.post(`/v1/wholesaler/products/${id}/images`, w, { objectKey })).json().code).toBe('INVALID_IMAGE');
  });

  it('refuses to attach a key that belongs to another product', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const a = await liveProduct(w);
    const b = await liveProduct(w, { name: 'Air Filter' });
    const { objectKey } = (
      await http.post(`/v1/wholesaler/products/${a}/images/upload-url`, w, { contentType: 'image/webp', sizeBytes: 10 })
    ).json();
    t.storage.put(objectKey, 10);
    const res = await http.post(`/v1/wholesaler/products/${b}/images`, w, { objectKey });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_IMAGE_KEY');
  });

  it('returns 503 when image storage is not configured', async () => {
    const bare = await createTestApp({}, { realStorage: true });
    try {
      const w = (await signIn(bare, 'wholesaler')).token;
      const p = (await api(bare).post('/v1/wholesaler/products', w, productBody())).json();
      const res = await api(bare).post(`/v1/wholesaler/products/${p.id}/images/upload-url`, w, {
        contentType: 'image/webp',
        sizeBytes: 10,
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('STORAGE_NOT_CONFIGURED');
    } finally {
      await bare.close();
    }
  });
});

describe('browsing', () => {
  it('searches by name and part number, and filters by parent category', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const buyer = (await signIn(t, 'retailer')).token;
    await liveProduct(w);
    const brakesId = (await http.post('/v1/admin/categories', admin, { name: 'Brakes' })).json().id;
    await liveProduct(w, { name: 'Brake Pad Set', partNumber: 'BP-1180', categoryId: brakesId });

    const names = async (qs: string) =>
      (await http.get(`/v1/products?${qs}`, buyer)).json().items.map((p: { name: string }) => p.name);

    expect(await names('q=swift')).toEqual(['Oil Filter for Swift 1.2']);
    expect(await names('q=bp-11')).toEqual(['Brake Pad Set']);
    expect(await names(`categoryId=${catId}`)).toEqual(['Oil Filter for Swift 1.2']); // via subcategory
    expect(await names(`categoryId=${brakesId}`)).toEqual(['Brake Pad Set']);
    expect(await names(`brandId=${brandId}`)).toHaveLength(2);
    // LIKE wildcards are matched literally.
    expect(await names('q=%25%25')).toEqual([]);
  });

  it('paginates with a cursor', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const buyer = (await signIn(t, 'retailer')).token;
    for (const n of ['A', 'B', 'C']) await liveProduct(w, { name: `Part ${n}` });
    const p1 = (await http.get('/v1/products?limit=2', buyer)).json();
    const p2 = (await http.get(`/v1/products?limit=2&cursor=${p1.nextCursor}`, buyer)).json();
    expect([...p1.items, ...p2.items].map((p: { name: string }) => p.name)).toEqual(['Part C', 'Part B', 'Part A']);
    expect(p2.nextCursor).toBeNull();
  });

  it('hides inactive variants and products without any', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const buyer = (await signIn(t, 'retailer')).token;
    const id = await liveProduct(w);
    const variants = (await http.get(`/v1/wholesaler/products/${id}`, w)).json().variants;
    await http.patch(`/v1/wholesaler/products/variants/${variants[0].id}`, w, { isActive: false });
    expect((await http.get(`/v1/products/${id}`, buyer)).json().variants).toHaveLength(1);

    await http.patch(`/v1/wholesaler/products/variants/${variants[1].id}`, w, { isActive: false });
    expect((await http.get(`/v1/products/${id}`, buyer)).statusCode).toBe(404);
  });

  it('hides products of blocked wholesalers and inactive categories', async () => {
    const w = await signIn(t, 'wholesaler');
    const buyer = (await signIn(t, 'retailer')).token;
    const id = await liveProduct(w.token);

    await t.db.update(users).set({ status: 'blocked' }).where(eq(users.id, w.id));
    expect((await http.get(`/v1/products/${id}`, buyer)).statusCode).toBe(404);
    await t.db.update(users).set({ status: 'approved' }).where(eq(users.id, w.id));

    await http.patch(`/v1/admin/categories/${catId}`, admin, { isActive: false }); // parent of the product's category
    expect((await http.get('/v1/products', buyer)).json().items).toHaveLength(0);
  });

  it('requires an approved business account', async () => {
    const pending = (await signIn(t, 'retailer', { status: 'pending' })).token;
    const delivery = (await signIn(t, 'delivery')).token;
    expect((await http.get('/v1/products', pending)).statusCode).toBe(403);
    expect((await http.get('/v1/products', delivery)).statusCode).toBe(403);
    expect((await http.get('/v1/products')).statusCode).toBe(401);
  });
});

describe('admin moderation', () => {
  it('blocks a product, tells the wholesaler why, and unblocks it as hidden', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const buyer = (await signIn(t, 'retailer')).token;
    const id = await liveProduct(w);

    const blocked = await http.post(`/v1/admin/products/${id}/block`, admin, { reason: 'Counterfeit listing' });
    expect(blocked.statusCode).toBe(200);
    expect((await http.get(`/v1/products/${id}`, buyer)).statusCode).toBe(404);

    const own = (await http.get(`/v1/wholesaler/products/${id}`, w)).json();
    expect(own).toMatchObject({ status: 'blocked', statusReason: 'Counterfeit listing' });
    const republish = await http.post(`/v1/wholesaler/products/${id}/publish`, w);
    expect(republish.statusCode).toBe(403);
    expect(republish.json().code).toBe('PRODUCT_BLOCKED');

    const unblocked = await http.post(`/v1/admin/products/${id}/unblock`, admin);
    expect(unblocked.json()).toMatchObject({ status: 'hidden', statusReason: null });
    expect((await http.post(`/v1/wholesaler/products/${id}/publish`, w)).statusCode).toBe(200);

    const actions = (await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, id))).map((a) => a.action);
    expect(actions.sort()).toEqual(['product.block', 'product.unblock']);
  });

  it('lists every product with filters', async () => {
    const w1 = await signIn(t, 'wholesaler');
    const w2 = await signIn(t, 'wholesaler');
    await liveProduct(w1.token);
    await http.post('/v1/wholesaler/products', w2.token, productBody({ name: 'Draft thing' }));

    expect((await http.get('/v1/admin/products', admin)).json().items).toHaveLength(2);
    expect((await http.get('/v1/admin/products?status=draft', admin)).json().items[0].name).toBe('Draft thing');
    expect((await http.get(`/v1/admin/products?wholesalerId=${w1.id}`, admin)).json().items).toHaveLength(1);
  });

  it('issues upload URLs for category images', async () => {
    const res = await http.post('/v1/admin/uploads', admin, { kind: 'categories', contentType: 'image/webp', sizeBytes: 5000 });
    expect(res.statusCode).toBe(200);
    const { objectKey } = res.json();
    expect(objectKey).toMatch(/^categories\/[0-9a-f-]{36}\.webp$/);
    const cat = await http.patch(`/v1/admin/categories/${catId}`, admin, { imageKey: objectKey });
    expect(cat.json().imageKey).toBe(objectKey);
    const listed = (await http.get('/v1/admin/categories', admin)).json().items.find((c: { id: string }) => c.id === catId);
    expect(listed.imageUrl).toBe(`https://img.test/${objectKey}`);
    expect((await http.patch(`/v1/admin/categories/${catId}`, admin, { imageKey: 'products/x.webp' })).statusCode).toBe(400);
  });
});
