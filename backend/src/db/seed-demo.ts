/**
 * Fills a development (or Play-review staging) database with a realistic demo marketplace:
 * categories, brands, three wholesalers with products, retailers, riders, and orders in every
 * status, created through the real API in-process so the data is exactly what real use produces.
 *
 *   pnpm db:seed:demo
 *
 * Every demo account signs in with its phone number and the fixed DEMO_OTP (default 123456);
 * add the printed numbers to DEMO_PHONES. Refuses to run in production or twice.
 */
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { hashPassword } from '../lib/password.js';
import { hotp, newTotpSecret, SecretBox, timeStep } from '../lib/totp.js';
import { createDb } from './index.js';
import { deliveryProfiles, retailerProfiles, users, wholesalerProfiles } from './schema.js';

const out = (...parts: string[]) => void process.stdout.write(`${parts.join(' ')}\n`);

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  out('Refusing to seed demo data in production.');
  process.exit(1);
}

const { db, pool } = createDb(env.DATABASE_URL, 2);
const PASSWORD = `demo-${newTotpSecret().toString('hex')}`; // only used to sign in here, never printed
const INFO = (s: string) => out(`  ${s}`);

type Role = 'admin' | 'retailer' | 'wholesaler' | 'delivery';
interface Account {
  id: string;
  token: string;
  phone: string | null;
}

let app: FastifyInstance | undefined;
const server = (): FastifyInstance => {
  if (!app) throw new Error('app not started');
  return app;
};
const call = async <T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, token: string, payload?: object) => {
  const res = await server().inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return (res.statusCode === 204 ? {} : res.json()) as T;
};

// ------------------------------------------------------------------------------------- accounts

const ACCOUNTS = {
  wholesalers: [
    { phone: '+919000000101', name: 'Ramesh Kulkarni', business: 'Bharat Auto Spares', city: 'Pune', pincode: '411002', gstin: '27AAPFU0939F1ZV', addressLine: 'Shop 12, Budhwar Peth' },
    { phone: '+919000000102', name: 'Vinod Deshmukh', business: 'Shree Ganesh Motors', city: 'Nashik', pincode: '422001', gstin: null, addressLine: '45 MG Road' },
    { phone: '+919000000103', name: 'Farhan Qureshi', business: 'Deccan Parts House', city: 'Mumbai', pincode: '400008', gstin: null, addressLine: '7 Lamington Road' },
  ],
  retailers: [
    { phone: '+919000000201', name: 'Suresh Sharma', shop: 'Sharma Auto Parts', city: 'Nashik', pincode: '422003', status: 'approved' as const },
    { phone: '+919000000202', name: 'Anil Patil', shop: 'Patil Motor Garage', city: 'Pune', pincode: '411014', status: 'approved' as const },
    { phone: '+919000000203', name: 'Javed Khan', shop: 'New India Bike Point', city: 'Mumbai', pincode: '400050', status: 'approved' as const },
    { phone: '+919000000204', name: 'Prakash More', shop: 'Om Sai Auto Centre', city: 'Pune', pincode: '411028', status: 'pending' as const },
  ],
  riders: [
    { phone: '+919000000301', name: 'Raju Pawar', vehicle: 'Bike', number: 'MH12AB1234', status: 'approved' as const },
    { phone: '+919000000302', name: 'Sunil Jadhav', vehicle: 'Scooter', number: 'MH15CD5678', status: 'approved' as const },
    { phone: '+919000000303', name: 'Imran Shaikh', vehicle: 'Bike', number: null, status: 'pending' as const },
  ],
};

async function createAccount(role: Role, values: { name: string; phone: string | null; email: string; status?: 'pending' | 'approved' }, totp?: Buffer) {
  const [row] = await db
    .insert(users)
    .values({
      role,
      status: values.status ?? 'approved',
      name: values.name,
      phone: values.phone,
      phoneVerifiedAt: values.phone ? new Date() : null,
      email: values.email,
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(PASSWORD),
      consentAt: new Date(),
      consentVersion: '2026-11-01',
      approvedAt: values.status === 'pending' ? null : new Date(),
      ...(totp ? { totpSecret: new SecretBox(env.OTP_SECRET).seal(totp), totpEnabledAt: new Date() } : {}),
    })
    .returning({ id: users.id });
  return (row as { id: string }).id;
}

async function login(email: string, app_: 'admin' | 'partpoint' | 'delivery', totp?: Buffer): Promise<string> {
  const deviceId = `seed-${app_}-device`;
  const res = await server().inject({ method: 'POST', url: '/v1/auth/login/email', payload: { email, password: PASSWORD, app: app_, deviceId } });
  if (res.statusCode !== 200) throw new Error(`login ${email}: ${res.body}`);
  if (!totp) return res.json().tokens.accessToken;
  const mfa = await server().inject({
    method: 'POST',
    url: '/v1/auth/login/totp',
    payload: { challengeToken: res.json().challengeToken, code: hotp(totp, timeStep()), deviceId },
  });
  if (mfa.statusCode !== 200) throw new Error(`seed admin 2FA: ${mfa.body}`);
  return mfa.json().tokens.accessToken;
}

// ------------------------------------------------------------------------------------- catalog

const TREE: Record<string, string[]> = {
  Engine: ['Filters', 'Spark plugs', 'Belts & chains'],
  Brakes: ['Brake pads', 'Brake shoes & cables'],
  Electrical: ['Batteries', 'Bulbs & lighting'],
  Suspension: ['Shock absorbers'],
  'Body & accessories': ['Mirrors & levers'],
};
// Invented brand names: no third-party trademarks in demo data or store screenshots.
const BRANDS = ['Vega Auto', 'ProDrive', 'Sparkline', 'Roadmax', 'Kavach'];

interface ProductSeed {
  w: number; // wholesaler index
  cat: string;
  brand: string;
  name: string;
  part?: string;
  hsn: string;
  gst: number;
  desc: string;
  variants: { name: string; mrp: number; price: number; stock: number; slabs?: [number, number][] }[];
}

const r = (rupees: number) => Math.round(rupees * 100);
const PRODUCTS: ProductSeed[] = [
  { w: 0, cat: 'Filters', brand: 'Vega Auto', name: 'Oil filter for 100–125cc bikes', part: 'VA-OF-125', hsn: '84212300', gst: 1800, desc: 'Paper element oil filter. Fits most 100–125cc commuter motorcycles.', variants: [{ name: 'Single', mrp: 180, price: 128, stock: 240, slabs: [[10, 118], [50, 109]] }, { name: 'Box of 10', mrp: 1800, price: 1150, stock: 30 }] },
  { w: 0, cat: 'Spark plugs', brand: 'Sparkline', name: 'Spark plug, standard', part: 'SL-SP-C7', hsn: '85111000', gst: 1800, desc: 'Copper core spark plug for 2-stroke and 4-stroke engines.', variants: [{ name: 'Single', mrp: 150, price: 92, stock: 500, slabs: [[20, 86], [100, 79]] }] },
  { w: 0, cat: 'Brake pads', brand: 'Kavach', name: 'Disc brake pads, front', part: 'KV-BP-F150', hsn: '87083000', gst: 1800, desc: 'Semi-metallic pads for 150–200cc motorcycles with front disc.', variants: [{ name: 'Pair', mrp: 450, price: 318, stock: 120, slabs: [[10, 299]] }] },
  { w: 0, cat: 'Batteries', brand: 'Roadmax', name: 'Two-wheeler battery 12V 5Ah', part: 'RM-12V5', hsn: '85071000', gst: 1800, desc: 'Maintenance-free battery with 24-month warranty.', variants: [{ name: '12V 5Ah', mrp: 1850, price: 1420, stock: 40 }, { name: '12V 9Ah', mrp: 2650, price: 2080, stock: 18 }] },
  { w: 0, cat: 'Belts & chains', brand: 'ProDrive', name: 'Chain sprocket kit', part: 'PD-CSK-100', hsn: '87149990', gst: 1800, desc: 'Chain with front and rear sprockets for 100cc bikes.', variants: [{ name: '100cc', mrp: 1400, price: 985, stock: 35 }, { name: '125cc', mrp: 1550, price: 1095, stock: 22 }] },
  { w: 0, cat: 'Mirrors & levers', brand: 'Roadmax', name: 'Clutch lever', hsn: '87149990', gst: 1800, desc: 'Die-cast aluminium clutch lever.', variants: [{ name: 'Standard', mrp: 120, price: 74, stock: 0 }] },
  { w: 1, cat: 'Filters', brand: 'Vega Auto', name: 'Air filter for scooters', part: 'VA-AF-110', hsn: '84213100', gst: 1800, desc: 'Foam-paper air filter for 110cc scooters.', variants: [{ name: 'Single', mrp: 260, price: 176, stock: 140, slabs: [[10, 165]] }] },
  { w: 1, cat: 'Brake shoes & cables', brand: 'Kavach', name: 'Brake shoe set, rear', part: 'KV-BS-R', hsn: '87083000', gst: 1800, desc: 'Asbestos-free brake shoes for drum brakes.', variants: [{ name: 'Set of 2', mrp: 320, price: 210, stock: 90, slabs: [[12, 196]] }] },
  { w: 1, cat: 'Shock absorbers', brand: 'ProDrive', name: 'Rear shock absorber', part: 'PD-RSA-02', hsn: '87088000', gst: 1800, desc: 'Gas-charged rear shock absorber, adjustable preload.', variants: [{ name: 'Pair', mrp: 2400, price: 1760, stock: 14 }] },
  { w: 1, cat: 'Bulbs & lighting', brand: 'Sparkline', name: 'Headlight bulb 12V 35/35W', part: 'SL-HB-35', hsn: '85392990', gst: 1800, desc: 'Halogen headlight bulb, P15D base.', variants: [{ name: 'Single', mrp: 95, price: 54, stock: 600, slabs: [[25, 49], [100, 45]] }] },
  { w: 1, cat: 'Mirrors & levers', brand: 'Roadmax', name: 'Rear-view mirror set', hsn: '70091000', gst: 1800, desc: 'Universal rear-view mirrors, M10 thread.', variants: [{ name: 'Pair, black', mrp: 340, price: 228, stock: 75 }] },
  { w: 2, cat: 'Spark plugs', brand: 'Sparkline', name: 'Iridium spark plug', part: 'SL-IR-9', hsn: '85111000', gst: 1800, desc: 'Long-life iridium tip for better mileage.', variants: [{ name: 'Single', mrp: 520, price: 395, stock: 80, slabs: [[10, 372]] }] },
  { w: 2, cat: 'Batteries', brand: 'Roadmax', name: 'Scooter battery 12V 4Ah', part: 'RM-12V4', hsn: '85071000', gst: 1800, desc: 'Sealed battery for scooters, ready to fit.', variants: [{ name: '12V 4Ah', mrp: 1650, price: 1260, stock: 26 }] },
  { w: 2, cat: 'Brake pads', brand: 'Kavach', name: 'Disc brake pads, rear', part: 'KV-BP-R150', hsn: '87083000', gst: 1800, desc: 'Ceramic pads for low dust and quiet braking.', variants: [{ name: 'Pair', mrp: 420, price: 305, stock: 64 }] },
  { w: 2, cat: 'Belts & chains', brand: 'ProDrive', name: 'Drive belt for 110cc scooters', part: 'PD-DB-110', hsn: '40103999', gst: 1800, desc: 'CVT drive belt, Kevlar reinforced.', variants: [{ name: 'Single', mrp: 780, price: 545, stock: 48 }] },
];

// ------------------------------------------------------------------------------------- run

const demoPhones = [...ACCOUNTS.wholesalers, ...ACCOUNTS.retailers, ...ACCOUNTS.riders].map((a) => a.phone);
try {
  const existing = await db.select({ id: users.id }).from(users).where(inArray(users.phone, demoPhones));
  if (existing.length > 0) {
    out('Demo data is already present (demo phone numbers exist). Nothing to do.');
    process.exit(0);
  }

  app = await buildApp({ env, db, checks: { postgres: async () => void (await pool.query('SELECT 1')) } });
  out('Seeding demo marketplace…');

  // A short-lived operator account for the admin steps; disabled again at the end.
  const opsTotp = newTotpSecret();
  const opsEmail = `seed-ops-${Date.now()}@partpoint.local`;
  const opsId = await createAccount('admin', { name: 'Demo seed', phone: null, email: opsEmail }, opsTotp);
  const admin = await login(opsEmail, 'admin', opsTotp);

  // Realistic platform settings, so fees, commission and rider earnings show up in the data.
  await call('PATCH', '/v1/admin/settings', admin, { commissionBps: 500, deliveryFeePaise: r(40), deliveryEarningPaise: r(30), minOrderPaise: r(300) });

  // Catalog structure
  const catId: Record<string, string> = {};
  let order = 0;
  for (const [top, subs] of Object.entries(TREE)) {
    const parent = await call<{ id: string }>('POST', '/v1/admin/categories', admin, { name: top, sortOrder: order++ * 10 });
    catId[top] = parent.id;
    for (const sub of subs) catId[sub] = (await call<{ id: string }>('POST', '/v1/admin/categories', admin, { name: sub, parentId: parent.id })).id;
  }
  const brandId: Record<string, string> = {};
  for (const b of BRANDS) brandId[b] = (await call<{ id: string }>('POST', '/v1/admin/brands', admin, { name: b })).id;
  INFO(`${Object.keys(catId).length} categories, ${BRANDS.length} brands`);

  // People
  const wholesalers: Account[] = [];
  for (const [i, w] of ACCOUNTS.wholesalers.entries()) {
    const email = `demo-wholesaler-${i + 1}@partpoint.local`;
    const id = await createAccount('wholesaler', { name: w.name, phone: w.phone, email });
    await db.insert(wholesalerProfiles).values({ userId: id, businessName: w.business, gstin: w.gstin, addressLine: w.addressLine, city: w.city, state: 'Maharashtra', pincode: w.pincode });
    wholesalers.push({ id, phone: w.phone, token: await login(email, 'partpoint') });
  }
  const retailers: (Account & { addressId?: string })[] = [];
  for (const [i, rt] of ACCOUNTS.retailers.entries()) {
    const email = `demo-retailer-${i + 1}@partpoint.local`;
    const id = await createAccount('retailer', { name: rt.name, phone: rt.phone, email, status: rt.status });
    await db.insert(retailerProfiles).values({ userId: id, shopName: rt.shop });
    if (rt.status !== 'approved') continue;
    const token = await login(email, 'partpoint');
    const address = await call<{ id: string }>('POST', '/v1/me/addresses', token, {
      label: 'Shop',
      contactName: rt.name,
      contactPhone: rt.phone.slice(3),
      line1: `${rt.shop}, Main Road`,
      city: rt.city,
      state: 'Maharashtra',
      pincode: rt.pincode,
    });
    retailers.push({ id, phone: rt.phone, token, addressId: address.id });
  }
  const riders: Account[] = [];
  for (const [i, d] of ACCOUNTS.riders.entries()) {
    const email = `demo-rider-${i + 1}@partpoint.local`;
    const id = await createAccount('delivery', { name: d.name, phone: d.phone, email, status: d.status });
    await db.insert(deliveryProfiles).values({ userId: id, vehicleType: d.vehicle, vehicleNumber: d.number, isAvailable: d.status === 'approved' });
    if (d.status === 'approved') riders.push({ id, phone: d.phone, token: await login(email, 'delivery') });
  }
  INFO(`${wholesalers.length} wholesalers, ${ACCOUNTS.retailers.length} retailers (1 pending), ${ACCOUNTS.riders.length} riders (1 pending)`);

  // Products (published by their wholesalers)
  const variants: { id: string; w: number; productId: string }[] = [];
  for (const p of PRODUCTS) {
    const w = wholesalers[p.w] as Account;
    const created = await call<{ id: string; variants: { id: string }[] }>('POST', '/v1/wholesaler/products', w.token, {
      categoryId: catId[p.cat],
      brandId: brandId[p.brand],
      name: p.name,
      description: p.desc,
      ...(p.part ? { partNumber: p.part } : {}),
      hsnCode: p.hsn,
      gstRateBps: p.gst,
      variants: p.variants.map((v) => ({
        name: v.name,
        mrpPaise: r(v.mrp),
        pricePaise: r(v.price),
        stockQty: v.stock,
        slabs: (v.slabs ?? []).map(([minQty, price]) => ({ minQty, pricePaise: r(price) })),
      })),
    });
    await call('POST', `/v1/wholesaler/products/${created.id}/publish`, w.token);
    for (const v of created.variants) variants.push({ id: v.id, w: p.w, productId: created.id });
  }
  INFO(`${PRODUCTS.length} products, ${variants.length} variants`);

  // Orders in every status. Each order is one retailer buying from one wholesaler.
  const place = async (retailer: (typeof retailers)[number], items: [number, number][]) => {
    for (const [vi, qty] of items) await call('PUT', `/v1/cart/items/${(variants[vi] as { id: string }).id}`, retailer.token, { qty });
    const res = await call<{ orders: { id: string }[] }>('POST', '/v1/orders', retailer.token, { addressId: retailer.addressId, idempotencyKey: `seed-${Math.random()}` });
    return (res.orders[0] as { id: string }).id;
  };
  const [rA, rB, rC] = retailers as [(typeof retailers)[number], (typeof retailers)[number], (typeof retailers)[number]];
  const [wA, wB] = wholesalers as [Account, Account, Account];
  const [riderA, riderB] = riders as [Account, Account];
  const deliver = async (orderId: string, w: Account, rider: Account, retailer: Account, review?: { productId: string; rating: number; comment: string }) => {
    await call('POST', `/v1/wholesaler/orders/${orderId}/accept`, w.token);
    await call('POST', `/v1/wholesaler/orders/${orderId}/pack`, w.token);
    await call('POST', `/v1/admin/orders/${orderId}/assign`, admin, { deliveryPartnerId: rider.id });
    await call('POST', `/v1/delivery/orders/${orderId}/accept`, rider.token);
    await call('POST', `/v1/delivery/orders/${orderId}/pickup`, rider.token);
    await call('POST', `/v1/delivery/orders/${orderId}/out-for-delivery`, rider.token);
    const { deliveryOtp } = await call<{ deliveryOtp: string }>('GET', `/v1/orders/${orderId}`, retailer.token);
    await call('POST', `/v1/delivery/orders/${orderId}/deliver`, rider.token, { otp: deliveryOtp });
    if (review) await call('PUT', `/v1/orders/${orderId}/reviews/${review.productId}`, retailer.token, { rating: review.rating, comment: review.comment });
  };

  // Variant indexes follow PRODUCTS order: 0–1 oil filter, 2 spark plug, 3 brake pads, 4–5 battery, 6–7 chain kit, 8 lever,
  // 9 air filter, 10 brake shoes, 11 shock, 12 bulb, 13 mirrors, 14 iridium, 15 scooter battery, 16 rear pads, 17 belt.
  const v = (i: number) => (variants[i] as { productId: string }).productId;
  await deliver(await place(rA, [[0, 20], [2, 30]]), wA, riderA, rA, { productId: v(0), rating: 5, comment: 'Genuine quality, delivered the same day.' });
  await deliver(await place(rB, [[3, 6], [4, 2]]), wA, riderB, rB, { productId: v(3), rating: 4, comment: 'Good pads, packing could be better.' });
  await deliver(await place(rA, [[9, 12], [12, 50]]), wB, riderA, rA, { productId: v(12), rating: 2, comment: 'Two bulbs fused in a week. Call me on 98xxxxxx for a better deal!!' });
  await deliver(await place(rC, [[10, 12]]), wB, riderB, rC);

  const outForDelivery = await place(rB, [[6, 2]]);
  await call('POST', `/v1/wholesaler/orders/${outForDelivery}/accept`, wA.token);
  await call('POST', `/v1/wholesaler/orders/${outForDelivery}/pack`, wA.token);
  await call('POST', `/v1/admin/orders/${outForDelivery}/assign`, admin, { deliveryPartnerId: riderA.id });
  await call('POST', `/v1/delivery/orders/${outForDelivery}/accept`, riderA.token);
  await call('POST', `/v1/delivery/orders/${outForDelivery}/pickup`, riderA.token);
  await call('POST', `/v1/delivery/orders/${outForDelivery}/out-for-delivery`, riderA.token);

  const packed = await place(rC, [[11, 1], [13, 4]]);
  await call('POST', `/v1/wholesaler/orders/${packed}/accept`, wB.token);
  await call('POST', `/v1/wholesaler/orders/${packed}/pack`, wB.token);

  const accepted = await place(rA, [[1, 2]]);
  await call('POST', `/v1/wholesaler/orders/${accepted}/accept`, wA.token);

  await place(rB, [[0, 10], [2, 20]]); // new, waiting for the wholesaler
  await place(rC, [[12, 25]]);

  const cancelled = await place(rA, [[5, 1]]);
  await call('POST', `/v1/admin/orders/${cancelled}/cancel`, admin, { reason: 'Retailer asked to cancel: ordered the wrong battery size.' });
  INFO('10 orders: 4 delivered, 1 out for delivery, 1 packed, 1 accepted, 2 new, 1 cancelled');

  // A reported review for the moderation queue (the one with a phone number in it).
  const { items } = await call<{ items: { id: string; rating: number }[] }>('GET', '/v1/admin/reviews?limit=50', admin);
  const spam = items.find((x) => x.rating === 2);
  if (spam) await call('POST', `/v1/reviews/${spam.id}/report`, rB.token, { reason: 'Contains a phone number and advertising' });

  await call('POST', '/v1/admin/coupons', admin, { code: 'WELCOME10', description: '10% off your first order', discountType: 'percent', discountValue: 1000, maxDiscountPaise: r(200), minOrderPaise: r(500), perUserLimit: 1, isActive: true });
  await call('POST', '/v1/admin/coupons', admin, { code: 'BULK250', description: '₹250 off orders above ₹5,000', discountType: 'flat', discountValue: r(250), minOrderPaise: r(5000), perUserLimit: 3, isActive: true });
  INFO('1 reported review, 2 coupons');

  // Disable the seed operator: no password, no 2FA, marked deleted.
  await db.update(users).set({ passwordHash: null, totpSecret: null, totpEnabledAt: null, deletedAt: new Date() }).where(eq(users.id, opsId));

  out('\nDone. Demo accounts sign in with their phone number and DEMO_OTP. Add to .env:');
  out(`  DEMO_PHONES=${demoPhones.join(',')}`);
  out('  DEMO_OTP=123456');
  out('\n  Wholesalers:', ACCOUNTS.wholesalers.map((w) => `${w.business} ${w.phone}`).join(' | '));
  out('  Retailers:  ', ACCOUNTS.retailers.map((x) => `${x.shop} ${x.phone}${x.status === 'pending' ? ' (pending)' : ''}`).join(' | '));
  out('  Riders:     ', ACCOUNTS.riders.map((x) => `${x.name} ${x.phone}${x.status === 'pending' ? ' (pending)' : ''}`).join(' | '));
} finally {
  await app?.close();
  await pool.end();
}
