import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, SecretBox, verifyTotp } from '../src/lib/totp.js';

// RFC 6238 Appendix B, SHA-1 seed "12345678901234567890".
const SEED = Buffer.from('12345678901234567890');

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, expected] of vectors) {
      expect(hotp(SEED, Math.floor(seconds / 30), 8)).toBe(expected);
    }
  });

  it('accepts codes one step either side, and never the same step twice', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = hotp(SEED, step);
    expect(verifyTotp(SEED, code, null, now)).toBe(step);
    expect(verifyTotp(SEED, code, step, now)).toBeNull(); // replay
    expect(verifyTotp(SEED, hotp(SEED, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(SEED, hotp(SEED, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(SEED, hotp(SEED, step - 2), null, now)).toBeNull();
    expect(verifyTotp(SEED, '12345', null, now)).toBeNull();
  });

  it('round-trips base32 and builds an authenticator URI', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI'); // RFC 4648
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(otpauthUri(SEED, 'ops@example.in')).toBe(
      'otpauth://totp/Partpoint%20Admin%3Aops%40example.in?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Partpoint+Admin&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('encrypts secrets at rest', () => {
    const box = new SecretBox('server-secret-for-tests-0000000000');
    const sealed = box.seal(SEED);
    expect(sealed).not.toContain(SEED.toString('base64url'));
    expect(box.open(sealed).equals(SEED)).toBe(true);
    expect(() => new SecretBox('another-server-secret-00000000000000').open(sealed)).toThrow();
  });
});
