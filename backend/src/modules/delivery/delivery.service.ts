import { and, desc, eq, gte, isNull, sql, sum } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { deliveryEarnings, deliveryProfiles, orderEvents, orders, users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { AppError, badRequest, conflict, notFound, tooManyRequests } from '../../lib/errors.js';
import { checkDeliveryOtp, DELIVERY_OTP_MAX_ATTEMPTS } from '../orders/delivery-otp.js';
import type { OrderStatus } from '../orders/orders.service.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { SettingsService } from '../settings/settings.service.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface PartnerSummary {
  id: string;
  name: string;
  phone: string | null;
  vehicleType: string | null;
  vehicleNumber: string | null;
  isAvailable: boolean;
  activeDeliveries: number;
}

export interface EarningsSummary {
  todayPaise: number;
  last7DaysPaise: number;
  thisMonthPaise: number;
  allTimePaise: number;
  unpaidPaise: number;
  deliveredCount: number;
  recent: { orderId: string; orderNumber: string; amountPaise: number; deliveredAt: string; paidOut: boolean }[];
}

/** Start of today and of this month in India Standard Time, as UTC instants. */
function istBoundaries(now = new Date()) {
  const IST = 330 * 60_000;
  const local = new Date(now.getTime() + IST);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - IST;
  const month = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - IST;
  return { today: new Date(day), week: new Date(day - 6 * 86_400_000), month: new Date(month) };
}

export class DeliveryService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly otpSecret: string,
    private readonly notifications: NotificationService,
  ) {}

  // ================================================================ partners

  async listPartners(onlyAvailable: boolean): Promise<PartnerSummary[]> {
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        phone: users.phone,
        vehicleType: deliveryProfiles.vehicleType,
        vehicleNumber: deliveryProfiles.vehicleNumber,
        isAvailable: deliveryProfiles.isAvailable,
        activeDeliveries: sql<number>`(SELECT count(*)::int FROM orders o
          WHERE o.delivery_partner_id = ${users.id} AND o.status IN ('assigned', 'picked_up', 'out_for_delivery'))`,
      })
      .from(users)
      .innerJoin(deliveryProfiles, eq(deliveryProfiles.userId, users.id))
      .where(
        and(
          eq(users.role, 'delivery'),
          eq(users.status, 'approved'),
          isNull(users.deletedAt),
          onlyAvailable ? eq(deliveryProfiles.isAvailable, true) : undefined,
        ),
      )
      .orderBy(desc(deliveryProfiles.isAvailable), users.name);
    return rows;
  }

  async setAvailability(partnerId: string, isAvailable: boolean): Promise<{ isAvailable: boolean }> {
    await this.db.update(deliveryProfiles).set({ isAvailable }).where(eq(deliveryProfiles.userId, partnerId));
    return { isAvailable };
  }

  // ================================================================ assignment (admin)

  /** Assigns (or reassigns) a packed order. Returns the previous partner, if any, so they can be told. */
  async assign(adminId: string, orderId: string, partnerId: string, ip: string): Promise<void> {
    const result = await this.db.transaction(async (tx) => {
      const o = await this.lockOrder(tx, orderId);
      if (o.status !== 'packed' && o.status !== 'assigned') {
        throw conflict('INVALID_STATUS_TRANSITION', 'Only packed orders can be assigned for delivery');
      }
      const [partner] = await tx
        .select({ name: users.name, isAvailable: deliveryProfiles.isAvailable })
        .from(users)
        .innerJoin(deliveryProfiles, eq(deliveryProfiles.userId, users.id))
        .where(
          and(eq(users.id, partnerId), eq(users.role, 'delivery'), eq(users.status, 'approved'), isNull(users.deletedAt)),
        );
      if (!partner) throw badRequest('PARTNER_NOT_FOUND', 'Delivery partner not found');
      if (!partner.isAvailable) throw badRequest('PARTNER_UNAVAILABLE', 'This delivery partner is not available');
      if (o.deliveryPartnerId === partnerId) return { changed: false, previousPartnerId: null };

      await tx
        .update(orders)
        .set({ status: 'assigned', deliveryPartnerId: partnerId, deliveryAcceptedAt: null, deliveryOtpAttempts: 0 })
        .where(eq(orders.id, orderId));
      await tx
        .insert(orderEvents)
        .values({ orderId, status: 'assigned', actorId: adminId, note: `Assigned to ${partner.name}` });
      await audit(tx, {
        actorId: adminId,
        action: o.deliveryPartnerId ? 'order.reassign' : 'order.assign',
        entity: 'order',
        entityId: orderId,
        data: { partnerId, previousPartnerId: o.deliveryPartnerId },
        ip,
      });
      return { changed: true, previousPartnerId: o.deliveryPartnerId };
    });
    if (result.changed) {
      this.notifications.orderChanged(orderId, 'assigned', {
        ...(result.previousPartnerId ? { alsoNotify: [result.previousPartnerId] } : {}),
      });
    }
  }

  async resetOtpAttempts(adminId: string, orderId: string, ip: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockOrder(tx, orderId);
      await tx.update(orders).set({ deliveryOtpAttempts: 0 }).where(eq(orders.id, orderId));
      await audit(tx, { actorId: adminId, action: 'order.reset_delivery_otp', entity: 'order', entityId: orderId, ip });
    });
  }

  // ================================================================ the delivery partner's job

  async respond(partnerId: string, orderId: string, accept: boolean, reason: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const o = await this.lockOrder(tx, orderId, partnerId);
      if (o.status !== 'assigned' || o.deliveryAcceptedAt) {
        throw conflict('INVALID_STATUS_TRANSITION', 'This delivery has already been responded to');
      }
      if (accept) {
        await tx.update(orders).set({ deliveryAcceptedAt: new Date() }).where(eq(orders.id, orderId));
        await tx
          .insert(orderEvents)
          .values({ orderId, status: 'assigned', actorId: partnerId, note: 'Accepted by delivery partner' });
      } else {
        // Back to the admin's queue for someone else.
        await tx.update(orders).set({ status: 'packed', deliveryPartnerId: null }).where(eq(orders.id, orderId));
        await tx.insert(orderEvents).values({
          orderId,
          status: 'packed',
          actorId: partnerId,
          note: `Declined by delivery partner${reason ? `: ${reason}` : ''}`,
        });
      }
    });
  }

  async advance(partnerId: string, orderId: string, to: 'picked_up' | 'out_for_delivery'): Promise<void> {
    const from: Record<typeof to, OrderStatus> = { picked_up: 'assigned', out_for_delivery: 'picked_up' };
    await this.db.transaction(async (tx) => {
      const o = await this.lockOrder(tx, orderId, partnerId);
      if (o.status !== from[to]) {
        throw conflict('INVALID_STATUS_TRANSITION', `An order that is ${o.status.replace(/_/g, ' ')} cannot be changed this way`);
      }
      if (to === 'picked_up' && !o.deliveryAcceptedAt) {
        throw conflict('ACCEPT_FIRST', 'Accept the delivery before picking it up');
      }
      await tx.update(orders).set({ status: to }).where(eq(orders.id, orderId));
      await tx.insert(orderEvents).values({ orderId, status: to, actorId: partnerId });
    });
    this.notifications.orderChanged(orderId, to);
  }

  /** Handover: the retailer reads out the 4-digit code from their app. */
  async deliver(partnerId: string, orderId: string, code: string): Promise<void> {
    const outcome = await this.db.transaction(async (tx) => {
      const o = await this.lockOrder(tx, orderId, partnerId);
      if (o.status !== 'picked_up' && o.status !== 'out_for_delivery') {
        throw conflict('INVALID_STATUS_TRANSITION', 'Pick up the order before delivering it');
      }
      if (o.deliveryOtpAttempts >= DELIVERY_OTP_MAX_ATTEMPTS) {
        throw tooManyRequests('DELIVERY_OTP_LOCKED', 'Too many wrong codes. Ask the admin to reset the code');
      }
      if (!checkDeliveryOtp(this.otpSecret, orderId, code)) {
        // Recorded (committed) even though the request fails.
        await tx
          .update(orders)
          .set({ deliveryOtpAttempts: sql`${orders.deliveryOtpAttempts} + 1` })
          .where(eq(orders.id, orderId));
        return { ok: false as const, left: DELIVERY_OTP_MAX_ATTEMPTS - o.deliveryOtpAttempts - 1 };
      }

      const now = new Date();
      const { deliveryEarningPaise } = await this.settings.get();
      await tx.update(orders).set({ status: 'delivered', deliveredAt: now }).where(eq(orders.id, orderId));
      await tx.insert(orderEvents).values({ orderId, status: 'delivered', actorId: partnerId });
      await tx
        .insert(deliveryEarnings)
        .values({ deliveryPartnerId: partnerId, orderId, amountPaise: deliveryEarningPaise })
        .onConflictDoNothing();
      return { ok: true as const };
    });
    if (!outcome.ok) {
      throw new AppError(400, 'DELIVERY_OTP_INVALID', `Wrong code. ${outcome.left} attempt(s) left`);
    }
    this.notifications.orderChanged(orderId, 'delivered');
  }

  async earnings(partnerId: string): Promise<EarningsSummary> {
    const b = istBoundaries();
    const total = (since?: Date, unpaidOnly = false) =>
      this.db
        .select({ s: sum(deliveryEarnings.amountPaise), n: sql<number>`count(*)::int` })
        .from(deliveryEarnings)
        .where(
          and(
            eq(deliveryEarnings.deliveryPartnerId, partnerId),
            since ? gte(deliveryEarnings.createdAt, since) : undefined,
            unpaidOnly ? isNull(deliveryEarnings.paidOutAt) : undefined,
          ),
        )
        .then(([r]) => ({ paise: Number(r?.s ?? 0), count: r?.n ?? 0 }));

    const [today, week, month, all, unpaid, recent] = await Promise.all([
      total(b.today),
      total(b.week),
      total(b.month),
      total(),
      total(undefined, true),
      this.db
        .select({
          orderId: deliveryEarnings.orderId,
          orderNumber: orders.orderNumber,
          amountPaise: deliveryEarnings.amountPaise,
          deliveredAt: deliveryEarnings.createdAt,
          paidOutAt: deliveryEarnings.paidOutAt,
        })
        .from(deliveryEarnings)
        .innerJoin(orders, eq(orders.id, deliveryEarnings.orderId))
        .where(eq(deliveryEarnings.deliveryPartnerId, partnerId))
        .orderBy(desc(deliveryEarnings.createdAt))
        .limit(50),
    ]);
    return {
      todayPaise: today.paise,
      last7DaysPaise: week.paise,
      thisMonthPaise: month.paise,
      allTimePaise: all.paise,
      unpaidPaise: unpaid.paise,
      deliveredCount: all.count,
      recent: recent.map((r) => ({
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        amountPaise: r.amountPaise,
        deliveredAt: r.deliveredAt.toISOString(),
        paidOut: r.paidOutAt !== null,
      })),
    };
  }

  /** Locks the order row. With `partnerId`, only that partner's order is found (others get 404). */
  private async lockOrder(tx: Tx, orderId: string, partnerId?: string) {
    const [o] = await tx
      .select({
        status: orders.status,
        deliveryPartnerId: orders.deliveryPartnerId,
        deliveryAcceptedAt: orders.deliveryAcceptedAt,
        deliveryOtpAttempts: orders.deliveryOtpAttempts,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), partnerId ? eq(orders.deliveryPartnerId, partnerId) : undefined))
      .for('update');
    if (!o) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    return o;
  }
}
