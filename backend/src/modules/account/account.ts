import { and, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import {
  accountDeletionRequests,
  addresses,
  cartItems,
  deliveryEarnings,
  deliveryProfiles,
  orders,
  otpCodes,
  supplierOffers,
  pushTokens,
  retailerProfiles,
  sessions,
  users,
  wishlistItems,
} from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';
import { emailSchema, phoneSchema } from '../auth/auth.schemas.js';
import type { FinanceService } from '../finance/finance.js';
import { deletionPage } from './deletion-page.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const OPEN_ORDER = ['delivered', 'cancelled'] as const;

/**
 * Account deletion (Google Play policy and DPDP).
 *
 * Personal data is erased: name, phone, email, password, addresses, cart, wishlist, devices,
 * sessions and pending codes. Orders are kept, because GST law requires tax records to be
 * retained; their delivery snapshots stay for that purpose only. The privacy policy says so.
 *
 * Deletion is refused while the account still has orders in progress or money to settle,
 * so nobody walks away mid-transaction.
 */
export class AccountService {
  constructor(
    private readonly db: Database,
    private readonly finance: FinanceService,
  ) {}

  async deleteOwnAccount(userId: string, reason: string | null, ip: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const user = await this.erase(tx, userId);
      await tx.insert(accountDeletionRequests).values({
        userId,
        source: 'app',
        contact: user.contact,
        reason,
        status: 'completed',
        processedAt: new Date(),
      });
      await audit(tx, { actorId: userId, action: 'account.delete', entity: 'user', entityId: userId, ip });
    });
  }

  /** Public web form. Always succeeds from the caller's view, so it cannot reveal who has an account. */
  async requestDeletion(contact: string, reason: string | null): Promise<void> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(or(eq(users.phone, contact), eq(users.email, contact)), isNull(users.deletedAt)));
    await this.db.insert(accountDeletionRequests).values({ userId: user?.id ?? null, source: 'web', contact, reason });
  }

  listRequests(status?: 'requested' | 'completed' | 'rejected') {
    return this.db
      .select()
      .from(accountDeletionRequests)
      .where(status ? eq(accountDeletionRequests.status, status) : undefined)
      .orderBy(desc(accountDeletionRequests.createdAt))
      .limit(200);
  }

  /** Admin processes a web request (after confirming the requester, e.g. by calling the number). */
  async processRequest(adminId: string, requestId: string, decision: 'complete' | 'reject', note: string | null, ip: string) {
    await this.db.transaction(async (tx) => {
      const [req] = await tx
        .select()
        .from(accountDeletionRequests)
        .where(eq(accountDeletionRequests.id, requestId))
        .for('update');
      if (!req) throw notFound('REQUEST_NOT_FOUND', 'Request not found');
      if (req.status !== 'requested') throw conflict('ALREADY_PROCESSED', 'This request has already been processed');

      let finalNote = note;
      if (decision === 'complete') {
        if (req.userId) await this.erase(tx, req.userId);
        else finalNote = note ?? 'No account found for this contact';
      }
      await tx
        .update(accountDeletionRequests)
        .set({ status: decision === 'complete' ? 'completed' : 'rejected', note: finalNote, processedAt: new Date() })
        .where(eq(accountDeletionRequests.id, requestId));
      await audit(tx, {
        actorId: adminId,
        action: `account.deletion_${decision}`,
        entity: 'user',
        entityId: req.userId ?? undefined,
        data: { requestId, ...(finalNote ? { note: finalNote } : {}) },
        ip,
      });
    });
  }

  /** Checks the account can go, then erases its personal data. Returns the original contact. */
  private async erase(tx: Tx, userId: string): Promise<{ contact: string }> {
    const [u] = await tx
      .select({ role: users.role, phone: users.phone, email: users.email, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!u || u.deletedAt) throw notFound('USER_NOT_FOUND', 'Account not found');
    if (u.role === 'admin') throw conflict('ADMIN_ACCOUNT', 'Admin accounts are removed by another admin');

    await this.assertNothingOutstanding(tx, userId, u.role);

    const now = new Date();
    await tx
      .update(users)
      .set({
        name: 'Deleted user',
        phone: null,
        email: null,
        passwordHash: null,
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
        statusReason: 'Account deleted by request',
        deletedAt: now,
      })
      .where(eq(users.id, userId));
    await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await tx.delete(pushTokens).where(eq(pushTokens.userId, userId));
    await tx.delete(addresses).where(eq(addresses.userId, userId));
    await tx.delete(cartItems).where(eq(cartItems.userId, userId));
    await tx.delete(wishlistItems).where(eq(wishlistItems.userId, userId));
    const targets = [u.phone, u.email].filter((v): v is string => !!v);
    if (targets.length) await tx.delete(otpCodes).where(inArray(otpCodes.target, targets));

    if (u.role === 'retailer') {
      await tx.update(retailerProfiles).set({ shopName: 'Deleted shop', gstin: null }).where(eq(retailerProfiles.userId, userId));
    }
    if (u.role === 'wholesaler') {
      // The business record stays for tax purposes; its stock is taken off sale.
      await tx.update(supplierOffers).set({ isActive: false, stockQty: 0 }).where(eq(supplierOffers.wholesalerId, userId));
    }
    if (u.role === 'delivery') {
      await tx
        .update(deliveryProfiles)
        .set({ isAvailable: false, vehicleNumber: null, lastLatitude: null, lastLongitude: null, lastLocationAt: null })
        .where(eq(deliveryProfiles.userId, userId));
    }
    return { contact: u.phone ?? u.email ?? 'unknown' };
  }

  private async assertNothingOutstanding(tx: Tx, userId: string, role: string): Promise<void> {
    const column =
      role === 'retailer' ? orders.retailerId : role === 'wholesaler' ? orders.wholesalerId : orders.deliveryPartnerId;
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(column, userId), notInArray(orders.status, [...OPEN_ORDER])));
    if ((open?.n ?? 0) > 0) {
      throw conflict(
        'HAS_OPEN_ORDERS',
        'You have orders in progress. Your account can be deleted once they are delivered or cancelled',
      );
    }
    if (role === 'wholesaler') {
      const [b] = await this.finance.wholesalerBalances(userId, tx);
      if (b && b.balancePaise !== 0) {
        throw conflict('HAS_BALANCE', 'Your payouts are not yet settled. Please contact support to close your account');
      }
    }
    if (role === 'delivery') {
      const [e] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(deliveryEarnings)
        .where(and(eq(deliveryEarnings.deliveryPartnerId, userId), isNull(deliveryEarnings.paidOutAt), sql`${deliveryEarnings.amountPaise} > 0`));
      if ((e?.n ?? 0) > 0) {
        throw conflict('HAS_BALANCE', 'Your earnings are not yet paid out. Please contact support to close your account');
      }
    }
  }
}

// ---------------------------------------------------------------- routes

interface Deps {
  account: AccountService;
  authenticate: Authenticate;
}
const me = (req: FastifyRequest) => currentUser(req).id;

/** Accepts a phone number or an email address. */
const contactSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .transform((v, ctx) => {
    const target = v.includes('@') ? emailSchema.safeParse(v) : phoneSchema.safeParse(v);
    if (!target.success) {
      ctx.addIssue({ code: 'custom', message: 'Enter the phone number or email address of your account' });
      return z.NEVER;
    }
    return target.data;
  });

/** Mounted at /v1/me. In-app deletion (any role except admin, including accounts awaiting approval). */
export const accountRoutes: FastifyPluginAsync<Deps> = async (app, { account, authenticate }) => {
  app.post(
    '/delete-account',
    { preHandler: authenticate({ roles: ['retailer', 'wholesaler', 'delivery'], allowPending: true }) },
    async (req, reply) => {
      const { reason } = parse(
        z.object({ confirm: z.literal(true, 'Confirm that you want to delete your account'), reason: z.string().trim().max(500).optional() }),
        req.body,
      );
      await account.deleteOwnAccount(me(req), reason ?? null, req.ip);
      return reply.status(204).send();
    },
  );
};

/** Public: the web page and form linked from the Play Store listing. */
export const publicAccountRoutes: FastifyPluginAsync<Deps & { privacyHtml: string }> = async (app, { account, privacyHtml }) => {
  // Linked from the Play listing, the Data safety form, the signup consent and the apps' Account screen.
  app.get('/privacy', async (_req, reply) =>
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
      .header('cache-control', 'public, max-age=3600')
      .send(privacyHtml),
  );
  app.get('/account/delete', async (_req, reply) =>
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'")
      .send(deletionPage),
  );
  app.post(
    '/v1/account-deletion-requests',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const { contact, reason } = parse(
        z.object({ contact: contactSchema, reason: z.string().trim().max(500).optional() }),
        req.body,
      );
      await account.requestDeletion(contact, reason ?? null);
      return reply.status(202).send({ received: true });
    },
  );
};

/** Mounted at /v1/admin/account-deletion-requests. */
export const adminAccountRoutes: FastifyPluginAsync<Deps> = async (app, { account, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['admin'] }));
  const id = (req: FastifyRequest) => parse(z.object({ id: z.uuid() }), req.params).id;
  const noteBody = z.object({ note: z.string().trim().min(1).max(500).optional() });

  app.get('/', async (req) => {
    const { status } = parse(z.object({ status: z.enum(['requested', 'completed', 'rejected']).optional() }), req.query);
    return { items: await account.listRequests(status) };
  });
  app.post('/:id/complete', async (req, reply) => {
    await account.processRequest(me(req), id(req), 'complete', parse(noteBody, req.body ?? {}).note ?? null, req.ip);
    return reply.status(204).send();
  });
  app.post('/:id/reject', async (req, reply) => {
    const { note } = parse(z.object({ note: z.string().trim().min(1).max(500) }), req.body);
    await account.processRequest(me(req), id(req), 'reject', note, req.ip);
    return reply.status(204).send();
  });
};
