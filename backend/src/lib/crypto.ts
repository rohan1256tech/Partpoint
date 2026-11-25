import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Keyed hash for OTPs and refresh tokens: a DB leak alone does not reveal or allow guessing them. */
export function hmac(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Uniformly random 6-digit code (CSPRNG). */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
