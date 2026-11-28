/**
 * Fills a development (or Play-review staging) database with a realistic demo marketplace:
 * a mobile spare parts and accessories catalog, three wholesalers stocking it, retailers (repair
 * shops and mobile stores), riders, and orders in every status (including split and handed-back
 * orders), created through the real API in-process so the data is exactly what real use produces.
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
    { phone: '+919000000101', name: 'Ramesh Kulkarni', business: 'Shree Sai Mobile Parts', city: 'Pune', pincode: '411002', gstin: '27AAPFU0939F1ZV', addressLine: 'Shop 12, Budhwar Peth' },
    { phone: '+919000000102', name: 'Vinod Deshmukh', business: 'Nashik Cell Spares', city: 'Nashik', pincode: '422001', gstin: null, addressLine: '45 MG Road' },
    { phone: '+919000000103', name: 'Farhan Qureshi', business: 'Lamington Mobile Hub', city: 'Mumbai', pincode: '400008', gstin: null, addressLine: '7 Lamington Road' },
  ],
  retailers: [
    { phone: '+919000000201', name: 'Suresh Sharma', shop: 'Sharma Mobile Repair', city: 'Nashik', pincode: '422003', status: 'approved' as const },
    { phone: '+919000000202', name: 'Anil Patil', shop: 'Patil Mobile Care', city: 'Pune', pincode: '411014', status: 'approved' as const },
    { phone: '+919000000203', name: 'Javed Khan', shop: 'New India Mobile Point', city: 'Mumbai', pincode: '400050', status: 'approved' as const },
    { phone: '+919000000204', name: 'Prakash More', shop: 'Om Sai Mobile Shop', city: 'Pune', pincode: '411028', status: 'pending' as const },
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
  'Mobile spare parts': ['Displays & touch', 'Batteries', 'Charging ports & flex', 'Back panels & frames', 'Cameras', 'Speakers & mics'],
  'Mobile accessories': ['Chargers & adapters', 'Cables', 'Earphones & audio', 'Cases & covers', 'Screen guards', 'Power banks'],
};
// Invented brand and phone-model names: no third-party trademarks in demo data or store screenshots.
const BRANDS = ['Voltix', 'NexCell', 'Zuno', 'Ampora', 'ClearShield'];

/** Who stocks a variant: [wholesaler index, supply price in rupees, stock]. */
type Offer = [number, number, number];
interface ProductSeed {
  cat: string;
  brand: string;
  name: string;
  part?: string;
  hsn: string;
  gst: number;
  desc: string;
  variants: { name: string; mrp: number; price: number; offers: Offer[]; slabs?: [number, number][] }[];
}

const r = (rupees: number) => Math.round(rupees * 100);
const PART = '85177900'; // parts of mobile phones
const PRODUCTS: ProductSeed[] = [
  { cat: 'Displays & touch', brand: 'Voltix', name: 'Display combo for Aero A15', part: 'VX-DSP-A15', hsn: PART, gst: 1800, desc: 'Display with touch, ready to fit. Tested before dispatch. Fits Aero A15 and A15 5G.', variants: [{ name: 'With frame', mrp: 2600, price: 1790, offers: [[0, 1650, 25], [2, 1630, 8]], slabs: [[5, 1720]] }, { name: 'Without frame', mrp: 2200, price: 1490, offers: [[0, 1370, 30]] }] },
  { cat: 'Displays & touch', brand: 'Voltix', name: 'OLED display for Pulse Note 12', part: 'VX-OLED-N12', hsn: PART, gst: 1800, desc: 'OLED panel with true colours and brightness. The in-display fingerprint sensor works.', variants: [{ name: 'OLED', mrp: 4200, price: 3150, offers: [[2, 2900, 12], [1, 2950, 6]] }, { name: 'Incell (budget)', mrp: 2100, price: 1380, offers: [[2, 1260, 20]] }] },
  { cat: 'Batteries', brand: 'NexCell', name: 'Battery for Pulse Note 12', part: 'NC-BAT-N12', hsn: '85076000', gst: 1800, desc: 'Li-polymer 5000 mAh battery with protection circuit. 6-month warranty.', variants: [{ name: '5000 mAh', mrp: 1250, price: 720, offers: [[0, 660, 80], [1, 650, 40], [2, 670, 60]], slabs: [[10, 690], [50, 660]] }] },
  { cat: 'Batteries', brand: 'NexCell', name: 'Battery for Orbit 11', part: 'NC-BAT-O11', hsn: '85076000', gst: 1800, desc: 'High-capacity replacement battery, zero cycle count.', variants: [{ name: '3110 mAh', mrp: 1900, price: 1180, offers: [[2, 1080, 35]] }] },
  { cat: 'Charging ports & flex', brand: 'Zuno', name: 'Charging port board for Zenith M34', part: 'ZN-CPB-M34', hsn: PART, gst: 1800, desc: 'USB-C charging board with microphone. Supports fast charging.', variants: [{ name: 'Standard', mrp: 450, price: 240, offers: [[0, 215, 120], [1, 210, 60]], slabs: [[10, 225]] }] },
  { cat: 'Charging ports & flex', brand: 'Zuno', name: 'Main flex cable for Aero A15', hsn: PART, gst: 1800, desc: 'Board-to-display flex cable.', variants: [{ name: 'Standard', mrp: 280, price: 150, offers: [[1, 132, 90]] }] },
  { cat: 'Back panels & frames', brand: 'Zuno', name: 'Back panel for Pulse Note 12', hsn: PART, gst: 1800, desc: 'Glass back panel with camera lens and adhesive.', variants: [{ name: 'Midnight black', mrp: 650, price: 390, offers: [[0, 350, 40]] }, { name: 'Ocean blue', mrp: 650, price: 390, offers: [[0, 350, 0]] }] },
  { cat: 'Cameras', brand: 'Voltix', name: 'Rear camera module for Orbit 11', hsn: PART, gst: 1800, desc: 'Dual rear camera module, focus tested.', variants: [{ name: 'Dual camera', mrp: 2400, price: 1650, offers: [[2, 1520, 10]] }] },
  { cat: 'Speakers & mics', brand: 'Zuno', name: 'Loudspeaker for Zenith M34', hsn: '85182900', gst: 1800, desc: 'Bottom loudspeaker with ringer.', variants: [{ name: 'Standard', mrp: 320, price: 170, offers: [[1, 150, 70]] }] },
  { cat: 'Chargers & adapters', brand: 'Ampora', name: '20W USB-C fast charger', part: 'AM-CH20C', hsn: '85044030', gst: 1800, desc: 'PD 3.0 wall charger with BIS certification.', variants: [{ name: 'White', mrp: 999, price: 420, offers: [[0, 380, 200], [2, 375, 150]], slabs: [[10, 399], [50, 379]] }, { name: 'Black', mrp: 999, price: 420, offers: [[0, 380, 90]] }] },
  { cat: 'Chargers & adapters', brand: 'Ampora', name: '33W dual-port charger', part: 'AM-CH33D', hsn: '85044030', gst: 1800, desc: 'USB-A and USB-C ports: charges two phones at once.', variants: [{ name: 'White', mrp: 1499, price: 690, offers: [[1, 630, 60]] }] },
  { cat: 'Cables', brand: 'Ampora', name: 'USB-C to USB-C braided cable', hsn: '85444299', gst: 1800, desc: '60W fast-charge cable with nylon braiding.', variants: [{ name: '1 m', mrp: 499, price: 165, offers: [[0, 145, 300], [1, 140, 150]], slabs: [[20, 155], [100, 145]] }, { name: '2 m', mrp: 699, price: 230, offers: [[0, 205, 120]] }] },
  { cat: 'Earphones & audio', brand: 'Zuno', name: 'Wired earphones with mic', hsn: '85183000', gst: 1800, desc: '3.5 mm in-ear earphones with in-line mic and volume control.', variants: [{ name: 'Black', mrp: 399, price: 135, offers: [[2, 118, 250]], slabs: [[20, 126]] }] },
  { cat: 'Earphones & audio', brand: 'Zuno', name: 'Wireless earbuds Z20', hsn: '85183000', gst: 1800, desc: 'Bluetooth 5.3 earbuds, 30-hour battery with the case.', variants: [{ name: 'Black', mrp: 2499, price: 980, offers: [[2, 900, 45]] }] },
  { cat: 'Cases & covers', brand: 'ClearShield', name: 'Transparent back cover for Pulse Note 12', hsn: '39269099', gst: 1800, desc: 'Anti-yellowing TPU cover with raised camera edge.', variants: [{ name: 'Clear', mrp: 299, price: 85, offers: [[0, 72, 400], [1, 70, 200]], slabs: [[20, 79], [100, 72]] }] },
  { cat: 'Screen guards', brand: 'ClearShield', name: '9H tempered glass for Aero A15', hsn: '70071900', gst: 1800, desc: 'Full-glue edge-to-edge tempered glass, 0.33 mm.', variants: [{ name: 'Single', mrp: 249, price: 48, offers: [[0, 40, 500], [1, 39, 300], [2, 41, 400]], slabs: [[25, 44], [100, 40]] }, { name: 'Pack of 10', mrp: 2490, price: 420, offers: [[0, 370, 60]] }] },
  { cat: 'Power banks', brand: 'NexCell', name: '10000 mAh power bank', part: 'NC-PB10', hsn: '85076000', gst: 1800, desc: '22.5W fast-charging power bank with USB-C input and output.', variants: [{ name: 'Black', mrp: 1999, price: 860, offers: [[1, 780, 50], [2, 790, 30]] }] },
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

  // Realistic platform settings, so delivery fees and rider earnings show up in the data.
  await call('PATCH', '/v1/admin/settings', admin, { deliveryFeePaise: r(40), deliveryEarningPaise: r(30), minOrderPaise: r(300) });

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

  // Partpoint's catalog (created by the admin), and each wholesaler's stock of it.
  const variants: { id: string; productId: string }[] = [];
  let offers = 0;
  for (const p of PRODUCTS) {
    const created = await call<{ id: string; variants: { id: string; name: string }[] }>('POST', '/v1/admin/products', admin, {
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
        slabs: (v.slabs ?? []).map(([minQty, price]) => ({ minQty, pricePaise: r(price) })),
      })),
    });
    await call('POST', `/v1/admin/products/${created.id}/publish`, admin);
    for (const seed of p.variants) {
      const variant = created.variants.find((x) => x.name === seed.name) as { id: string };
      variants.push({ id: variant.id, productId: created.id });
      for (const [wi, supplyPrice, stock] of seed.offers) {
        await call('PUT', `/v1/wholesaler/catalog/variants/${variant.id}/offer`, (wholesalers[wi] as Account).token, {
          supplyPricePaise: r(supplyPrice),
          stockQty: stock,
        });
        offers++;
      }
    }
  }
  INFO(`${PRODUCTS.length} products, ${variants.length} variants, ${offers} wholesaler offers`);

  // Orders in every status. Retailers buy from Partpoint; the admin forwards each order to a wholesaler.
  const place = async (retailer: (typeof retailers)[number], items: [number, number][]) => {
    for (const [vi, qty] of items) await call('PUT', `/v1/cart/items/${(variants[vi] as { id: string }).id}`, retailer.token, { qty });
    const res = await call<{ orders: { id: string }[] }>('POST', '/v1/orders', retailer.token, { addressId: retailer.addressId, idempotencyKey: `seed-${Math.random()}` });
    return (res.orders[0] as { id: string }).id;
  };
  const forward = (orderId: string, w: Account) => call('POST', `/v1/admin/orders/${orderId}/forward`, admin, { wholesalerId: w.id });
  const [rA, rB, rC] = retailers as [(typeof retailers)[number], (typeof retailers)[number], (typeof retailers)[number]];
  const [wA, wB, wC] = wholesalers as [Account, Account, Account];
  const [riderA, riderB] = riders as [Account, Account];
  const deliver = async (orderId: string, w: Account, rider: Account, retailer: Account, review?: { productId: string; rating: number; comment: string }) => {
    await forward(orderId, w);
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

  // Variant indexes follow PRODUCTS order: 0–1 A15 display, 2–3 Note 12 display, 4 Note 12 battery, 5 Orbit battery,
  // 6 charging board, 7 flex, 8–9 back panel, 10 camera, 11 speaker, 12–13 20W charger, 14 33W charger, 15–16 cable,
  // 17 earphones, 18 earbuds, 19 cover, 20–21 tempered glass, 22 power bank.
  const v = (i: number) => (variants[i] as { productId: string }).productId;
  await deliver(await place(rA, [[4, 10], [20, 50]]), wA, riderA, rA, { productId: v(4), rating: 5, comment: 'Batteries fit perfectly, delivered the same day.' });
  await deliver(await place(rB, [[0, 2], [6, 5]]), wA, riderB, rB, { productId: v(0), rating: 4, comment: 'Display quality is good, packing could be better.' });
  await deliver(await place(rA, [[17, 20], [12, 10]]), wC, riderA, rA, { productId: v(17), rating: 2, comment: 'Two pairs stopped working in a week. Call me on 98xxxxxx for a better deal!!' });
  await deliver(await place(rC, [[11, 6]]), wB, riderB, rC);

  const outForDelivery = await place(rB, [[2, 1]]);
  await forward(outForDelivery, wC);
  await call('POST', `/v1/wholesaler/orders/${outForDelivery}/accept`, wC.token);
  await call('POST', `/v1/wholesaler/orders/${outForDelivery}/pack`, wC.token);
  await call('POST', `/v1/admin/orders/${outForDelivery}/assign`, admin, { deliveryPartnerId: riderA.id });
  await call('POST', `/v1/delivery/orders/${outForDelivery}/accept`, riderA.token);
  await call('POST', `/v1/delivery/orders/${outForDelivery}/pickup`, riderA.token);
  await call('POST', `/v1/delivery/orders/${outForDelivery}/out-for-delivery`, riderA.token);

  // Split across two wholesalers: only Lamington has the camera, only Nashik the speaker.
  const split = await place(rC, [[10, 1], [11, 4]]);
  const { items: splitItems } = await call<{ items: { id: string; productName: string }[] }>('GET', `/v1/admin/orders/${split}`, admin);
  await call('POST', `/v1/admin/orders/${split}/forward`, admin, {
    assignments: splitItems.map((i) => ({ itemId: i.id, wholesalerId: i.productName.startsWith('Rear camera') ? wC.id : wB.id })),
  });
  const cameraPart = (await call<{ items: { id: string; status: string }[] }>('GET', '/v1/wholesaler/orders', wC.token)).items.find(
    (o) => o.status === 'forwarded',
  );
  if (cameraPart) {
    await call('POST', `/v1/wholesaler/orders/${cameraPart.id}/accept`, wC.token);
    await call('POST', `/v1/wholesaler/orders/${cameraPart.id}/pack`, wC.token);
  }

  const accepted = await place(rA, [[15, 20]]);
  await forward(accepted, wA);
  await call('POST', `/v1/wholesaler/orders/${accepted}/accept`, wA.token);

  // Handed back by a wholesaler: waiting for the admin to choose another.
  const handedBack = await place(rB, [[19, 30]]);
  await forward(handedBack, wB);
  await call('POST', `/v1/wholesaler/orders/${handedBack}/reject`, wB.token, { reason: 'Stock damaged in the godown' });

  await place(rB, [[4, 5], [20, 25]]); // new, waiting for the admin
  const forwarded = await place(rC, [[12, 10]]);
  await forward(forwarded, wA); // waiting for the wholesaler to accept

  const cancelled = await place(rA, [[5, 1]]);
  await call('POST', `/v1/admin/orders/${cancelled}/cancel`, admin, { reason: 'Retailer asked to cancel: ordered the wrong model.' });
  INFO('12 orders: 4 delivered, 1 out for delivery, 1 split (packed + forwarded), 1 accepted, 1 forwarded, 2 waiting for the admin (one handed back), 1 cancelled');

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
