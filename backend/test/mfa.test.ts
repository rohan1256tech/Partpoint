import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/password.js';
import { base32Decode, hotp, timeStep } from '../src/lib/totp.js';
import { createTestApp, resetDb, type TestContext } from './helpers.js';

let t: TestContext;
beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  await t.db.insert(users).values({
    role: 'admin',
    status: 'approved',
    name: 'Ops',
    email: 'ops@partpoint.test',
    passwordHash: await hashPassword('correct-horse-battery'),
    emailVerifiedAt: new Date(),
  });
});
afterEach(async () => {
  await t.close();
});

const call = (method: 'GET' | 'POST', url: string, token?: string, payload?: object) =>
  t.app.inject({ method, url, ...(payload ? { payload } : {}), ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
const login = () =>
  call('POST', '/v1/auth/login/email', undefined, {
    email: 'ops@partpoint.test',
    password: 'correct-horse-battery',
    app: 'admin',
    deviceId: 'admin-browser-1',
  });

/** Sets 2FA up on a fresh admin and returns the secret and the (now verified) session. */
async function enrol() {
  const first = (await login()).json();
  const token = first.tokens.accessToken as string;
  const setup = (await call('POST', '/v1/admin/2fa/setup', token)).json();
  const secret = base32Decode(setup.secret);
  expect((await call('POST', '/v1/admin/2fa/enable', token, { code: hotp(secret, timeStep()) })).statusCode).toBe(204);
  return { secret, token, refreshToken: first.tokens.refreshToken as string };
}

describe('admin two-factor authentication', () => {
  it('keeps an admin without 2FA out of everything except the setup', async () => {
    const res = (await login()).json();
    expect(res.tokens).toBeDefined();
    const token = res.tokens.accessToken;

    const blocked = await call('GET', '/v1/admin/users', token);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('MFA_REQUIRED');
    expect((await call('GET', '/v1/admin/2fa', token)).json()).toEqual({ enabled: false });

    const setup = (await call('POST', '/v1/admin/2fa/setup', token)).json();
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/Partpoint%20Admin%3Aops%40partpoint\.test\?secret=/);

    const secret = base32Decode(setup.secret);
    const wrong = hotp(secret, timeStep() + 10);
    expect((await call('POST', '/v1/admin/2fa/enable', token, { code: wrong })).json().code).toBe('TOTP_INVALID');
    expect((await call('POST', '/v1/admin/2fa/enable', token, { code: hotp(secret, timeStep()) })).statusCode).toBe(204);

    // The session that set 2FA up counts as verified.
    expect((await call('GET', '/v1/admin/users', token)).statusCode).toBe(200);
    expect((await call('POST', '/v1/admin/2fa/setup', token)).json().code).toBe('MFA_ALREADY_ENABLED');
  });

  it('asks for a code at every later sign-in and refuses a replayed code', async () => {
    const { secret } = await enrol();

    const step1 = (await login()).json();
    expect(step1).toEqual({ status: 'totp_required', challengeToken: expect.any(String) });
    const bad = await call('POST', '/v1/auth/login/totp', undefined, {
      challengeToken: step1.challengeToken,
      code: hotp(secret, timeStep() + 10),
      deviceId: 'admin-browser-2',
    });
    expect(bad.statusCode).toBe(401);

    // The code used during setup was for the current step, so wait for the next by using step + 1 (within the window).
    const code = hotp(secret, timeStep() + 1);
    const ok = await call('POST', '/v1/auth/login/totp', undefined, {
      challengeToken: step1.challengeToken,
      code,
      deviceId: 'admin-browser-2',
    });
    expect(ok.statusCode).toBe(200);
    expect((await call('GET', '/v1/admin/users', ok.json().tokens.accessToken)).statusCode).toBe(200);

    const step2 = (await login()).json();
    const replay = await call('POST', '/v1/auth/login/totp', undefined, {
      challengeToken: step2.challengeToken,
      code,
      deviceId: 'admin-browser-3',
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('TOTP_INVALID');
  });

  it('does not accept a challenge as an access token, or the other way round', async () => {
    const { secret, token: accessToken } = await enrol();
    const { challengeToken } = (await login()).json();
    expect((await call('GET', '/v1/admin/users', challengeToken)).statusCode).toBe(401);

    const misuse = await call('POST', '/v1/auth/login/totp', undefined, {
      challengeToken: accessToken,
      code: hotp(secret, timeStep() + 1),
      deviceId: 'admin-browser-4',
    });
    expect(misuse.statusCode).toBe(401);
    expect(misuse.json().code).toBe('INVALID_TOKEN');
  });

  it('keeps 2FA verification across token refresh', async () => {
    const { refreshToken } = await enrol();
    const refreshed = (await call('POST', '/v1/auth/token/refresh', undefined, { refreshToken, deviceId: 'admin-browser-1' })).json();
    expect((await call('GET', '/v1/admin/users', refreshed.accessToken)).statusCode).toBe(200);
  });
});
