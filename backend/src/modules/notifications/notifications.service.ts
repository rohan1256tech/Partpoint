import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../db/index.js';
import { orders, pushTokens } from '../../db/schema.js';
import type { PushMessage, PushSender } from '../../lib/push.js';

type OrderStatus = (typeof orders.$inferSelect)['status'];
type ClientApp = (typeof pushTokens.$inferSelect)['app'];

/** Who hears about each order status, and what they are told. No personal data goes into a push. */
const ORDER_PUSH: Partial<
  Record<OrderStatus, { to: ('retailer' | 'wholesaler' | 'delivery')[]; title: string; body: (n: string) => string }>
> = {
  placed: { to: ['wholesaler'], title: 'New order', body: (n) => `${n} is waiting for you to accept it` },
  accepted: { to: ['retailer'], title: 'Order accepted', body: (n) => `${n} is being prepared` },
  packed: { to: ['retailer'], title: 'Order packed', body: (n) => `${n} is packed and awaiting pickup` },
  assigned: { to: ['delivery'], title: 'New delivery', body: (n) => `${n} is assigned to you` },
  picked_up: { to: ['retailer'], title: 'Order picked up', body: (n) => `${n} is on its way. Keep your delivery code ready` },
  out_for_delivery: { to: ['retailer'], title: 'Out for delivery', body: (n) => `${n} will reach you soon` },
  delivered: { to: ['retailer', 'wholesaler'], title: 'Order delivered', body: (n) => `${n} has been delivered` },
  cancelled: { to: ['retailer', 'wholesaler', 'delivery'], title: 'Order cancelled', body: (n) => `${n} was cancelled` },
};

/**
 * Sends push notifications after the response, so a slow or failing push never delays or
 * fails the request that caused it. Errors are logged; dead tokens are removed.
 */
export class NotificationService {
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly sender: PushSender,
    private readonly log: FastifyBaseLogger,
  ) {}

  async registerToken(userId: string, app: ClientApp, token: string): Promise<void> {
    // A device token belongs to whoever signed in on that device most recently.
    await this.db
      .insert(pushTokens)
      .values({ userId, app, token })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId, app } });
  }

  async removeToken(userId: string, token: string): Promise<void> {
    await this.db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
  }

  /** Fire-and-forget. */
  notifyUsers(userIds: readonly string[], message: PushMessage): void {
    this.track(this.deliver(userIds, message));
  }

  /** Fire-and-forget: tells the parties of an order about its new status. */
  orderChanged(orderId: string, status: OrderStatus, extra: { alsoNotify?: string[] } = {}): void {
    this.track(
      (async () => {
        const rule = ORDER_PUSH[status];
        if (!rule) return;
        const [o] = await this.db
          .select({
            orderNumber: orders.orderNumber,
            retailerId: orders.retailerId,
            wholesalerId: orders.wholesalerId,
            deliveryPartnerId: orders.deliveryPartnerId,
          })
          .from(orders)
          .where(eq(orders.id, orderId));
        if (!o) return;
        const byRole = { retailer: o.retailerId, wholesaler: o.wholesalerId, delivery: o.deliveryPartnerId };
        const recipients = rule.to.map((r) => byRole[r]).filter((id): id is string => !!id);
        await this.deliver(recipients, {
          title: rule.title,
          body: rule.body(o.orderNumber),
          data: { type: 'order', orderId, status },
        });
        if (extra.alsoNotify?.length) {
          await this.deliver(extra.alsoNotify, {
            title: 'Delivery reassigned',
            body: `${o.orderNumber} has been reassigned`,
            data: { type: 'order', orderId, status: 'reassigned' },
          });
        }
      })(),
    );
  }

  /** Resolves when every queued notification has finished (tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight]);
  }

  private track(p: Promise<void>): void {
    const tracked = p
      .catch((err: unknown) => this.log.error({ err }, 'push notification failed'))
      .finally(() => this.inFlight.delete(tracked));
    this.inFlight.add(tracked);
  }

  private async deliver(userIds: readonly string[], message: PushMessage): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    const tokens = await this.db
      .select({ token: pushTokens.token })
      .from(pushTokens)
      .where(inArray(pushTokens.userId, unique));
    const dead: string[] = [];
    await Promise.all(
      tokens.map(async ({ token }) => {
        try {
          if ((await this.sender.send(token, message)) === 'invalid_token') dead.push(token);
        } catch (err) {
          this.log.warn({ err }, 'push to one device failed');
        }
      }),
    );
    if (dead.length) await this.db.delete(pushTokens).where(inArray(pushTokens.token, dead));
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    notifications: NotificationService;
  }
}
