import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import type { Database } from '../../db/index.js';
import { deliveryProfiles, retailerProfiles, users, wholesalerProfiles } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { AppError, conflict, forbidden, unauthorized } from '../../lib/errors.js';
import type { Messaging } from '../../lib/messaging.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/password.js';
import type {
  emailLoginBody,
  emailVerifyBody,
  otpVerifyBody,
  passwordResetBody,
  ProfileInput,
  registerEmailBody,
  registerPhoneBody,
} from './auth.schemas.js';
import type { OtpService } from './otp.service.js';
import type { SessionContext, SessionService, TokenPair } from './session.service.js';
import { APP_ROLES, type ClientApp, type Role, type TokenSigner } from './tokens.js';

type UserRow = typeof users.$inferSelect;

export interface PublicUser {
  id: string;
  role: Role;
  status: 'pending' | 'approved' | 'blocked';
  name: string;
  phone: string | null;
  email: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    role: u.role,
    status: u.status,
    name: u.name,
    phone: u.phone,
    email: u.email,
    emailVerified: u.emailVerifiedAt !== null,
    createdAt: u.createdAt.toISOString(),
  };
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export type OtpLoginResult =
  | { status: 'authenticated'; user: PublicUser; tokens: TokenPair }
  | { status: 'registration_required'; registrationToken: string };

function assertRoleAllowedInApp(role: Role, app: ClientApp): void {
  if (!APP_ROLES[app].includes(role)) {
    throw forbidden('WRONG_APP', 'This account cannot sign in to this app');
  }
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly signer: TokenSigner,
    private readonly messaging: Messaging,
    private readonly consentVersion: string,
    private readonly log: FastifyBaseLogger,
  ) {}

  // ---------------------------------------------------------------- phone OTP

  async requestPhoneOtp(phone: string, meta: RequestMeta): Promise<void> {
    const code = await this.otp.issue({ channel: 'sms', target: phone, purpose: 'login', ...ip(meta) });
    if (code) await this.deliver(() => this.messaging.sms.sendOtp(phone, code));
  }

  async verifyPhoneOtp(input: z.infer<typeof otpVerifyBody>, meta: RequestMeta): Promise<OtpLoginResult> {
    await this.otp.verify(input.phone, 'login', input.code);

    const user = await this.findActiveBy('phone', input.phone);
    if (!user) {
      return { status: 'registration_required', registrationToken: await this.signer.signRegistration(input.phone) };
    }
    this.assertCanSignIn(user, input.app);
    if (!user.phoneVerifiedAt) {
      await this.db.update(users).set({ phoneVerifiedAt: new Date() }).where(eq(users.id, user.id));
    }
    const tokens = await this.sessions.create(user, ctx(input, meta));
    return { status: 'authenticated', user: toPublicUser(user), tokens };
  }

  async registerWithPhone(
    input: z.infer<typeof registerPhoneBody>,
    meta: RequestMeta,
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const { phone } = await this.signer.verifyRegistration(input.registrationToken);
    assertRoleAllowedInApp(input.profile.role, input.app);

    const user = await this.createUser({
      name: input.name,
      phone,
      email: input.email ?? null,
      passwordHash: null,
      phoneVerifiedAt: new Date(),
      profile: input.profile,
    });
    const tokens = await this.sessions.create(user, ctx(input, meta));
    return { user: toPublicUser(user), tokens };
  }

  // ---------------------------------------------------------------- email + password

  async registerWithEmail(input: z.infer<typeof registerEmailBody>, meta: RequestMeta): Promise<PublicUser> {
    assertRoleAllowedInApp(input.profile.role, input.app);
    const user = await this.createUser({
      name: input.name,
      phone: input.phone ?? null,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      phoneVerifiedAt: null,
      profile: input.profile,
    });
    await this.sendEmailCode(user.email as string, 'verify_email', meta);
    return toPublicUser(user);
  }

  /** Always succeeds from the caller's view, so it cannot be used to discover accounts. */
  async requestEmailVerification(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.findActiveBy('email', email);
    if (!user || user.emailVerifiedAt) return;
    await this.sendEmailCode(email, 'verify_email', meta, { silentRateLimit: true });
  }

  async verifyEmail(
    input: z.infer<typeof emailVerifyBody>,
    meta: RequestMeta,
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    await this.otp.verify(input.email, 'verify_email', input.code);
    const user = await this.findActiveBy('email', input.email);
    if (!user) throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');

    const [verified] = await this.db
      .update(users)
      .set({ emailVerifiedAt: user.emailVerifiedAt ?? new Date() })
      .where(eq(users.id, user.id))
      .returning();
    const fresh = verified ?? user;
    this.assertCanSignIn(fresh, input.app);
    const tokens = await this.sessions.create(fresh, ctx(input, meta));
    return { user: toPublicUser(fresh), tokens };
  }

  async loginWithEmail(
    input: z.infer<typeof emailLoginBody>,
    meta: RequestMeta,
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const user = await this.findActiveBy('email', input.email);
    if (!user?.passwordHash) {
      await burnPasswordCheck(input.password);
      throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (!user.emailVerifiedAt) throw forbidden('EMAIL_NOT_VERIFIED', 'Verify your email address to continue');
    this.assertCanSignIn(user, input.app);
    const tokens = await this.sessions.create(user, ctx(input, meta));
    return { user: toPublicUser(user), tokens };
  }

  /** Always succeeds from the caller's view, so it cannot be used to discover accounts. */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.findActiveBy('email', email);
    if (!user || user.status === 'blocked') return;
    await this.sendEmailCode(email, 'reset_password', meta, { silentRateLimit: true });
  }

  async resetPassword(input: z.infer<typeof passwordResetBody>, meta: RequestMeta): Promise<void> {
    await this.otp.verify(input.email, 'reset_password', input.code);
    const user = await this.findActiveBy('email', input.email);
    if (!user) throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');

    const passwordHash = await hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        // Receiving the code proves control of the inbox.
        .set({ passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() })
        .where(eq(users.id, user.id));
      await this.sessions.revokeAllForUser(user.id, tx);
      await audit(tx, { actorId: user.id, action: 'user.password_reset', entity: 'user', entityId: user.id, ...ip(meta) });
    });
  }

  // ---------------------------------------------------------------- sessions

  refresh(refreshToken: string, deviceId: string, meta: RequestMeta): Promise<TokenPair> {
    return this.sessions.rotate(refreshToken, deviceId, meta.ip);
  }

  logout(refreshToken: string): Promise<void> {
    return this.sessions.revokeByToken(refreshToken);
  }

  // ---------------------------------------------------------------- helpers

  private assertCanSignIn(user: UserRow, app: ClientApp): void {
    if (user.status === 'blocked') throw forbidden('ACCOUNT_BLOCKED', 'This account has been blocked');
    assertRoleAllowedInApp(user.role, app);
  }

  private async findActiveBy(field: 'phone' | 'email', value: string): Promise<UserRow | undefined> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users[field], value), isNull(users.deletedAt)))
      .limit(1);
    return user;
  }

  private async createUser(input: {
    name: string;
    phone: string | null;
    email: string | null;
    passwordHash: string | null;
    phoneVerifiedAt: Date | null;
    profile: ProfileInput;
  }): Promise<UserRow> {
    const { profile } = input;
    try {
      return await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            role: profile.role,
            status: 'pending',
            name: input.name,
            phone: input.phone,
            email: input.email,
            passwordHash: input.passwordHash,
            phoneVerifiedAt: input.phoneVerifiedAt,
            consentAt: new Date(),
            consentVersion: this.consentVersion,
          })
          .returning();
        if (!user) throw new Error('user insert returned no row');

        switch (profile.role) {
          case 'retailer':
            await tx
              .insert(retailerProfiles)
              .values({ userId: user.id, shopName: profile.shopName, gstin: profile.gstin ?? null });
            break;
          case 'wholesaler':
            await tx.insert(wholesalerProfiles).values({
              userId: user.id,
              businessName: profile.businessName,
              gstin: profile.gstin ?? null,
              addressLine: profile.addressLine,
              city: profile.city,
              state: profile.state,
              pincode: profile.pincode,
            });
            break;
          case 'delivery':
            await tx.insert(deliveryProfiles).values({
              userId: user.id,
              vehicleType: profile.vehicleType ?? null,
              vehicleNumber: profile.vehicleNumber ?? null,
            });
            break;
        }
        return user;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('ACCOUNT_EXISTS', 'An account with this phone number or email already exists');
      }
      throw err;
    }
  }

  private async sendEmailCode(
    email: string,
    purpose: 'verify_email' | 'reset_password',
    meta: RequestMeta,
    opts: { silentRateLimit?: boolean } = {},
  ): Promise<void> {
    let code: string | null;
    try {
      code = await this.otp.issue({ channel: 'email', target: email, purpose, ...ip(meta) });
    } catch (err) {
      // For anti-enumeration endpoints a rate-limit response would reveal that the account exists.
      if (opts.silentRateLimit && err instanceof AppError && err.statusCode === 429) return;
      throw err;
    }
    if (!code) return;
    const otpCode = code;
    const subject = purpose === 'verify_email' ? 'Verify your Partpoint email' : 'Reset your Partpoint password';
    const body =
      `Your Partpoint code is ${otpCode}. It expires in 5 minutes.\n\n` +
      'If you did not request this, you can ignore this email.';
    await this.deliver(() => this.messaging.mail.send(email, subject, body));
  }

  private async deliver(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (err) {
      this.log.error({ err }, 'failed to deliver verification code');
      throw new AppError(503, 'DELIVERY_FAILED', 'Could not send the code. Please try again shortly');
    }
  }
}

const ip = (meta: RequestMeta) => (meta.ip ? { ip: meta.ip } : {});

function ctx(input: { app: ClientApp; deviceId: string }, meta: RequestMeta): SessionContext {
  return {
    app: input.app,
    deviceId: input.deviceId,
    ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
    ...(meta.ip ? { ip: meta.ip } : {}),
  };
}
