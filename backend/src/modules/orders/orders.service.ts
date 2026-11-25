import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/index.js';
import {
  cartItems,
  checkouts,
  couponRedemptions,
  coupons,
  orderEvents,
  orderItems,
  orders,
  productVariants,
  retailerProfiles,
  users,
  wholesalerProfiles,
} from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { istDate } from '../../lib/time.js';
import { decodeCursor, paginate } from '../../lib/cursor.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { snapshotOf, type AddressesService, type AddressSnapshot } from '../addresses/addresses.js';
import type { SettingsService } from '../settings/settings.service.js';
import { loadVariantLines, type CartService } from './cart.service.js';
import type { CouponsService } from './coupons.service.js';
import type { listOrdersQuery, placeOrderBody } from './orders.schemas.js';
import { assignInvoice } from '../invoices/invoices.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import { deliveryOtp } from './delivery-otp.js';
import { priceOrderGroups } from './pricing.js';

type OrderRow = typeof orders.$inferSelect;
export type OrderStatus = OrderRow['status'];
export type OrderViewer = 'retailer' | 'wholesaler' | 'admin' | 'delivery';

/** Statuses during which the delivery partner is actively handling the order. */
export const ACTIVE_DELIVERY: readonly OrderStatus[] = ['assigned', 'picked_up', 'out_for_delivery'];

export interface PlacedOrders {
  checkoutId: string;
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  orders: { id: string; orderNumber: string; wholesalerId: string; totalPaise: number }[];
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalPaise: number;
  itemCount: number;
  wholesaler: { id: string; businessName: string };
  retailer: { id: string; shopName: string };
  createdAt: string;
}

export interface OrderDetail extends OrderSummary {
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  /** Platform commission; only shown to the wholesaler and the admin. */
  commissionPaise: number | null;
  /**
   * Retailer and admin see the full delivery address. The wholesaler sees only the area,
   * since the delivery partner (not the wholesaler) takes the goods to the shop.
   */
  address: AddressSnapshot | { city: string; state: string; pincode: string };
  items: {
    productId: string;
    variantId: string;
    productName: string;
    variantName: string;
    hsnCode: string | null;
    gstRateBps: number;
    qty: number;
    unitPricePaise: number;
    lineTotalPaise: number;
  }[];
  timeline: { status: OrderStatus; note: string | null; at: string }[];
  cancelReason: string | null;
  deliveredAt: string | null;
  /** Name and phone are shared only while the delivery is active. */
  deliveryPartner: { id: string; name: string; phone: string | null } | null;
  deliveryAccepted: boolean;
  /** Retailer only, once the goods are on their way: read it out to the delivery partner. */
  deliveryOtp: string | null;
  /** Where to collect the goods; delivery partner (while active) and admin only. */
  pickup: {
    businessName: string;
    addressLine: string;
    city: string;
    state: string;
    pincode: string;
    latitude: number | null;
    longitude: number | null;
    phone: string | null;
  } | null;
}

/** Who may move an order from which states. */
const TRANSITIONS = {
  accept: { by: ['wholesaler'], from: ['placed'], to: 'accepted' },
  pack: { by: ['wholesaler'], from: ['accepted'], to: 'packed' },
  reject: { by: ['wholesaler'], from: ['placed', 'accepted'], to: 'cancelled' },
  cancelByRetailer: { by: ['retailer'], from: ['placed'], to: 'cancelled' },
  cancelByAdmin: { by: ['admin'], from: ['placed', 'accepted', 'packed', 'assigned'], to: 'cancelled' },
} as const satisfies Record<string, { by: readonly OrderViewer[]; from: readonly OrderStatus[]; to: OrderStatus }>;
export type OrderAction = keyof typeof TRANSITIONS;

export class OrdersService {
  constructor(
    private readonly db: Database,
    private readonly cart: CartService,
    private readonly addresses: AddressesService,
    private readonly coupons: CouponsService,
    private readonly settings: SettingsService,
    private readonly otpSecret: string,
    private readonly notifications: NotificationService,
  ) {}

  // ================================================================ placing

  /**
   * Turns the retailer's cart into one order per wholesaler, in a single transaction:
   * variant rows are locked, prices and stock re-checked, stock taken, the cart emptied.
   * The same idempotency key always returns the same result, so app retries are safe.
   * Payment is settled offline in v1 (no online payment).
   */
  async place(retailerId: string, input: z.infer<typeof placeOrderBody>): Promise<PlacedOrders> {
    const existing = await this.findPlaced(retailerId, input.idempotencyKey);
    if (existing) return existing;

    const address = snapshotOf(await this.addresses.getOwn(retailerId, input.addressId));
    const settings = await this.settings.get();

    try {
      const checkoutId = await this.db.transaction(async (tx) => {
        const lines = await tx
          .select({ variantId: cartItems.variantId, qty: cartItems.qty })
          .from(cartItems)
          .where(eq(cartItems.userId, retailerId));
        if (lines.length === 0) throw badRequest('CART_EMPTY', 'Your cart is empty');

        // Lock in a fixed order so concurrent orders cannot deadlock, then re-read under the lock.
        const ids = lines.map((l) => l.variantId).sort();
        await tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(inArray(productVariants.id, ids))
          .orderBy(asc(productVariants.id))
          .for('update');
        if (input.couponCode) {
          // Serialise use of the same coupon, so usage limits hold under concurrency.
          await tx
            .select({ id: coupons.id })
            .from(coupons)
            .where(eq(coupons.code, input.couponCode.trim().toUpperCase()))
            .for('update');
        }

        const cart = await this.cart.build(tx, retailerId, input.couponCode);
        if (input.couponCode && !cart.coupon) {
          throw badRequest('COUPON_INVALID', cart.couponError ?? 'This coupon is not valid');
        }
        if (!cart.canCheckout) {
          throw new AppError(409, 'CART_NEEDS_ATTENTION', 'Some items in your cart need attention', cart);
        }

        const variants = await loadVariantLines(tx, ids);
        const groups = priceOrderGroups(
          cart.groups.map((g) => ({
            wholesalerId: g.wholesaler.id,
            subtotalPaise: g.subtotalPaise,
            commissionBps: variants.get(g.lines[0]?.variantId ?? '')?.commissionBps ?? null,
          })),
          {
            discountPaise: cart.discountPaise,
            deliveryFeePaise: settings.deliveryFeePaise,
            defaultCommissionBps: settings.commissionBps,
          },
        );

        const [checkout] = await tx
          .insert(checkouts)
          .values({
            retailerId,
            idempotencyKey: input.idempotencyKey,
            status: 'placed',
            addressSnapshot: address,
            couponId: cart.coupon ? await this.couponId(tx, cart.coupon.code) : null,
            subtotalPaise: cart.subtotalPaise,
            discountPaise: cart.discountPaise,
            deliveryFeePaise: cart.deliveryFeePaise,
            totalPaise: cart.totalPaise,
          })
          .returning({ id: checkouts.id, couponId: checkouts.couponId });
        const { id, couponId } = checkout as { id: string; couponId: string | null };

        for (const [i, g] of cart.groups.entries()) {
          const totals = groups[i];
          if (!totals || totals.wholesalerId !== g.wholesaler.id) throw new Error('order group mismatch');
          const [seq] = (await tx.execute<{ n: string }>(sql`SELECT nextval('order_number_seq') AS n`)).rows;
          const [order] = await tx
            .insert(orders)
            .values({
              orderNumber: `PP-${istDate(new Date()).replace(/-/g, '')}-${String(seq?.n).padStart(6, '0')}`,
              checkoutId: id,
              retailerId,
              wholesalerId: g.wholesaler.id,
              status: 'placed',
              addressSnapshot: address,
              subtotalPaise: totals.subtotalPaise,
              discountPaise: totals.discountPaise,
              deliveryFeePaise: totals.deliveryFeePaise,
              totalPaise: totals.totalPaise,
              commissionPaise: totals.commissionPaise,
            })
            .returning({ id: orders.id });
          const orderId = (order as { id: string }).id;

          await tx.insert(orderItems).values(
            g.lines.map((l) => {
              const v = variants.get(l.variantId);
              if (!v) throw new Error('variant vanished under lock');
              return {
                orderId,
                productId: l.productId,
                variantId: l.variantId,
                productName: l.productName,
                variantName: l.variantName,
                hsnCode: v.hsnCode,
                gstRateBps: v.gstRateBps,
                qty: l.qty,
                unitPricePaise: l.unitPricePaise,
                lineTotalPaise: l.lineTotalPaise,
              };
            }),
          );
          await tx.insert(orderEvents).values({ orderId, status: 'placed', actorId: retailerId });

          for (const l of g.lines) {
            // The stock check constraint (>= 0) is the final guard against overselling.
            await tx
              .update(productVariants)
              .set({ stockQty: sql`${productVariants.stockQty} - ${l.qty}` })
              .where(eq(productVariants.id, l.variantId));
          }
        }

        if (couponId) await tx.insert(couponRedemptions).values({ couponId, userId: retailerId, checkoutId: id });
        await tx.delete(cartItems).where(eq(cartItems.userId, retailerId));
        return id;
      });
      const placed = (await this.placedById(checkoutId)) as PlacedOrders;
      for (const o of placed.orders) this.notifications.orderChanged(o.id, 'placed');
      return placed;
    } catch (err) {
      // A concurrent retry with the same key won the race: return its result.
      if (isUniqueViolation(err)) {
        const winner = await this.findPlaced(retailerId, input.idempotencyKey);
        if (winner) return winner;
      }
      throw err;
    }
  }

  private async couponId(tx: Pick<Database, 'select'>, code: string): Promise<string> {
    const [c] = await tx.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, code));
    if (!c) throw new Error('coupon vanished');
    return c.id;
  }

  private async findPlaced(retailerId: string, key: string): Promise<PlacedOrders | null> {
    const [c] = await this.db
      .select({ id: checkouts.id })
      .from(checkouts)
      .where(and(eq(checkouts.retailerId, retailerId), eq(checkouts.idempotencyKey, key)));
    return c ? this.placedById(c.id) : null;
  }

  private async placedById(checkoutId: string): Promise<PlacedOrders | null> {
    const [c] = await this.db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    if (!c) return null;
    const rows = await this.db
      .select({ id: orders.id, orderNumber: orders.orderNumber, wholesalerId: orders.wholesalerId, totalPaise: orders.totalPaise })
      .from(orders)
      .where(eq(orders.checkoutId, checkoutId))
      .orderBy(asc(orders.orderNumber));
    return {
      checkoutId: c.id,
      subtotalPaise: c.subtotalPaise,
      discountPaise: c.discountPaise,
      deliveryFeePaise: c.deliveryFeePaise,
      totalPaise: c.totalPaise,
      orders: rows,
    };
  }

  // ================================================================ reading

  /** Each role sees only its own orders (admins see all). */
  private scope(viewer: OrderViewer, userId: string): SQL | undefined {
    if (viewer === 'retailer') return eq(orders.retailerId, userId);
    if (viewer === 'wholesaler') return eq(orders.wholesalerId, userId);
    if (viewer === 'delivery') return eq(orders.deliveryPartnerId, userId);
    return undefined;
  }

  async list(
    viewer: OrderViewer,
    userId: string,
    q: z.infer<typeof listOrdersQuery>,
  ): Promise<{ items: OrderSummary[]; nextCursor: string | null }> {
    const filters: (SQL | undefined)[] = [this.scope(viewer, userId)];
    if (q.status) filters.push(eq(orders.status, q.status));
    if (q.scope === 'active') filters.push(inArray(orders.status, [...ACTIVE_DELIVERY]));
    if (q.scope === 'history') filters.push(inArray(orders.status, ['delivered', 'cancelled']));
    if (viewer === 'admin' && q.retailerId) filters.push(eq(orders.retailerId, q.retailerId));
    if (viewer === 'admin' && q.wholesalerId) filters.push(eq(orders.wholesalerId, q.wholesalerId));
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${orders.createdAt}, ${orders.id}) < (${c.createdAt.toISOString()}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({
        order: orders,
        businessName: wholesalerProfiles.businessName,
        shopName: retailerProfiles.shopName,
        itemCount: sql<number>`(SELECT count(*)::int FROM order_items oi WHERE oi.order_id = ${orders.id})`,
      })
      .from(orders)
      .innerJoin(wholesalerProfiles, eq(wholesalerProfiles.userId, orders.wholesalerId))
      .innerJoin(retailerProfiles, eq(retailerProfiles.userId, orders.retailerId))
      .where(and(...filters))
      .orderBy(sql`${orders.createdAt} DESC, ${orders.id} DESC`)
      .limit(q.limit + 1);

    const mapped = rows.map((r) => ({
      id: r.order.id,
      createdAt: r.order.createdAt,
      summary: this.summary(r.order, r.businessName, r.shopName, r.itemCount),
    }));
    const { page, nextCursor } = paginate(mapped, q.limit);
    return { items: page.map((p) => p.summary), nextCursor };
  }

  async get(viewer: OrderViewer, userId: string, orderId: string): Promise<OrderDetail> {
    const [row] = await this.db
      .select({ order: orders, businessName: wholesalerProfiles.businessName, shopName: retailerProfiles.shopName })
      .from(orders)
      .innerJoin(wholesalerProfiles, eq(wholesalerProfiles.userId, orders.wholesalerId))
      .innerJoin(retailerProfiles, eq(retailerProfiles.userId, orders.retailerId))
      .where(and(eq(orders.id, orderId), this.scope(viewer, userId)));
    // Someone else's order looks exactly like a missing one.
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');

    const [items, events] = await Promise.all([
      this.db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.productName)),
      this.db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId)).orderBy(asc(orderEvents.createdAt)),
    ]);
    const o = row.order;
    const address = o.addressSnapshot as AddressSnapshot;
    const active = ACTIVE_DELIVERY.includes(o.status);
    const area = { city: address.city, state: address.state, pincode: address.pincode };

    // DPDP: a delivery partner sees the retailer's address and phone only during an active delivery.
    const fullAddress = viewer === 'retailer' || viewer === 'admin' || (viewer === 'delivery' && active);
    const showPickup = viewer === 'admin' || (viewer === 'delivery' && active);
    const [partner] = o.deliveryPartnerId
      ? await this.db
          .select({ id: users.id, name: users.name, phone: users.phone })
          .from(users)
          .where(eq(users.id, o.deliveryPartnerId))
      : [];
    const [pickup] = showPickup
      ? await this.db
          .select({
            businessName: wholesalerProfiles.businessName,
            addressLine: wholesalerProfiles.addressLine,
            city: wholesalerProfiles.city,
            state: wholesalerProfiles.state,
            pincode: wholesalerProfiles.pincode,
            latitude: wholesalerProfiles.latitude,
            longitude: wholesalerProfiles.longitude,
            phone: users.phone,
          })
          .from(wholesalerProfiles)
          .innerJoin(users, eq(users.id, wholesalerProfiles.userId))
          .where(eq(wholesalerProfiles.userId, o.wholesalerId))
      : [];

    return {
      ...this.summary(o, row.businessName, row.shopName, items.length),
      subtotalPaise: o.subtotalPaise,
      discountPaise: o.discountPaise,
      deliveryFeePaise: o.deliveryFeePaise,
      commissionPaise: viewer === 'retailer' || viewer === 'delivery' ? null : o.commissionPaise,
      address: fullAddress ? address : area,
      deliveryPartner: partner
        ? { id: partner.id, name: partner.name, phone: active || viewer === 'admin' ? partner.phone : null }
        : null,
      deliveryAccepted: o.deliveryAcceptedAt !== null,
      deliveryOtp:
        viewer === 'retailer' && (o.status === 'picked_up' || o.status === 'out_for_delivery')
          ? deliveryOtp(this.otpSecret, o.id)
          : null,
      pickup: pickup ?? null,
      items: items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        productName: i.productName,
        variantName: i.variantName,
        hsnCode: i.hsnCode,
        gstRateBps: i.gstRateBps,
        qty: i.qty,
        unitPricePaise: i.unitPricePaise,
        lineTotalPaise: i.lineTotalPaise,
      })),
      timeline: events.map((e) => ({ status: e.status, note: e.note, at: e.createdAt.toISOString() })),
      cancelReason: o.cancelReason,
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
    };
  }

  private summary(o: OrderRow, businessName: string, shopName: string, itemCount: number): OrderSummary {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      totalPaise: o.totalPaise,
      itemCount,
      wholesaler: { id: o.wholesalerId, businessName },
      retailer: { id: o.retailerId, shopName },
      createdAt: o.createdAt.toISOString(),
    };
  }

  // ================================================================ status changes

  async transition(
    viewer: OrderViewer,
    userId: string,
    orderId: string,
    action: OrderAction,
    note: string | null,
    ip: string,
  ): Promise<OrderDetail> {
    const rule = TRANSITIONS[action];
    if (!(rule.by as readonly OrderViewer[]).includes(viewer)) throw new Error(`${viewer} cannot ${action}`);

    await this.db.transaction(async (tx) => {
      const [o] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(and(eq(orders.id, orderId), this.scope(viewer, userId)))
        .for('update');
      if (!o) throw notFound('ORDER_NOT_FOUND', 'Order not found');
      if (!(rule.from as readonly OrderStatus[]).includes(o.status)) {
        throw conflict('INVALID_STATUS_TRANSITION', `An order that is ${o.status.replace(/_/g, ' ')} cannot be changed this way`);
      }

      await tx
        .update(orders)
        .set({ status: rule.to, ...(rule.to === 'cancelled' ? { cancelReason: note } : {}) })
        .where(eq(orders.id, orderId));
      await tx.insert(orderEvents).values({ orderId, status: rule.to, actorId: userId, note });
      // Packed = ready to dispatch: the GST invoice is issued now.
      if (rule.to === 'packed') await assignInvoice(tx, orderId);

      if (rule.to === 'cancelled') {
        // Goods never left the wholesaler, so the stock goes back on sale.
        const items = await tx
          .select({ variantId: orderItems.variantId, qty: orderItems.qty })
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId))
          .orderBy(asc(orderItems.variantId));
        for (const i of items) {
          await tx
            .update(productVariants)
            .set({ stockQty: sql`${productVariants.stockQty} + ${i.qty}` })
            .where(eq(productVariants.id, i.variantId));
        }
      }
      if (viewer === 'admin') {
        await audit(tx, {
          actorId: userId,
          action: `order.${action}`,
          entity: 'order',
          entityId: orderId,
          data: { from: o.status, ...(note ? { note } : {}) },
          ip,
        });
      }
    });
    this.notifications.orderChanged(orderId, rule.to);
    return this.get(viewer, userId, orderId);
  }
}
