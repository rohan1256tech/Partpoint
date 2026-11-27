/**
 * End-to-end check of the whole business flow against a running API (default http://localhost),
 * as the real apps would use it: a retailer orders from Partpoint, the admin splits the order
 * across two wholesalers, one hands its part back and gets it again, both pack, a rider delivers
 * with the retailer's code, and invoices and payouts add up.
 *
 * Needs the demo data (pnpm db:seed:demo) and DEMO_PHONES/DEMO_OTP in .env. Creates a temporary
 * admin with 2FA for the admin steps and disables it at the end. Never run it in production.
 *
 *   pnpm exec tsx --env-file=.env scripts/flow-check.ts [baseUrl]
 */
import { eq } from 'drizzle-orm';
import { loadEnv } from '../src/config/env.js';
import { createDb } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/password.js';
import { hotp, newTotpSecret, SecretBox, timeStep } from '../src/lib/totp.js';

const BASE = process.argv[2] ?? 'http://localhost';
const env = loadEnv();
if (env.NODE_ENV === 'production') throw new Error('Not in production');
const OTP = env.DEMO_OTP ?? '123456';
const { db, pool } = createDb(env.DATABASE_URL, 1);

let failures = 0;
const ok = (cond: unknown, what: string) => {
  process.stdout.write(`${cond ? 'PASS' : 'FAIL'}  ${what}\n`);
  if (!cond) failures++;
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: string, path: string, token?: string, body?: object, expect = 200): Promise<Json> {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (res.status !== expect) throw new Error(`${method} ${path} → ${res.status} (wanted ${expect}): ${text.slice(0, 300)}`);
  if (!text) return {};
  return res.headers.get('content-type')?.includes('json') ? (JSON.parse(text) as Json) : { raw: text };
}

async function phoneLogin(phone: string, app: 'partpoint' | 'delivery') {
  // A recent run leaves a resend cooldown; the earlier code is still valid then.
  await call('POST', '/v1/auth/otp/request', undefined, { phone }, 202).catch((e: Error) => {
    if (!e.message.includes('OTP_COOLDOWN')) throw e;
  });
  const r = await call('POST', '/v1/auth/otp/verify', undefined, { phone, code: OTP, app, deviceId: `flow-check-${phone}` });
  return { token: r.tokens.accessToken as string, id: r.user.id as string };
}

const opsEmail = `flow-check-${Date.now()}@partpoint.local`;
const opsPassword = `flow-${newTotpSecret().toString('hex')}`;
const opsTotp = newTotpSecret();
let opsId: string | undefined;

try {
  // ---------------------------------------------------------------- people
  const [row] = await db
    .insert(users)
    .values({
      role: 'admin',
      status: 'approved',
      name: 'Flow check',
      email: opsEmail,
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(opsPassword),
      totpSecret: new SecretBox(env.OTP_SECRET).seal(opsTotp),
      totpEnabledAt: new Date(),
    })
    .returning({ id: users.id });
  opsId = row?.id;
  const step1 = await call('POST', '/v1/auth/login/email', undefined, { email: opsEmail, password: opsPassword, app: 'admin', deviceId: 'flow-check-admin' });
  const adminTok = (
    await call('POST', '/v1/auth/login/totp', undefined, { challengeToken: step1.challengeToken, code: hotp(opsTotp, timeStep()), deviceId: 'flow-check-admin' })
  ).tokens.accessToken as string;

  const retailer = await phoneLogin('+919000000203', 'partpoint'); // New India Mobile Point, Mumbai
  const nashik = await phoneLogin('+919000000102', 'partpoint'); // Nashik
  const lamington = await phoneLogin('+919000000103', 'partpoint'); // Mumbai
  const rider = await phoneLogin('+919000000301', 'delivery');
  ok(true, 'everyone signs in (admin with 2FA, others with the demo OTP)');

  // ---------------------------------------------------------------- retailer shops
  const browse = await call('GET', '/v1/products?limit=50', retailer.token);
  const all = JSON.stringify(browse);
  ok(!/Lamington|Shree Sai|Nashik Cell|supplyPrice|wholesaler/i.test(all), 'catalog shows no wholesaler names or supply prices');
  const find = (name: string) => browse.items.find((p: Json) => p.name.startsWith(name));
  const display = await call('GET', `/v1/products/${find('Display combo for Aero A15').id}`, retailer.token);
  const speaker = await call('GET', `/v1/products/${find('Loudspeaker for Zenith M34').id}`, retailer.token);
  const withFrame = display.variants.find((v: Json) => v.name === 'With frame');
  const speakerV = speaker.variants[0];
  ok(withFrame.stockQty > 0 && speakerV.stockQty > 0, `stock shown is the sum of offers (display ${withFrame.stockQty}, speaker ${speakerV.stockQty})`);

  await call('DELETE', '/v1/cart', retailer.token, undefined, 204);
  await call('PUT', `/v1/cart/items/${withFrame.id}`, retailer.token, { qty: 5 }); // 5+ bulk price
  const cart = await call('PUT', `/v1/cart/items/${speakerV.id}`, retailer.token, { qty: 3 });
  const displayLine = cart.lines.find((l: Json) => l.variantId === withFrame.id);
  ok(cart.lines.length === 2 && cart.groups === undefined, 'cart is one Partpoint list');
  ok(displayLine.unitPricePaise === 172_000, 'bulk price applies at 5 pieces (₹1,720)');
  const preview = await call('GET', '/v1/cart?couponCode=WELCOME10', retailer.token);
  ok(preview.coupon?.discountPaise === 20_000, 'WELCOME10 gives 10% capped at ₹200');

  const addresses = await call('GET', '/v1/me/addresses', retailer.token);
  const placed = await call('POST', '/v1/orders', retailer.token, { addressId: addresses.items[0].id, idempotencyKey: `flow-${Date.now()}`, couponCode: 'WELCOME10' }, 201);
  ok(placed.orders.length === 1 && placed.totalPaise === preview.totalPaise, `one order placed: ${placed.orders[0].orderNumber}, ${placed.totalPaise / 100} rupees`);
  const orderId = placed.orders[0].id as string;
  const mine0 = await call('GET', `/v1/orders/${orderId}`, retailer.token);
  ok(mine0.status === 'placed' && mine0.wholesaler === null, 'retailer sees "placed", no wholesaler');
  ok((await call('GET', '/v1/wholesaler/orders', lamington.token)).items.every((o: Json) => o.id !== orderId), 'no wholesaler sees it before the admin forwards it');

  // ---------------------------------------------------------------- admin chooses
  const queue = await call('GET', '/v1/admin/orders?status=placed', adminTok);
  ok(queue.items.some((o: Json) => o.id === orderId), 'the order is in the admin queue (Needs wholesaler)');
  const options = await call('GET', `/v1/admin/orders/${orderId}/suppliers`, adminTok);
  ok(options.suggestedWholesalerId === null, 'no single wholesaler has both items, so no whole-order suggestion');
  const dItem = options.items.find((i: Json) => i.productName.startsWith('Display'));
  const sItem = options.items.find((i: Json) => i.productName.startsWith('Loudspeaker'));
  ok(dItem.offers.some((o: Json) => o.wholesalerId === lamington.id) && sItem.offers.every((o: Json) => o.wholesalerId === nashik.id), 'options list who stocks each item');

  const fwd = await call('POST', `/v1/admin/orders/${orderId}/forward`, adminTok, {
    assignments: [
      { itemId: dItem.id, wholesalerId: lamington.id },
      { itemId: sItem.id, wholesalerId: nashik.id },
    ],
  });
  const part2Id = fwd.siblings[0]?.id as string;
  const part2 = await call('GET', `/v1/admin/orders/${part2Id}`, adminTok);
  ok(fwd.siblings.length === 1 && part2.orderNumber === `${fwd.orderNumber}-2`, `split into ${fwd.orderNumber} and ${part2.orderNumber}`);
  ok(fwd.totalPaise + part2.totalPaise === placed.totalPaise, 'the parts add up to what the retailer was charged');
  ok(fwd.commissionPaise === fwd.subtotalPaise - fwd.discountPaise - fwd.supplyTotalPaise, `margin on part 1: ${fwd.commissionPaise / 100} rupees`);

  const rList = await call('GET', '/v1/orders', retailer.token);
  const rParts = rList.items.filter((o: Json) => o.id === orderId || o.id === part2Id);
  ok(rParts.length === 2 && rParts.every((o: Json) => o.wholesaler === null), 'retailer sees two parcels, still without wholesaler names');

  // ---------------------------------------------------------------- wholesalers
  const nashikOrder = await call('GET', `/v1/wholesaler/orders/${part2Id}`, nashik.token);
  ok(nashikOrder.address.line1 === undefined && nashikOrder.supplyTotalPaise === 3 * 15_000, 'Nashik sees the area only, and is paid at its own supply price');
  await call('POST', `/v1/wholesaler/orders/${part2Id}/reject`, nashik.token, { reason: 'Flow check: hand back' });
  const back = await call('GET', `/v1/admin/orders/${part2Id}`, adminTok);
  ok(back.status === 'placed' && back.wholesaler === null, 'hand-back returns the part to the admin queue');
  const rBack = await call('GET', `/v1/orders/${part2Id}`, retailer.token);
  ok(!/hand back|Nashik/i.test(JSON.stringify(rBack)), 'the retailer never sees the hand-back');
  await call('POST', `/v1/admin/orders/${part2Id}/forward`, adminTok, { wholesalerId: nashik.id });

  for (const [id, w] of [
    [orderId, lamington],
    [part2Id, nashik],
  ] as const) {
    await call('POST', `/v1/wholesaler/orders/${id}/accept`, w.token);
    await call('POST', `/v1/wholesaler/orders/${id}/pack`, w.token);
  }
  const inv = await fetch(`${BASE}/v1/orders/${orderId}/invoice.pdf`, { headers: { authorization: `Bearer ${retailer.token}` } });
  ok(inv.status === 200 && inv.headers.get('content-type') === 'application/pdf', 'retailer can download the GST invoice once packed');
  const rTimeline = (await call('GET', `/v1/orders/${orderId}`, retailer.token)).timeline.map((e: Json) => e.status);
  ok(JSON.stringify(rTimeline) === JSON.stringify(['placed', 'accepted', 'packed']), `retailer timeline: ${rTimeline.join(' → ')}`);

  // ---------------------------------------------------------------- rider
  const earnBefore = (await call('GET', '/v1/delivery/earnings', rider.token)).totals ?? null;
  for (const id of [orderId, part2Id]) {
    await call('POST', `/v1/admin/orders/${id}/assign`, adminTok, { deliveryPartnerId: rider.id });
    await call('POST', `/v1/delivery/orders/${id}/accept`, rider.token);
    const job = await call('GET', `/v1/delivery/orders/${id}`, rider.token);
    ok(!!job.pickup?.addressLine && !!job.address?.line1, `rider sees pickup and drop addresses for ${job.orderNumber}`);
    await call('POST', `/v1/delivery/orders/${id}/pickup`, rider.token);
    await call('POST', `/v1/delivery/orders/${id}/out-for-delivery`, rider.token);
    const code = (await call('GET', `/v1/orders/${id}`, retailer.token)).deliveryOtp;
    ok(/^\d{4}$/.test(code ?? ''), 'retailer sees the 4-digit delivery code while it is on the way');
    await call('POST', `/v1/delivery/orders/${id}/deliver`, rider.token, { otp: code === '0000' ? '1111' : '0000' }, 400);
    const done = await call('POST', `/v1/delivery/orders/${id}/deliver`, rider.token, { otp: code });
    ok(done.status === 'delivered', `${done.orderNumber} delivered with the code (a wrong code is refused)`);
  }
  ok(earnBefore !== undefined, 'rider earnings readable');

  // ---------------------------------------------------------------- money
  const balances = await call('GET', '/v1/admin/finance/wholesalers', adminTok);
  const lam = balances.items.find((b: Json) => b.wholesalerId === lamington.id);
  ok(lam.owedPaise === lam.goodsPaise - lam.commissionPaise, 'wholesaler owed = goods − Partpoint margin = supply value');
  const myFinance = await call('GET', '/v1/wholesaler/finance', lamington.token);
  ok(myFinance.balance.owedPaise === lam.owedPaise, 'the wholesaler app shows the same balance as the admin');
  const dash = await call('GET', '/v1/admin/dashboard', adminTok);
  ok(typeof dash.sales.commissionThisMonthPaise === 'number', `dashboard margin this month: ${dash.sales.commissionThisMonthPaise / 100} rupees`);
} catch (err) {
  failures++;
  process.stdout.write(`FAIL  ${(err as Error).message}\n`);
} finally {
  if (opsId) await db.update(users).set({ passwordHash: null, totpSecret: null, totpEnabledAt: null, deletedAt: new Date() }).where(eq(users.id, opsId));
  await pool.end();
}
process.stdout.write(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
