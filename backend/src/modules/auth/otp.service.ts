import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { otpCodes } from '../../db/schema.js';
import { generateOtp, hmac, safeEqual } from '../../lib/crypto.js';
import { badRequest, tooManyRequests } from '../../lib/errors.js';

export type OtpChannel = 'sms' | 'email';
export type OtpPurpose = 'login' | 'signup' | 'reset_password' | 'verify_email';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
export const OTP_MAX_PER_HOUR = 5;

export interface OtpConfig {
  secret: string;
  /** Targets that always use `demoCode` and are never messaged (Play review accounts). */
  demoTargets: ReadonlySet<string>;
  demoCode?: string;
}

interface IssueInput {
  channel: OtpChannel;
  target: string;
  purpose: OtpPurpose;
  ip?: string;
}

export class OtpService {
  constructor(
    private readonly db: Database,
    private readonly config: OtpConfig,
  ) {}

  private hash(target: string, purpose: OtpPurpose, code: string): string {
    // Binding target + purpose into the hash means a code can never be replayed for another use.
    return hmac(this.config.secret, `${purpose}:${target}:${code}`);
  }

  isDemo(target: string): boolean {
    return this.config.demoTargets.has(target) && !!this.config.demoCode;
  }

  /**
   * Creates a new code (invalidating earlier unused ones) and returns it so the caller can deliver it.
   * Returns `null` for demo targets, which must not be messaged.
   */
  async issue({ channel, target, purpose, ip }: IssueInput): Promise<string | null> {
    const now = Date.now();
    const recent = await this.db
      .select({ createdAt: otpCodes.createdAt })
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.target, target),
          eq(otpCodes.purpose, purpose),
          gt(otpCodes.createdAt, new Date(now - 60 * 60 * 1000)),
        ),
      )
      .orderBy(desc(otpCodes.createdAt));

    const latest = recent[0];
    if (latest && now - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw tooManyRequests('OTP_COOLDOWN', 'Please wait before requesting another code');
    }
    if (recent.length >= OTP_MAX_PER_HOUR) {
      throw tooManyRequests('OTP_LIMIT', 'Too many codes requested. Try again later');
    }

    const demo = this.isDemo(target);
    const code = demo ? (this.config.demoCode as string) : generateOtp();

    await this.db.transaction(async (tx) => {
      await tx
        .update(otpCodes)
        .set({ consumedAt: new Date(now) })
        .where(and(eq(otpCodes.target, target), eq(otpCodes.purpose, purpose), isNull(otpCodes.consumedAt)));
      await tx.insert(otpCodes).values({
        channel,
        target,
        purpose,
        codeHash: this.hash(target, purpose, code),
        expiresAt: new Date(now + OTP_TTL_MS),
        ip: ip ?? null,
      });
    });

    return demo ? null : code;
  }

  /** Verifies and consumes a code. Throws a 400/429 on any failure. */
  async verify(target: string, purpose: OtpPurpose, code: string): Promise<void> {
    const invalid = () => badRequest('OTP_INVALID', 'Invalid or expired code');

    // Count the attempt first (atomically), so parallel guesses cannot exceed the limit.
    const [row] = await this.db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(
        eq(
          otpCodes.id,
          // Only the newest live code is valid.
          sql`(SELECT ${otpCodes.id} FROM ${otpCodes}
               WHERE ${otpCodes.target} = ${target} AND ${otpCodes.purpose} = ${purpose}
                 AND ${otpCodes.consumedAt} IS NULL AND ${otpCodes.expiresAt} > now()
               ORDER BY ${otpCodes.createdAt} DESC LIMIT 1)`,
        ),
      )
      .returning({ id: otpCodes.id, codeHash: otpCodes.codeHash, attempts: otpCodes.attempts });

    if (!row) throw invalid();
    if (row.attempts > OTP_MAX_ATTEMPTS) {
      await this.db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id));
      throw tooManyRequests('OTP_ATTEMPTS_EXCEEDED', 'Too many attempts. Request a new code');
    }
    if (!safeEqual(row.codeHash, this.hash(target, purpose, code))) throw invalid();

    // Single use: only one concurrent request can consume it.
    const consumed = await this.db
      .update(otpCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpCodes.id, row.id), isNull(otpCodes.consumedAt)))
      .returning({ id: otpCodes.id });
    if (consumed.length === 0) throw invalid();
  }
}
