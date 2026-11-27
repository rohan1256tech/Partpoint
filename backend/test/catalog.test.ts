import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs } from '../src/db/schema.js';
import { pricingProblems, unitPriceFor } from '../src/modules/catalog/pricing.js';
import { api, catalogProduct, createTestApp, resetDb, signIn, supply, type TestContext } from './helpers.js';

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
let catId: string; // "Mobile Spare Parts" > "Displays"
let displaysId: string;
let brandId: string;

beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  http = api(t);
  admin = (await signIn(t, 'admin')).token;
  catId = (await http.post('/v1/admin/categories', admin, { name: 'Mobile Spare Parts' })).json().id;
  displaysId = (await http.post('/v1/admin/categories', admin, { name: 'Displays', parentId: catId })).json().id;
  brandId = (await http.post('/v1/admin/brands', admin, { name: 'Voltix' })).json().id;
});
afterEach(async () => {
  await t.close();
});

const productBody = (over: Record<string, unknown> = {}) => ({
  categoryId: displaysId,
  brandId,
  name: 'Display for Galaxy A15',
  partNumber: 'DSP-A15-OLED',
  hsnCode: '85177900',
  gstRateBps: 1800,
  variants: [
    { name: 'Black', mrpPaise: 45_000, pricePaise: 38_000, slabs: [{ minQty: 10, pricePaise: 35_000 }] },
    { name: 'With frame', mrpPaise: 220_000, pricePaise: 180_000 },
  ],
  ...over,
});

async function liveProduct(over: Record<string, unknown> = {}) {
  return (await catalogProduct(http, admin, productBody(over))).productId;
}

describe('taxonomy', () => {
  it('serves an active two-level category tree and brands', async () => {
    const buyer = (await signIn(t, 'retailer')).token;
    const res = await http.get('/v1/categories', buyer);
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toMatchObject([
      { name: 'Mobile Spare Parts', slug: 'mobile-spare-parts', children: [{ name: 'Displays', slug: 'displays' }] },
    ]);
    expect((await http.get('/v1/brands', buyer)).json().items).toMatchObject([{ name: 'Voltix', slug: 'voltix' }]);
  });

  it('reflects admin changes immediately (cache is cleared on write)', async () => {
    const buyer = (await signIn(t, 'retailer')).token;
    await http.get('/v1/categories', buyer); // warm the cache
    await http.patch(`/v1/admin/categories/${displaysId}`, admin, { isActive: false });
    expect((await http.get('/v1/categories', buyer)).json().items[0].children).toEqual([]);
  });

  it('allows only one level of nesting', async () => {
    const res = await http.post('/v1/admin/categories', admin, { name: 'Too Deep', parentId: displaysId });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CATEGORY_DEPTH');
  });

  it('rejects duplicate slugs', async () => {
    const res = await http.post('/v1/admin/brands', admin, { name: 'VOLTIX' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SLUG_TAKEN');
  });

  it('is admin-only to change', async () => {
    const wholesaler = (await signIn(t, 'wholesaler')).token;
    expect((await http.post('/v1/admin/categories', wholesaler, { name: 'X' })).statusCode).toBe(403);
  });
});

describe('the admin catalog', () => {
  it('creates a draft that buyers cannot see until it is published', async () => {
    const buyer = (await signIn(t, 'retailer')).token;
    const w = await signIn(t, 'wholesaler');

    const created = await http.post('/v1/admin/products', admin, productBody());
    expect(created.statusCode).toBe(201);
    const p = created.json();
    expect(p).toMatchObject({ status: 'draft', category: { name: 'Displays' }, brand: { name: 'Voltix' } });
    expect(p.variants[0]).toMatchObject({ name: 'Black', pricePaise: 38_000, stockQty: 0, offers: [], myOffer: null });

    expect((await http.get(`/v1/products/${p.id}`, buyer)).statusCode).toBe(404);
    expect((await http.get('/v1/products', buyer)).json().items).toHaveLength(0);
    // Wholesalers only see published products, too.
    expect((await http.get(`/v1/wholesaler/catalog/${p.id}`, w.token)).statusCode).toBe(404);

    await http.post(`/v1/admin/products/${p.id}/publish`, admin);
    await supply(http, w.token, p.variants[0].id, 34_000, 120);
    await supply(http, w.token, p.variants[1].id, 160_000, 30);
    const list = (await http.get('/v1/products', buyer)).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      name: 'Display for Galaxy A15',
      brandName: 'Voltix',
      categoryName: 'Displays',
      minPricePaise: 38_000,
      mrpPaise: 45_000,
      totalStock: 150,
      statusReason: null,
      supplierCount: null,
    });
    const detail = (await http.get(`/v1/products/${p.id}`, buyer)).json();
    expect(detail.variants[0]).toMatchObject({ stockQty: 120, offers: null, myOffer: null });
    expect(JSON.stringify(detail)).not.toMatch(/34000|supplyPrice/);
  });

  it('is only for the admin', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const retailer = (await signIn(t, 'retailer')).token;
    expect((await http.post('/v1/admin/products', w, productBody())).statusCode).toBe(403);
    expect((await http.post('/v1/admin/products', retailer, productBody())).statusCode).toBe(403);
    const id = await liveProduct();
    expect((await http.patch(`/v1/admin/products/${id}`, w, { name: 'Hijacked' })).statusCode).toBe(403);
  });

  it('validates pricing on create and on variant updates', async () => {
    const bad = await http.post('/v1/admin/products', admin, productBody({ variants: [{ name: 'X', mrpPaise: 100, pricePaise: 200 }] }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('INVALID_PRICING');

    const p = (await http.post('/v1/admin/products', admin, productBody())).json();
    const variantId = p.variants.find((v: { name: string }) => v.name === 'Black').id;
    const notCheaper = await http.patch(`/v1/admin/products/variants/${variantId}`, admin, {
      slabs: [{ minQty: 10, pricePaise: 39_000 }],
    });
    expect(notCheaper.statusCode).toBe(400);

    const ok = await http.patch(`/v1/admin/products/variants/${variantId}`, admin, {
      slabs: [
        { minQty: 10, pricePaise: 36_000 },
        { minQty: 100, pricePaise: 33_000 },
      ],
    });
    expect(ok.statusCode).toBe(200);
    const v = ok.json().variants.find((x: { id: string }) => x.id === variantId);
    expect(v).toMatchObject({ slabs: [{ minQty: 10 }, { minQty: 100 }] });
  });

  it('rejects unsupported GST rates and malformed HSN codes', async () => {
    expect((await http.post('/v1/admin/products', admin, productBody({ gstRateBps: 1500 }))).statusCode).toBe(400);
    expect((await http.post('/v1/admin/products', admin, productBody({ hsnCode: '12345' }))).statusCode).toBe(400);
  });

  it('cannot publish without an active variant', async () => {
    const p = (await http.post('/v1/admin/products', admin, productBody())).json();
    for (const v of p.variants) await http.patch(`/v1/admin/products/variants/${v.id}`, admin, { isActive: false });
    const res = await http.post(`/v1/admin/products/${p.id}/publish`, admin);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('NO_ACTIVE_VARIANT');
  });

  it('hides a product with a note and audits catalog changes', async () => {
    const buyer = (await signIn(t, 'retailer')).token;
    const id = await liveProduct();
    const hidden = await http.post(`/v1/admin/products/${id}/hide`, admin, { reason: 'Wrong compatibility list' });
    expect(hidden.json()).toMatchObject({ status: 'hidden', statusReason: 'Wrong compatibility list' });
    expect((await http.get(`/v1/products/${id}`, buyer)).statusCode).toBe(404);
    expect((await http.post(`/v1/admin/products/${id}/publish`, admin)).json()).toMatchObject({ status: 'active', statusReason: null });

    const actions = (await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, id))).map((a) => a.action);
    expect(actions.sort()).toEqual(['product.create', 'product.hide', 'product.publish', 'product.publish']);
  });

  it('lists every product with filters, and shows the admin every supplier', async () => {
    const w1 = await signIn(t, 'wholesaler', { name: 'Lamington Mobile Hub' });
    const w2 = await signIn(t, 'wholesaler');
    const { productId, variantId } = await catalogProduct(http, admin, productBody());
    await http.post('/v1/admin/products', admin, productBody({ name: 'Draft thing' }));
    await supply(http, w1.token, variantId, 34_000, 0);
    await supply(http, w2.token, variantId, 33_000, 7);

    expect((await http.get('/v1/admin/products', admin)).json().items).toHaveLength(2);
    expect((await http.get('/v1/admin/products?status=draft', admin)).json().items[0].name).toBe('Draft thing');
    expect((await http.get(`/v1/admin/products?wholesalerId=${w1.id}`, admin)).json().items).toHaveLength(1);
    expect((await http.get('/v1/admin/products?stock=out', admin)).json().items.map((p: { name: string }) => p.name)).toEqual([
      'Draft thing',
    ]);
    const live = (await http.get('/v1/admin/products?status=active', admin)).json().items[0];
    expect(live.supplierCount).toBe(1); // only w2 has stock

    const detail = (await http.get(`/v1/admin/products/${productId}`, admin)).json();
    expect(detail.variants[0].offers).toMatchObject([
      { wholesalerId: w2.id, supplyPricePaise: 33_000, stockQty: 7, usable: true },
      { wholesalerId: w1.id, businessName: 'Lamington Mobile Hub', supplyPricePaise: 34_000, stockQty: 0 },
    ]);
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

describe('wholesaler stock (supplier offers)', () => {
  it('lets a wholesaler browse the catalog and set their own price and stock per variant', async () => {
    const w = await signIn(t, 'wholesaler');
    const other = await signIn(t, 'wholesaler');
    const { productId, variantIds } = await catalogProduct(http, admin, productBody());
    await liveProduct({ name: 'Battery for Redmi Note 12', partNumber: 'BAT-RN12' });

    const catalog = (await http.get('/v1/wholesaler/catalog', w.token)).json().items;
    expect(catalog).toHaveLength(2);
    expect(catalog.every((p: { myStockQty: number }) => p.myStockQty === 0)).toBe(true);

    const res = await http.put(`/v1/wholesaler/catalog/variants/${variantIds[0]}/offer`, w.token, { supplyPricePaise: 34_000, stockQty: 40 });
    expect(res.statusCode).toBe(200);
    expect(res.json().variants.find((v: { id: string }) => v.id === variantIds[0]).myOffer).toEqual({
      supplyPricePaise: 34_000,
      stockQty: 40,
      isActive: true,
    });
    await supply(http, other.token, variantIds[0] as string, 30_000, 5);

    // Each wholesaler sees only their own offer, never anyone else's.
    const mine = (await http.get(`/v1/wholesaler/catalog/${productId}`, w.token)).json();
    expect(mine.variants.find((v: { id: string }) => v.id === variantIds[0])).toMatchObject({ myOffer: { stockQty: 40 }, offers: null });
    expect(JSON.stringify(mine)).not.toMatch(/30000/);
    const only = (await http.get('/v1/wholesaler/catalog?mine=true', w.token)).json().items;
    expect(only.map((p: { name: string; myStockQty: number }) => [p.name, p.myStockQty])).toEqual([['Display for Galaxy A15', 40]]);
    expect((await http.get('/v1/wholesaler/catalog?q=redmi', w.token)).json().items).toHaveLength(1);
  });

  it('validates offers and keeps them for approved wholesalers only', async () => {
    const w = (await signIn(t, 'wholesaler')).token;
    const pending = (await signIn(t, 'wholesaler', { status: 'pending' })).token;
    const retailer = (await signIn(t, 'retailer')).token;
    const { variantId } = await catalogProduct(http, admin, productBody());
    const url = `/v1/wholesaler/catalog/variants/${variantId}/offer`;
    expect((await http.put(url, w, { supplyPricePaise: 0, stockQty: 1 })).statusCode).toBe(400);
    expect((await http.put(url, w, { supplyPricePaise: 100, stockQty: -1 })).statusCode).toBe(400);
    expect((await http.put(url, pending, { supplyPricePaise: 100, stockQty: 1 })).json().code).toBe('ACCOUNT_PENDING');
    expect((await http.put(url, retailer, { supplyPricePaise: 100, stockQty: 1 })).statusCode).toBe(403);
    expect((await http.put(`/v1/wholesaler/catalog/variants/${crypto.randomUUID()}/offer`, w, { supplyPricePaise: 100, stockQty: 1 })).statusCode).toBe(404);
  });
});

describe('product images', () => {
  it('uploads directly to storage, then attaches after checking the object', async () => {
    const id = await liveProduct();

    const url = await http.post(`/v1/admin/products/${id}/images/upload-url`, admin, {
      contentType: 'image/webp',
      sizeBytes: 25_000,
    });
    expect(url.statusCode).toBe(200);
    const { objectKey, upload } = url.json();
    expect(objectKey).toMatch(new RegExp(`^products/${id}/[0-9a-f-]{36}\\.webp$`));
    expect(upload.headers).toEqual({ 'content-type': 'image/webp', 'content-length': '25000' });

    const early = await http.post(`/v1/admin/products/${id}/images`, admin, { objectKey });
    expect(early.statusCode).toBe(400);
    expect(early.json().code).toBe('IMAGE_NOT_UPLOADED');

    t.storage.put(objectKey, 25_000);
    const attached = await http.post(`/v1/admin/products/${id}/images`, admin, { objectKey });
    expect(attached.statusCode).toBe(201);
    expect(attached.json().images).toEqual([{ id: expect.any(String), url: `https://img.test/${objectKey}`, sortOrder: 0 }]);

    const buyer = (await signIn(t, 'retailer')).token;
    expect((await http.get('/v1/products', buyer)).json().items[0].thumbnailUrl).toBe(`https://img.test/${objectKey}`);

    const imageId = attached.json().images[0].id;
    expect((await http.del(`/v1/admin/products/${id}/images/${imageId}`, admin)).json().images).toEqual([]);
  });

  it('only accepts WebP up to 1 MB', async () => {
    const id = await liveProduct();
    const upload = (body: object) => http.post(`/v1/admin/products/${id}/images/upload-url`, admin, body);
    expect((await upload({ contentType: 'image/jpeg', sizeBytes: 10 })).statusCode).toBe(400);
    expect((await upload({ contentType: 'image/webp', sizeBytes: 2_000_000 })).statusCode).toBe(400);

    // An object that turns out not to be WebP (client ignored the signed headers) is refused.
    const { objectKey } = (await upload({ contentType: 'image/webp', sizeBytes: 10 })).json();
    t.storage.put(objectKey, 10, 'image/png');
    expect((await http.post(`/v1/admin/products/${id}/images`, admin, { objectKey })).json().code).toBe('INVALID_IMAGE');
  });

  it('refuses to attach a key that belongs to another product', async () => {
    const a = await liveProduct();
    const b = await liveProduct({ name: 'Battery for Redmi Note 12' });
    const { objectKey } = (
      await http.post(`/v1/admin/products/${a}/images/upload-url`, admin, { contentType: 'image/webp', sizeBytes: 10 })
    ).json();
    t.storage.put(objectKey, 10);
    const res = await http.post(`/v1/admin/products/${b}/images`, admin, { objectKey });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_IMAGE_KEY');
  });

  it('returns 503 when image storage is not configured', async () => {
    const bare = await createTestApp({}, { realStorage: true });
    try {
      const a = (await signIn(bare, 'admin')).token;
      const cat = (await api(bare).post('/v1/admin/categories', a, { name: `Cat ${Math.random()}` })).json().id;
      const p = (await api(bare).post('/v1/admin/products', a, productBody({ categoryId: cat, brandId: null }))).json();
      const res = await api(bare).post(`/v1/admin/products/${p.id}/images/upload-url`, a, {
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
  it('searches by name, part number and brand, and filters by parent category', async () => {
    const buyer = (await signIn(t, 'retailer')).token;
    await liveProduct();
    const batteriesId = (await http.post('/v1/admin/categories', admin, { name: 'Batteries' })).json().id;
    await liveProduct({ name: 'Battery for Redmi Note 12', partNumber: 'BAT-RN12', categoryId: batteriesId, brandId: null });

    const names = async (qs: string) =>
      (await http.get(`/v1/products?${qs}`, buyer)).json().items.map((p: { name: string }) => p.name);

    expect(await names('q=galaxy')).toEqual(['Display for Galaxy A15']);
    expect(await names('q=bat-rn')).toEqual(['Battery for Redmi Note 12']);
    expect(await names('q=voltix')).toEqual(['Display for Galaxy A15']);
    expect(await names(`categoryId=${catId}`)).toEqual(['Display for Galaxy A15']); // via subcategory
    expect(await names(`categoryId=${batteriesId}`)).toEqual(['Battery for Redmi Note 12']);
    expect(await names(`brandId=${brandId}`)).toHaveLength(1);
    // LIKE wildcards are matched literally.
    expect(await names('q=%25%25')).toEqual([]);
  });

  it('paginates with a cursor', async () => {
    const buyer = (await signIn(t, 'retailer')).token;
    for (const n of ['A', 'B', 'C']) await liveProduct({ name: `Part ${n}` });
    const p1 = (await http.get('/v1/products?limit=2', buyer)).json();
    const p2 = (await http.get(`/v1/products?limit=2&cursor=${p1.nextCursor}`, buyer)).json();
    expect([...p1.items, ...p2.items].map((p: { name: string }) => p.name)).toEqual(['Part C', 'Part B', 'Part A']);
    expect(p2.nextCursor).toBeNull();
  });

  it('hides inactive variants and products without any', async () => {
    const buyer = (await signIn(t, 'retailer')).token;
    const { productId: id, variantIds } = await catalogProduct(http, admin, productBody());
    await http.patch(`/v1/admin/products/variants/${variantIds[0]}`, admin, { isActive: false });
    expect((await http.get(`/v1/products/${id}`, buyer)).json().variants).toHaveLength(1);

    await http.patch(`/v1/admin/products/variants/${variantIds[1]}`, admin, { isActive: false });
    expect((await http.get(`/v1/products/${id}`, buyer)).statusCode).toBe(404);
  });

  it('shows out-of-stock products, and hides products in inactive categories', async () => {
    const buyer = (await signIn(t, 'retailer')).token;
    const id = await liveProduct();
    expect((await http.get(`/v1/products/${id}`, buyer)).json().variants[0].stockQty).toBe(0);

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
