import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { deliveryEarnings, wholesalerPayouts, wholesalerProfiles } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';

/**
 * Money owed to wholesalers and delivery partners (settled manually in v1).
 *
 * For each delivered order a wholesaler is owed the goods value (subtotal − discount)
 * minus the platform commission. The delivery fee stays with the platform.
 * Balance = owed − payouts recorded by the admin.
 */
export interface WholesalerBalance {
  wholesalerId: string;
  businessName: string;
  deliveredOrders: number;
  goodsPaise: number;
  commissionPaise: number;
  owedPaise: number;
  paidPaise: number;
  balancePaise: number;
}

export const payoutBody = z.object({
  amountPaise: z.number().int().positive().max(10_000_000_000),
  /** Bank UTR / transaction reference. */
  reference: z.string().trim().min(4).max(60),
  note: z.string().trim().max(300).optional(),
  paidAt: z.coerce.date().optional(),
});

export class FinanceService {
  constructor(private readonly db: Database) {}

  async wholesalerBalances(
    onlyWholesalerId?: string,
    db: Pick<Database, 'execute'> = this.db,
  ): Promise<WholesalerBalance[]> {
    const { rows } = await db.execute<{
      wholesaler_id: string;
      business_name: string;
      delivered_orders: number;
      goods: string;
      commission: string;
      paid: string;
    }>(sql`
      SELECT wp.user_id AS wholesaler_id, wp.business_name,
             COALESCE(o.n, 0)::int AS delivered_orders,
             COALESCE(o.goods, 0) AS goods,
             COALESCE(o.commission, 0) AS commission,
             COALESCE((SELECT sum(p.amount_paise) FROM wholesaler_payouts p WHERE p.wholesaler_id = wp.user_id), 0) AS paid
      FROM wholesaler_profiles wp
      LEFT JOIN (
        SELECT wholesaler_id, count(*) AS n,
               sum(subtotal_paise - discount_paise) AS goods, sum(commission_paise) AS commission
        FROM orders WHERE status = 'delivered' GROUP BY wholesaler_id
      ) o ON o.wholesaler_id = wp.user_id
      ${onlyWholesalerId ? sql`WHERE wp.user_id = ${onlyWholesalerId}` : sql``}
      ORDER BY wp.business_name`);
    return rows.map((r) => {
      const goods = Number(r.goods);
      const commission = Number(r.commission);
      const paid = Number(r.paid);
      return {
        wholesalerId: r.wholesaler_id,
        businessName: r.business_name,
        deliveredOrders: r.delivered_orders,
        goodsPaise: goods,
        commissionPaise: commission,
        owedPaise: goods - commission,
        paidPaise: paid,
        balancePaise: goods - commission - paid,
      };
    });
  }

  async payouts(wholesalerId: string) {
    return this.db
      .select({
        id: wholesalerPayouts.id,
        amountPaise: wholesalerPayouts.amountPaise,
        reference: wholesalerPayouts.reference,
        note: wholesalerPayouts.note,
        paidAt: wholesalerPayouts.paidAt,
      })
      .from(wholesalerPayouts)
      .where(eq(wholesalerPayouts.wholesalerId, wholesalerId))
      .orderBy(desc(wholesalerPayouts.paidAt))
      .limit(100);
  }

  async recordPayout(adminId: string, wholesalerId: string, input: z.infer<typeof payoutBody>, ip: string) {
    return this.db.transaction(async (tx) => {
      // Serialise payouts per wholesaler so two admins cannot together pay more than is owed.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`payout:${wholesalerId}`}))`);
      const [w] = await tx
        .select({ id: wholesalerProfiles.userId })
        .from(wholesalerProfiles)
        .where(eq(wholesalerProfiles.userId, wholesalerId));
      if (!w) throw notFound('WHOLESALER_NOT_FOUND', 'Wholesaler not found');

      const [balance] = await this.wholesalerBalances(wholesalerId, tx);
      if (!balance || input.amountPaise > balance.balancePaise) {
        throw badRequest(
          'PAYOUT_EXCEEDS_BALANCE',
          `The outstanding balance is ₹${((balance?.balancePaise ?? 0) / 100).toFixed(2)}`,
        );
      }
      const [payout] = await tx
        .insert(wholesalerPayouts)
        .values({
          wholesalerId,
          amountPaise: input.amountPaise,
          reference: input.reference,
          note: input.note ?? null,
          paidAt: input.paidAt ?? new Date(),
          createdBy: adminId,
        })
        .returning();
      await audit(tx, {
        actorId: adminId,
        action: 'payout.wholesaler',
        entity: 'wholesaler',
        entityId: wholesalerId,
        data: { amountPaise: input.amountPaise, reference: input.reference },
        ip,
      });
      return payout;
    });
  }

  async deliveryBalances() {
    const { rows } = await this.db.execute<{ partner_id: string; name: string; unpaid: string; deliveries: number }>(sql`
      SELECT u.id AS partner_id, u.name, sum(e.amount_paise) AS unpaid, count(*)::int AS deliveries
      FROM delivery_earnings e JOIN users u ON u.id = e.delivery_partner_id
      WHERE e.paid_out_at IS NULL
      GROUP BY u.id, u.name ORDER BY u.name`);
    return rows.map((r) => ({
      partnerId: r.partner_id,
      name: r.name,
      unpaidPaise: Number(r.unpaid),
      unpaidDeliveries: r.deliveries,
    }));
  }

  /** Marks every unpaid earning of the partner as paid out (one bank transfer). */
  async settleDelivery(adminId: string, partnerId: string, reference: string, ip: string) {
    return this.db.transaction(async (tx) => {
      const settled = await tx
        .update(deliveryEarnings)
        .set({ paidOutAt: new Date() })
        .where(and(eq(deliveryEarnings.deliveryPartnerId, partnerId), isNull(deliveryEarnings.paidOutAt)))
        .returning({ amountPaise: deliveryEarnings.amountPaise });
      if (settled.length === 0) throw badRequest('NOTHING_TO_SETTLE', 'This partner has no unpaid earnings');
      const amountPaise = settled.reduce((s, e) => s + e.amountPaise, 0);
      await audit(tx, {
        actorId: adminId,
        action: 'payout.delivery',
        entity: 'delivery_partner',
        entityId: partnerId,
        data: { amountPaise, deliveries: settled.length, reference },
        ip,
      });
      return { amountPaise, deliveries: settled.length };
    });
  }
}

// ---------------------------------------------------------------- routes

interface Deps {
  finance: FinanceService;
  authenticate: Authenticate;
}
const me = (req: FastifyRequest) => currentUser(req).id;
const idParams = z.object({ id: z.uuid() });

/** Mounted at /v1/admin/finance. */
export const adminFinanceRoutes: FastifyPluginAsync<Deps> = async (app, { finance, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['admin'] }));

  app.get('/wholesalers', async () => ({ items: await finance.wholesalerBalances() }));
  app.get('/wholesalers/:id/payouts', async (req) => ({ items: await finance.payouts(parse(idParams, req.params).id) }));
  app.post('/wholesalers/:id/payouts', async (req, reply) =>
    reply
      .status(201)
      .send(await finance.recordPayout(me(req), parse(idParams, req.params).id, parse(payoutBody, req.body), req.ip)),
  );

  app.get('/delivery', async () => ({ items: await finance.deliveryBalances() }));
  app.post('/delivery/:id/settle', async (req) => {
    const { reference } = parse(z.object({ reference: z.string().trim().min(4).max(60) }), req.body);
    return finance.settleDelivery(me(req), parse(idParams, req.params).id, reference, req.ip);
  });
};

/** Mounted at /v1/wholesaler/finance. A wholesaler's own balance and payouts. */
export const wholesalerFinanceRoutes: FastifyPluginAsync<Deps> = async (app, { finance, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['wholesaler'] }));
  app.get('/', async (req) => {
    const [balance] = await finance.wholesalerBalances(me(req));
    return { balance: balance ?? null, payouts: await finance.payouts(me(req)) };
  });
};
