import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { safeEqual } from './crypto.js';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s): what Google Authenticator and similar apps use. */
export const TOTP_PERIOD_S = 30;
const DIGITS = 6;
/** Accept the previous and next code too, for clock drift between phone and server. */
const WINDOW = 1;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226) for a time step. `digits` is configurable only for the RFC test vectors. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const offset = (h[h.length - 1] as number) & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

export const timeStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_PERIOD_S);

/**
 * Returns the matched time step, or null. Steps at or before `lastUsedStep` are refused,
 * so a code cannot be replayed even within its validity window.
 */
export function verifyTotp(secret: Buffer, code: string, lastUsedStep: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = timeStep(now);
  for (let s = current - WINDOW; s <= current + WINDOW; s++) {
    if (lastUsedStep !== null && s <= lastUsedStep) continue;
    if (safeEqual(hotp(secret, s), code)) return s;
  }
  return null;
}

export function newTotpSecret(): Buffer {
  return randomBytes(20); // 160 bits, as RFC 4226 recommends
}

export function otpauthUri(secret: Buffer, account: string, issuer = 'Partpoint Admin'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Encrypts TOTP secrets at rest (AES-256-GCM, key derived from a server secret). */
export class SecretBox {
  private readonly key: Buffer;

  constructor(serverSecret: string) {
    this.key = Buffer.from(hkdfSync('sha256', serverSecret, 'partpoint', 'totp-secret-v1', 32));
  }

  seal(plain: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
  }

  open(sealed: string): Buffer {
    const [iv, tag, ct] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    if (!iv || !tag || !ct) throw new Error('malformed sealed secret');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}
