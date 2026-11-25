import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { unauthorized } from '../../lib/errors.js';

export type Role = 'admin' | 'wholesaler' | 'retailer' | 'delivery';
export type ClientApp = 'partpoint' | 'delivery' | 'admin';

/** Which roles may sign in to which app. Delivery code never ships in the retail app and vice versa. */
export const APP_ROLES: Record<ClientApp, readonly Role[]> = {
  partpoint: ['retailer', 'wholesaler'],
  delivery: ['delivery'],
  admin: ['admin'],
};

const ISSUER = 'partpoint';
const ACCESS_AUD = 'partpoint-api';
const REGISTRATION_AUD = 'partpoint-registration';
const MFA_AUD = 'partpoint-mfa';

export interface AccessClaims {
  sub: string;
  role: Role;
  app: ClientApp;
  sid: string;
}

export class TokenSigner {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly accessTtlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  get accessTtl(): number {
    return this.accessTtlSeconds;
  }

  signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ role: claims.role, app: claims.app, sid: claims.sid, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    const payload = await this.verify(token, ACCESS_AUD, 'access');
    const { sub, role, app, sid } = payload;
    if (typeof sub !== 'string' || typeof role !== 'string' || typeof app !== 'string' || typeof sid !== 'string') {
      throw unauthorized('INVALID_TOKEN', 'Invalid access token');
    }
    return { sub, role: role as Role, app: app as ClientApp, sid };
  }

  /** Proof that a phone number passed OTP verification; lets an unknown number finish signing up. */
  signRegistration(phone: string): Promise<string> {
    return new SignJWT({ phone, typ: 'registration' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(REGISTRATION_AUD)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(this.key);
  }

  async verifyRegistration(token: string): Promise<{ phone: string }> {
    const payload = await this.verify(token, REGISTRATION_AUD, 'registration');
    if (typeof payload.phone !== 'string') throw unauthorized('INVALID_TOKEN', 'Invalid registration token');
    return { phone: payload.phone };
  }

  /** Proof that an admin passed the password step; exchanged with a TOTP code for a session. */
  signMfaChallenge(userId: string): Promise<string> {
    return new SignJWT({ typ: 'mfa' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(MFA_AUD)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.key);
  }

  async verifyMfaChallenge(token: string): Promise<{ userId: string }> {
    const payload = await this.verify(token, MFA_AUD, 'mfa');
    if (typeof payload.sub !== 'string') throw unauthorized('INVALID_TOKEN', 'Invalid sign-in challenge');
    return { userId: payload.sub };
  }

  private async verify(token: string, audience: string, typ: string) {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience, algorithms: ['HS256'] });
      if (payload.typ !== typ) throw unauthorized('INVALID_TOKEN', 'Invalid token');
      return payload;
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw unauthorized('TOKEN_EXPIRED', 'Token expired');
      throw unauthorized('INVALID_TOKEN', 'Invalid token');
    }
  }
}
