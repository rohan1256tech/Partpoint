import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, otpCodes, users } from '../src/db/schema.js';
import { createTestApp, DEMO_OTP, DEMO_PHONE, resetDb, signIn, type TestContext } from './helpers.js';

let t: TestContext;

// A fresh app per test also resets the in-memory per-IP rate limits.
beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
});
afterEach(async () => {
  await t.close();
});

const post = (url: string, payload: unknown, token?: string) =>
  t.app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
const get = (url: string, token?: string) =>
  t.app.inject({ method: 'GET', url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });

const device = { app: 'partpoint', deviceId: 'device-aaaa-1111' } as const;
const retailerProfile = { role: 'retailer', shopName: 'Sharma Auto Parts' } as const;

/** Full phone signup; returns tokens and the user. */
async function signUpRetailer(phone = '9876543210', d: { app: string; deviceId: string } = device) {
  expect((await post('/v1/auth/otp/request', { phone })).statusCode).toBe(202);
  const code = t.messaging.lastCodeFor(`+91${phone.slice(-10)}`);
  const verify = await post('/v1/auth/otp/verify', { phone, code, ...d });
  expect(verify.json().status).toBe('registration_required');
  const res = await post('/v1/auth/register/phone', {
    registrationToken: verify.json().registrationToken,
    name: 'Ravi Sharma',
    consent: true,
    profile: retailerProfile,
    ...d,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as {
    user: { id: string; status: string };
    tokens: { accessToken: string; refreshToken: string };
  };
}

async function createAdmin() {
  return (await signIn(t, 'admin')).token;
}

describe('phone OTP signup and login', () => {
  it('signs up a new retailer as pending and lets them read their profile', async () => {
    const { user, tokens } = await signUpRetailer();
    expect(user.status).toBe('pending');

    const me = await get('/v1/me', tokens.accessToken);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      role: 'retailer',
      status: 'pending',
      phone: '+919876543210',
      profile: { shopName: 'Sharma Auto Parts' },
    });

    const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect(row?.consentAt).toBeInstanceOf(Date);
    expect(row?.phoneVerifiedAt).toBeInstanceOf(Date);
  });

  it('logs an existing user straight in', async () => {
    await signUpRetailer();
    await t.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) }); // skip resend cooldown
    await post('/v1/auth/otp/request', { phone: '+919876543210' });
    const code = t.messaging.lastCodeFor('+919876543210');
    const res = await post('/v1/auth/otp/verify', { phone: '9876543210', code, ...device });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('authenticated');
    expect(res.json().tokens.accessToken).toBeTypeOf('string');
  });

  it('stores only a hash of the code', async () => {
    await post('/v1/auth/otp/request', { phone: '9876543210' });
    const code = t.messaging.lastCodeFor('+919876543210');
    const [row] = await t.db.select().from(otpCodes);
    expect(row?.codeHash).not.toContain(code);
  });

  it('rejects a code after 5 wrong attempts, even the right one', async () => {
    await post('/v1/auth/otp/request', { phone: '9876543210' });
    const code = t.messaging.lastCodeFor('+919876543210');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await post('/v1/auth/otp/verify', { phone: '9876543210', code: wrong, ...device })).statusCode).toBe(400);
    }
    const res = await post('/v1/auth/otp/verify', { phone: '9876543210', code, ...device });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('OTP_ATTEMPTS_EXCEEDED');
  });

  it('accepts a code only once', async () => {
    await post('/v1/auth/otp/request', { phone: '9876543210' });
    const code = t.messaging.lastCodeFor('+919876543210');
    expect((await post('/v1/auth/otp/verify', { phone: '9876543210', code, ...device })).statusCode).toBe(200);
    const again = await post('/v1/auth/otp/verify', { phone: '9876543210', code, ...device });
    expect(again.statusCode).toBe(400);
    expect(again.json().code).toBe('OTP_INVALID');
  });

  it('rejects an expired code', async () => {
    await post('/v1/auth/otp/request', { phone: '9876543210' });
    const code = t.messaging.lastCodeFor('+919876543210');
    await t.db.update(otpCodes).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await post('/v1/auth/otp/verify', { phone: '9876543210', code, ...device })).statusCode).toBe(400);
  });

  it('enforces a resend cooldown and invalidates the previous code on resend', async () => {
    await post('/v1/auth/otp/request', { phone: '9876543210' });
    const first = t.messaging.lastCodeFor('+919876543210');
    const tooSoon = await post('/v1/auth/otp/request', { phone: '9876543210' });
    expect(tooSoon.statusCode).toBe(429);
    expect(tooSoon.json().code).toBe('OTP_COOLDOWN');

    await t.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) });
    await post('/v1/auth/otp/request', { phone: '9876543210' });
    const second = t.messaging.lastCodeFor('+919876543210');
    if (first !== second) {
      expect((await post('/v1/auth/otp/verify', { phone: '9876543210', code: first, ...device })).statusCode).toBe(400);
    }
    expect((await post('/v1/auth/otp/verify', { phone: '9876543210', code: second, ...device })).statusCode).toBe(200);
  });

  it('limits codes per phone per hour', async () => {
    for (let i = 0; i < 5; i++) {
      await t.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) });
      expect((await post('/v1/auth/otp/request', { phone: '9876543210' })).statusCode).toBe(202);
    }
    await t.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) });
    const res = await post('/v1/auth/otp/request', { phone: '9876543210' });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('OTP_LIMIT');
  });

  it('uses the fixed code for Play review demo phones and sends no SMS', async () => {
    expect((await post('/v1/auth/otp/request', { phone: DEMO_PHONE })).statusCode).toBe(202);
    expect(t.messaging.sent).toHaveLength(0);
    const res = await post('/v1/auth/otp/verify', { phone: DEMO_PHONE, code: DEMO_OTP, ...device });
    expect(res.statusCode).toBe(200);
  });

  it('rejects invalid input with field details', async () => {
    const res = await post('/v1/auth/otp/request', { phone: '12345' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'phone' }] });
  });

  it('requires privacy-policy consent', async () => {
    await post('/v1/auth/otp/request', { phone: '9876543210' });
    const code = t.messaging.lastCodeFor('+919876543210');
    const verify = await post('/v1/auth/otp/verify', { phone: '9876543210', code, ...device });
    const res = await post('/v1/auth/register/phone', {
      registrationToken: verify.json().registrationToken,
      name: 'Ravi',
      consent: false,
      profile: retailerProfile,
      ...device,
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a duplicate phone registration', async () => {
    await signUpRetailer();
    const registrationToken = await (async () => {
      await t.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) });
      // A stale registration token for the same phone (e.g. a second device mid-signup).
      const { TokenSigner } = await import('../src/modules/auth/tokens.js');
      return new TokenSigner('test-jwt-secret-000000000000000000000000', 900).signRegistration('+919876543210');
    })();
    const res = await post('/v1/auth/register/phone', {
      registrationToken,
      name: 'Imposter',
      consent: true,
      profile: retailerProfile,
      ...device,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ACCOUNT_EXISTS');
  });

  it('keeps each role in its own app', async () => {
    await post('/v1/auth/otp/request', { phone: '9876543210' });
    const code = t.messaging.lastCodeFor('+919876543210');
    const verify = await post('/v1/auth/otp/verify', { phone: '9876543210', code, ...device });
    // A delivery partner cannot be created from the retail app.
    const res = await post('/v1/auth/register/phone', {
      registrationToken: verify.json().registrationToken,
      name: 'Rider',
      consent: true,
      profile: { role: 'delivery' },
      ...device,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('WRONG_APP');

    // An existing retailer cannot sign in to the delivery app.
    await signUpRetailer('9876500000');
    await t.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) });
    await post('/v1/auth/otp/request', { phone: '9876500000' });
    const c2 = t.messaging.lastCodeFor('+919876500000');
    const wrongApp = await post('/v1/auth/otp/verify', {
      phone: '9876500000',
      code: c2,
      app: 'delivery',
      deviceId: 'rider-device-1',
    });
    expect(wrongApp.statusCode).toBe(403);
    expect(wrongApp.json().code).toBe('WRONG_APP');
  });
});

describe('email + password', () => {
  const wholesaler = {
    email: 'Owner@Bharat-Spares.test',
    password: 'spares-2026-secure',
    name: 'Anil Mehta',
    consent: true,
    profile: {
      role: 'wholesaler',
      businessName: 'Bharat Spares',
      gstin: '27aapfu0939f1zv',
      addressLine: 'Plot 12, MIDC',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411019',
    },
    ...device,
  };
  const email = 'owner@bharat-spares.test';

  it('requires email verification before login, then signs in', async () => {
    const reg = await post('/v1/auth/register/email', wholesaler);
    expect(reg.statusCode).toBe(201);
    expect(reg.json()).toMatchObject({ emailVerificationRequired: true, user: { email, status: 'pending' } });

    const early = await post('/v1/auth/login/email', { email, password: wholesaler.password, ...device });
    expect(early.statusCode).toBe(403);
    expect(early.json().code).toBe('EMAIL_NOT_VERIFIED');

    const verified = await post('/v1/auth/email/verify', { email, code: t.messaging.lastCodeFor(email), ...device });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().user.emailVerified).toBe(true);

    const login = await post('/v1/auth/login/email', { email: 'OWNER@bharat-spares.test', password: wholesaler.password, ...device });
    expect(login.statusCode).toBe(200);

    const me = await get('/v1/me', login.json().tokens.accessToken);
    expect(me.json().profile).toMatchObject({ businessName: 'Bharat Spares', gstin: '27AAPFU0939F1ZV' });
  });

  it('stores passwords with Argon2id', async () => {
    await post('/v1/auth/register/email', wholesaler);
    const [row] = await t.db.select().from(users).where(eq(users.email, email));
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await post('/v1/auth/register/email', wholesaler);
    await post('/v1/auth/email/verify', { email, code: t.messaging.lastCodeFor(email), ...device });

    const wrong = await post('/v1/auth/login/email', { email, password: 'nope-nope-nope', ...device });
    const unknown = await post('/v1/auth/login/email', { email: 'ghost@x.test', password: 'nope-nope-nope', ...device });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('does not reveal whether an email exists on forgot-password', async () => {
    const res = await post('/v1/auth/password/forgot', { email: 'ghost@x.test' });
    expect(res.statusCode).toBe(202);
    expect(t.messaging.sent).toHaveLength(0);
  });

  it('resets the password and signs out every session', async () => {
    await post('/v1/auth/register/email', wholesaler);
    const v = await post('/v1/auth/email/verify', { email, code: t.messaging.lastCodeFor(email), ...device });
    const { accessToken, refreshToken } = v.json().tokens;

    expect((await post('/v1/auth/password/forgot', { email })).statusCode).toBe(202);
    const reset = await post('/v1/auth/password/reset', {
      email,
      code: t.messaging.lastCodeFor(email),
      newPassword: 'brand-new-password-1',
    });
    expect(reset.statusCode).toBe(204);

    expect((await get('/v1/me', accessToken)).statusCode).toBe(401);
    expect((await post('/v1/auth/token/refresh', { refreshToken, deviceId: device.deviceId })).statusCode).toBe(401);
    expect((await post('/v1/auth/login/email', { email, password: wholesaler.password, ...device })).statusCode).toBe(401);
    expect(
      (await post('/v1/auth/login/email', { email, password: 'brand-new-password-1', ...device })).statusCode,
    ).toBe(200);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens', async () => {
    const { tokens } = await signUpRetailer();
    const res = await post('/v1/auth/token/refresh', { refreshToken: tokens.refreshToken, deviceId: device.deviceId });
    expect(res.statusCode).toBe(200);
    expect(res.json().refreshToken).not.toBe(tokens.refreshToken);
    expect((await get('/v1/me', res.json().accessToken)).statusCode).toBe(200);
  });

  it('treats reuse of a rotated refresh token as theft and ends all sessions', async () => {
    const { tokens } = await signUpRetailer();
    const rotated = (
      await post('/v1/auth/token/refresh', { refreshToken: tokens.refreshToken, deviceId: device.deviceId })
    ).json();

    const replay = await post('/v1/auth/token/refresh', { refreshToken: tokens.refreshToken, deviceId: device.deviceId });
    expect(replay.statusCode).toBe(401);

    // The legitimate, newer token is now dead too.
    expect(
      (await post('/v1/auth/token/refresh', { refreshToken: rotated.refreshToken, deviceId: device.deviceId })).statusCode,
    ).toBe(401);
    expect((await get('/v1/me', rotated.accessToken)).statusCode).toBe(401);

    const logs = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'session.refresh_reuse'));
    expect(logs).toHaveLength(1);
  });

  it('binds refresh tokens to the device', async () => {
    const { tokens } = await signUpRetailer();
    const res = await post('/v1/auth/token/refresh', { refreshToken: tokens.refreshToken, deviceId: 'other-device-999' });
    expect(res.statusCode).toBe(401);
  });

  it('logs out', async () => {
    const { tokens } = await signUpRetailer();
    expect((await post('/v1/auth/logout', { refreshToken: tokens.refreshToken })).statusCode).toBe(204);
    expect(
      (await post('/v1/auth/token/refresh', { refreshToken: tokens.refreshToken, deviceId: device.deviceId })).statusCode,
    ).toBe(401);
  });

  it('rejects missing and forged access tokens', async () => {
    expect((await get('/v1/me')).statusCode).toBe(401);
    expect((await get('/v1/me', 'not.a.jwt')).statusCode).toBe(401);
  });
});

describe('admin approval', () => {
  it('lists pending users and approves one, with an audit entry', async () => {
    const { user } = await signUpRetailer();
    const admin = await createAdmin();

    const list = await get('/v1/admin/users?status=pending', admin);
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((u: { id: string }) => u.id)).toEqual([user.id]);
    expect(list.json().items[0].businessName).toEqual(expect.any(String));

    // Search matches the shop name, case-insensitively; % and _ are literal.
    const shop = list.json().items[0].businessName as string;
    const found = await get(`/v1/admin/users?q=${encodeURIComponent(shop.slice(0, 4).toLowerCase())}`, admin);
    expect(found.json().items.map((u: { id: string }) => u.id)).toEqual([user.id]);
    expect((await get('/v1/admin/users?q=%25%25', admin)).json().items).toEqual([]);


    const res = await post(`/v1/admin/users/${user.id}/approve`, {}, admin);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('approved');

    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'user.approve'));
    expect(log?.entityId).toBe(user.id);
  });

  it('blocking takes effect immediately on live access and refresh tokens', async () => {
    const { user, tokens } = await signUpRetailer();
    const admin = await createAdmin();
    await post(`/v1/admin/users/${user.id}/approve`, {}, admin);
    expect((await get('/v1/me', tokens.accessToken)).statusCode).toBe(200);

    const block = await post(`/v1/admin/users/${user.id}/block`, { reason: 'Fake GSTIN' }, admin);
    expect(block.statusCode).toBe(200);
    expect(block.json()).toMatchObject({ status: 'blocked', statusReason: 'Fake GSTIN' });

    expect((await get('/v1/me', tokens.accessToken)).statusCode).toBe(401);
    expect(
      (await post('/v1/auth/token/refresh', { refreshToken: tokens.refreshToken, deviceId: device.deviceId })).statusCode,
    ).toBe(401);

    // And they cannot sign in again.
    await t.db.update(otpCodes).set({ createdAt: new Date(Date.now() - 60_000) });
    await post('/v1/auth/otp/request', { phone: '9876543210' });
    const login = await post('/v1/auth/otp/verify', {
      phone: '9876543210',
      code: t.messaging.lastCodeFor('+919876543210'),
      ...device,
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().code).toBe('ACCOUNT_BLOCKED');

    // Unblocking restores access.
    expect((await post(`/v1/admin/users/${user.id}/approve`, {}, admin)).json().status).toBe('approved');
  });

  it('requires a reason to block', async () => {
    const { user } = await signUpRetailer();
    const admin = await createAdmin();
    expect((await post(`/v1/admin/users/${user.id}/block`, {}, admin)).statusCode).toBe(400);
  });

  it('is closed to non-admins and to pending users', async () => {
    const { user, tokens } = await signUpRetailer();
    const pending = await get('/v1/admin/users', tokens.accessToken);
    expect(pending.statusCode).toBe(403);
    expect(pending.json().code).toBe('ACCOUNT_PENDING');

    const admin = await createAdmin();
    await post(`/v1/admin/users/${user.id}/approve`, {}, admin);
    expect((await get('/v1/admin/users', tokens.accessToken)).statusCode).toBe(403);
  });

  it('cannot act on admin accounts', async () => {
    const admin = await createAdmin();
    const [row] = await t.db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
    expect((await post(`/v1/admin/users/${row?.id}/block`, { reason: 'x' }, admin)).statusCode).toBe(404);
  });

  it('paginates with a cursor', async () => {
    for (const p of ['9876500001', '9876500002', '9876500003']) await signUpRetailer(p);
    const admin = await createAdmin();
    const page1 = (await get('/v1/admin/users?limit=2', admin)).json();
    expect(page1.items).toHaveLength(2);
    const page2 = (await get(`/v1/admin/users?limit=2&cursor=${page1.nextCursor}`, admin)).json();
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    const ids = [...page1.items, ...page2.items].map((u: { id: string }) => u.id);
    expect(new Set(ids).size).toBe(3);
  });
});
