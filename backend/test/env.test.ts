import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
  REFRESH_TOKEN_SECRET: 'b'.repeat(32),
  OTP_SECRET: 'c'.repeat(32),
};

describe('loadEnv', () => {
  it('treats blank values as unset', () => {
    const env = loadEnv({ ...base, DEMO_OTP: '', DEMO_PHONES: '', SMS_API_KEY: '', PORT: '' });
    expect(env.DEMO_OTP).toBeUndefined();
    expect(env.DEMO_PHONES).toEqual([]);
    expect(env.PORT).toBe(3000);
  });

  it('rejects short or reused secrets', () => {
    expect(() => loadEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ ...base, OTP_SECRET: base.JWT_SECRET })).toThrow(/different/);
  });

  it('requires a demo code when demo phones are configured', () => {
    expect(() => loadEnv({ ...base, DEMO_PHONES: '+919000000001' })).toThrow(/DEMO_OTP/);
  });

  it('refuses placeholder secrets and missing providers in production', () => {
    const prod = { ...base, NODE_ENV: 'production', JWT_SECRET: 'replace-me-local-jwt-secret-0000000000000000' };
    const message = (() => {
      try {
        loadEnv(prod);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(message).toMatch(/JWT_SECRET: placeholder/);
    expect(message).toMatch(/SMS_API_KEY: required in production/);
    // The public privacy policy must name the business and a grievance contact.
    expect(message).toMatch(/LEGAL_NAME: required in production/);
    expect(message).toMatch(/PRIVACY_EMAIL: required in production/);
  });
});
