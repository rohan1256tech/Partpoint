import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { sessions, users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { hmac, randomToken, safeEqual } from '../../lib/crypto.js';
import { unauthorized } from '../../lib/errors.js';
import type { ClientApp, Role, TokenSigner } from './tokens.js';

export interface SessionContext {
  app: ClientApp;
  deviceId: string;
  userAgent?: string;
  ip?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Refresh tokens look like `<sessionId>.<random>`. Only an HMAC of the token is stored.
 * Every refresh rotates the token; presenting an already-rotated token signals theft,
 * so all of that user's sessions are revoked.
 */
export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly signer: TokenSigner,
    private readonly refreshSecret: string,
    private readonly refreshTtlDays: number,
  ) {}

  private hash(token: string): string {
    return hmac(this.refreshSecret, token);
  }

  private expiry(): Date {
    return new Date(Date.now() + this.refreshTtlDays * DAY_MS);
  }

  async create(user: { id: string; role: Role }, ctx: SessionContext, opts: { mfa?: boolean } = {}): Promise<TokenPair> {
    const sessionId = crypto.randomUUID();
    const refreshToken = `${sessionId}.${randomToken()}`;
    await this.db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      app: ctx.app,
      deviceId: ctx.deviceId,
      tokenHash: this.hash(refreshToken),
      expiresAt: this.expiry(),
      lastUsedAt: new Date(),
      mfaAt: opts.mfa ? new Date() : null,
      userAgent: ctx.userAgent ?? null,
      ip: ctx.ip ?? null,
    });
    const accessToken = await this.signer.signAccess({ sub: user.id, role: user.role, app: ctx.app, sid: sessionId });
    return { accessToken, refreshToken, expiresIn: this.signer.accessTtl };
  }

  async rotate(refreshToken: string, deviceId: string, ip?: string): Promise<TokenPair> {
    const invalid = () => unauthorized('INVALID_REFRESH_TOKEN', 'Session expired. Please sign in again');
    const sessionId = refreshToken.split('.')[0] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw invalid();

    const [row] = await this.db
      .select({
        id: sessions.id,
        userId: sessions.userId,
        app: sessions.app,
        deviceId: sessions.deviceId,
        tokenHash: sessions.tokenHash,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
        role: users.role,
        status: users.status,
        deletedAt: users.deletedAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sessionId));

    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) throw invalid();

    const presentedHash = this.hash(refreshToken);
    if (!safeEqual(presentedHash, row.tokenHash)) {
      // A rotated-out token was replayed: assume it was stolen.
      await this.revokeAllForUser(row.userId);
      await audit(this.db, {
        actorId: row.userId,
        action: 'session.refresh_reuse',
        entity: 'session',
        entityId: row.id,
        ...(ip ? { ip } : {}),
      });
      throw invalid();
    }
    if (row.deviceId !== deviceId) {
      await this.revoke(row.id);
      throw invalid();
    }
    if (row.status === 'blocked' || row.deletedAt) {
      await this.revoke(row.id);
      throw invalid();
    }

    const next = `${row.id}.${randomToken()}`;
    const updated = await this.db
      .update(sessions)
      .set({ tokenHash: this.hash(next), expiresAt: this.expiry(), lastUsedAt: new Date(), ip: ip ?? null })
      .where(and(eq(sessions.id, row.id), eq(sessions.tokenHash, presentedHash), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (updated.length === 0) throw invalid(); // lost a race with a concurrent refresh

    const accessToken = await this.signer.signAccess({ sub: row.userId, role: row.role, app: row.app, sid: row.id });
    return { accessToken, refreshToken: next, expiresIn: this.signer.accessTtl };
  }

  /** Revokes the session a refresh token belongs to. Silently ignores unknown tokens. */
  async revokeByToken(refreshToken: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, this.hash(refreshToken)), isNull(sessions.revokedAt)));
  }

  async markMfa(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ mfaAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async revokeAllForUser(userId: string, db: Pick<Database, 'update'> = this.db): Promise<void> {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}
