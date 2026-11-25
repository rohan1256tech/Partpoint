import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp, type SecretBox } from '../../lib/totp.js';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';
import type { SessionService } from './session.service.js';

/**
 * Admin two-factor setup. An admin signs in with email + password, then:
 *   POST /setup  → secret + otpauth:// URI (shown as a QR code in the admin panel)
 *   POST /enable → confirms with a first code; the current session counts as 2FA-verified.
 * There is deliberately no "disable" endpoint: a lost authenticator is reset on the server
 * with `ADMIN_RESET_2FA=1 pnpm db:seed:admin`.
 */
export class AdminMfaService {
  constructor(
    private readonly db: Database,
    private readonly box: SecretBox,
    private readonly sessions: SessionService,
  ) {}

  async status(adminId: string) {
    const [u] = await this.db.select({ enabledAt: users.totpEnabledAt }).from(users).where(eq(users.id, adminId));
    return { enabled: !!u?.enabledAt };
  }

  async setup(adminId: string): Promise<{ secret: string; otpauthUri: string }> {
    const [u] = await this.db
      .select({ email: users.email, enabledAt: users.totpEnabledAt })
      .from(users)
      .where(eq(users.id, adminId));
    if (u?.enabledAt) throw conflict('MFA_ALREADY_ENABLED', 'Two-factor authentication is already set up');
    const secret = newTotpSecret();
    await this.db.update(users).set({ totpSecret: this.box.seal(secret), totpLastStep: null }).where(eq(users.id, adminId));
    return { secret: base32Encode(secret), otpauthUri: otpauthUri(secret, u?.email ?? adminId) };
  }

  async enable(adminId: string, sessionId: string, code: string, ip: string): Promise<void> {
    const [u] = await this.db
      .select({ secret: users.totpSecret, enabledAt: users.totpEnabledAt })
      .from(users)
      .where(eq(users.id, adminId));
    if (u?.enabledAt) throw conflict('MFA_ALREADY_ENABLED', 'Two-factor authentication is already set up');
    if (!u?.secret) throw badRequest('MFA_NOT_STARTED', 'Start the setup first');
    const step = verifyTotp(this.box.open(u.secret), code, null);
    if (step === null) throw badRequest('TOTP_INVALID', 'That code is not right. Check the time on your phone and try again');

    await this.db.update(users).set({ totpEnabledAt: new Date(), totpLastStep: step }).where(eq(users.id, adminId));
    await this.sessions.markMfa(sessionId);
    await audit(this.db, { actorId: adminId, action: 'admin.mfa_enabled', entity: 'user', entityId: adminId, ip });
  }
}

/** Mounted at /v1/admin/2fa. Reachable before 2FA is set up. */
export const adminMfaRoutes: FastifyPluginAsync<{ mfa: AdminMfaService; authenticate: Authenticate }> = async (
  app,
  { mfa, authenticate },
) => {
  app.addHook('preHandler', authenticate({ roles: ['admin'], allowWithoutMfa: true }));

  app.get('/', async (req) => mfa.status(currentUser(req).id));
  app.post('/setup', async (req) => mfa.setup(currentUser(req).id));
  app.post('/enable', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
    const user = currentUser(req);
    await mfa.enable(user.id, user.sessionId, code, req.ip);
    return reply.status(204).send();
  });
};
