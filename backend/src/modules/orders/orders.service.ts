import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
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
  supplierOffers,
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
import type { forwardBody, listOrdersQuery, placeOrderBody } from './orders.schemas.js';
import { assignInvoice } from '../invoices/invoices.js';
import type { NotificationService } from '../notifications/notifications.service.js';
import { deliveryOtp } from './delivery-otp.js';
import { marginFor, splitTotals } from './pricing.js';
import { ORDER_PREFIX } from '../../lib/brand.js';

type OrderRow = typeof orders.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
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
  orders: { id: string; orderNumber: string; totalPaise: number }[];
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalPaise: number;
  itemCount: number;
  /** Who fulfils it. Never shown to the retailer, who buys from Partpoint. Null until forwarded. */
  wholesaler: { id: string; businessName: string } | null;
  retailer: { id: string; shopName: string };
  createdAt: string;
}

export interface OrderDetail extends OrderSummary {
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  /** Partpoint's margin; admin only. */
  commissionPaise: number | null;
  /** What Partpoint pays the wholesaler for these goods; wholesaler and admin only. */
  supplyTotalPaise: number | null;
  /**
   * Retailer and admin see the full delivery address. The wholesaler sees only the area,
   * since the delivery partner (not the wholesaler) takes the goods to the shop.
   */
  address: AddressSnapshot | { city: string; state: string; pincode: string };
  items: {
    id: string;
    productId: string;
    variantId: string;
    productName: string;
    variantName: string;
    hsnCode: string | null;
    gstRateBps: number;
    qty: number;
    unitPricePaise: number;
    lineTotalPaise: number;
    /** Wholesaler and admin only. */
    supplyUnitPricePaise: number | null;
  }[];
  timeline: { status: OrderStatus; note: string | null; at: string }[];
  /** Other parts of the same checkout, when the admin split it. */
  siblings: { id: string; orderNumber: string; status: OrderStatus }[];
  cancelReason: string | null;
  deliveredAt: string | null;
  /** Name and phone are shared only while the delivery is active. */
  deliveryPartner: { id: string; name: string; phone: string | null } | null;
  deliveryAccepted: boolean;
  /** Admin only: wrong delivery codes entered (locked at 5 until reset). */
  deliveryOtpAttempts: number | null;
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

/** For the admin choosing who fulfils an order. */
export interface SupplierOptions {
  orderId: string;
  status: OrderStatus;
  deliveryArea: { city: string; state: string; pincode: string };
  items: {
    id: string;
    productName: string;
    variantName: string;
    qty: number;
    unitPricePaise: number;
    offers: { wholesalerId: string; supplyPricePaise: number; stockQty: number }[];
  }[];
  wholesalers: {
    id: string;
    businessName: string;
    city: string;
    state: string;
    pincode: string;
    sameCity: boolean;
    /** Items this wholesaler has enough stock for. */
    itemIds: string[];
    coversAll: boolean;
    /** Supply cost of the items it covers. */
    supplyTotalPaise: number;
  }[];
  /** The cheapest wholesaler that can supply everything (same city preferred), if any. */
  suggestedWholesalerId: string | null;
}

/** Who may move an order from which states. Forwarding and hand-backs have their own methods. */
const TRANSITIONS = {
  accept: { by: ['wholesaler'], from: ['forwarded'], to: 'accepted' },
  pack: { by: ['wholesaler'], from: ['accepted'], to: 'packed' },
  cancelByRetailer: { by: ['retailer'], from: ['placed', 'forwarded'], to: 'cancelled' },
  cancelByAdmin: { by: ['admin'], from: ['placed', 'forwarded', 'accepted', 'packed', 'assigned'], to: 'cancelled' },
} as const satisfies Record<string, { by: readonly OrderViewer[]; from: readonly OrderStatus[]; to: OrderStatus }>;
export type OrderAction = keyof typeof TRANSITIONS;

/** Order number of a part of a split order: SC-20261127-000042-2. */
export function partNumber(orderNumber: string, part: number): string {
  const root = /^[A-Z]{2,4}-\d{8}-\d+/.exec(orderNumber)?.[0] ?? orderNumber;
  return `${root}-${part}`;
}

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
   * Turns the retailer's cart into one Partpoint order, in a single transaction. The order
   * waits for the admin to choose the wholesaler(s); stock is taken from them on forwarding.
   * The same idempotency key always returns the same result, so app retries are safe.
   * Payment is settled offline in v1 (no online payment).
   */
  async place(retailerId: string, input: z.infer<typeof placeOrderBody>): Promise<PlacedOrders> {
    const existing = await this.findPlaced(retailerId, input.idempotencyKey);
    if (existing) return existing;

    const address = snapshotOf(await this.addresses.getOwn(retailerId, input.addressId));

    try {
      const checkoutId = await this.db.transaction(async (tx) => {
        const lines = await tx
          .select({ variantId: cartItems.variantId })
          .from(cartItems)
          .where(eq(cartItems.userId, retailerId));
        if (lines.length === 0) throw badRequest('CART_EMPTY', 'Your cart is empty');

        // Lock in a fixed order so a concurrent product edit cannot change prices mid-checkout.
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

        const [seq] = (await tx.execute<{ n: string }>(sql`SELECT nextval('order_number_seq') AS n`)).rows;
        const [order] = await tx
          .insert(orders)
          .values({
            orderNumber: `${ORDER_PREFIX}-${istDate(new Date()).replace(/-/g, '')}-${String(seq?.n).padStart(6, '0')}`,
            checkoutId: id,
            retailerId,
            wholesalerId: null,
            status: 'placed',
            addressSnapshot: address,
            subtotalPaise: cart.subtotalPaise,
            discountPaise: cart.discountPaise,
            deliveryFeePaise: cart.deliveryFeePaise,
            totalPaise: cart.totalPaise,
            commissionPaise: 0,
          })
          .returning({ id: orders.id });
        const orderId = (order as { id: string }).id;

        await tx.insert(orderItems).values(
          cart.lines.map((l) => {
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

        if (couponId) await tx.insert(couponRedemptions).values({ couponId, userId: retailerId, checkoutId: id });
        await tx.delete(cartItems).where(eq(cartItems.userId, retailerId));
        return id;
      });
      return (await this.placedById(checkoutId)) as PlacedOrders;
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
      .select({ id: orders.id, orderNumber: orders.orderNumber, totalPaise: orders.totalPaise })
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
      .leftJoin(wholesalerProfiles, eq(wholesalerProfiles.userId, orders.wholesalerId))
      .innerJoin(retailerProfiles, eq(retailerProfiles.userId, orders.retailerId))
      .where(and(...filters))
      .orderBy(sql`${orders.createdAt} DESC, ${orders.id} DESC`)
      .limit(q.limit + 1);

    const mapped = rows.map((r) => ({
      id: r.order.id,
      createdAt: r.order.createdAt,
      summary: this.summary(viewer, r.order, r.businessName, r.shopName, r.itemCount),
    }));
    const { page, nextCursor } = paginate(mapped, q.limit);
    return { items: page.map((p) => p.summary), nextCursor };
  }

  async get(viewer: OrderViewer, userId: string, orderId: string): Promise<OrderDetail> {
    const [row] = await this.db
      .select({ order: orders, businessName: wholesalerProfiles.businessName, shopName: retailerProfiles.shopName })
      .from(orders)
      .leftJoin(wholesalerProfiles, eq(wholesalerProfiles.userId, orders.wholesalerId))
      .innerJoin(retailerProfiles, eq(retailerProfiles.userId, orders.retailerId))
      .where(and(eq(orders.id, orderId), this.scope(viewer, userId)));
    // Someone else's order looks exactly like a missing one.
    if (!row) throw notFound('ORDER_NOT_FOUND', 'Order not found');

    const o = row.order;
    const [items, events, siblings] = await Promise.all([
      this.db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.productName)),
      this.db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId)).orderBy(asc(orderEvents.createdAt)),
      viewer === 'retailer' || viewer === 'admin'
        ? this.db
            .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status })
            .from(orders)
            .where(and(eq(orders.checkoutId, o.checkoutId), sql`${orders.id} <> ${orderId}`))
            .orderBy(asc(orders.orderNumber))
        : Promise.resolve([]),
    ]);
    const address = o.addressSnapshot as AddressSnapshot;
    const active = ACTIVE_DELIVERY.includes(o.status);
    const area = { city: address.city, state: address.state, pincode: address.pincode };
    const seesSupply = viewer === 'wholesaler' || viewer === 'admin';

    // DPDP: a delivery partner sees the retailer's address and phone only during an active delivery.
    const fullAddress = viewer === 'retailer' || viewer === 'admin' || (viewer === 'delivery' && active);
    const showPickup = o.wholesalerId !== null && (viewer === 'admin' || (viewer === 'delivery' && active));
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
          .where(eq(wholesalerProfiles.userId, o.wholesalerId as string))
      : [];

    const supplyTotal = items.every((i) => i.supplyUnitPricePaise !== null)
      ? items.reduce((s, i) => s + (i.supplyUnitPricePaise as number) * i.qty, 0)
      : null;

    return {
      ...this.summary(viewer, o, row.businessName, row.shopName, items.length),
      subtotalPaise: o.subtotalPaise,
      discountPaise: o.discountPaise,
      deliveryFeePaise: o.deliveryFeePaise,
      commissionPaise: viewer === 'admin' && o.wholesalerId ? o.commissionPaise : null,
      supplyTotalPaise: seesSupply ? supplyTotal : null,
      address: fullAddress ? address : area,
      deliveryPartner: partner
        ? { id: partner.id, name: partner.name, phone: active || viewer === 'admin' ? partner.phone : null }
        : null,
      deliveryAccepted: o.deliveryAcceptedAt !== null,
      deliveryOtpAttempts: viewer === 'admin' ? o.deliveryOtpAttempts : null,
      deliveryOtp:
        viewer === 'retailer' && (o.status === 'picked_up' || o.status === 'out_for_delivery')
          ? deliveryOtp(this.otpSecret, o.id)
          : null,
      pickup: pickup ?? null,
      items: items.map((i) => ({
        id: i.id,
        productId: i.productId,
        variantId: i.variantId,
        productName: i.productName,
        variantName: i.variantName,
        hsnCode: i.hsnCode,
        gstRateBps: i.gstRateBps,
        qty: i.qty,
        unitPricePaise: i.unitPricePaise,
        lineTotalPaise: i.lineTotalPaise,
        supplyUnitPricePaise: seesSupply ? i.supplyUnitPricePaise : null,
      })),
      timeline: this.timeline(viewer, events),
      siblings,
      cancelReason: o.cancelReason,
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
    };
  }

  /**
   * The retailer sees Partpoint's progress, not the sourcing behind it: forwarding steps,
   * hand-backs between wholesalers and their notes stay with the admin.
   */
  private timeline(
    viewer: OrderViewer,
    events: (typeof orderEvents.$inferSelect)[],
  ): OrderDetail['timeline'] {
    const all = events.map((e) => ({ status: e.status, note: e.note, at: e.createdAt.toISOString() }));
    if (viewer === 'admin') return all;
    if (viewer === 'wholesaler') {
      // A wholesaler sees the order from when it was forwarded to them.
      const from = all.map((e) => e.status).lastIndexOf('forwarded');
      return from < 0 ? all : all.slice(from).map((e) => (e.status === 'forwarded' ? { ...e, note: null } : e));
    }
    // When it was placed, then only the current round of fulfilment (after any hand-back).
    const statuses = all.map((e) => e.status);
    const start = Math.max(statuses.lastIndexOf('placed'), statuses.lastIndexOf('forwarded'));
    const [first] = all;
    if (!first) return [];
    const later = all
      .slice(Math.max(start, 0) + 1)
      .filter((e) => e.status !== 'forwarded' && e.status !== 'placed')
      .map((e) => (e.status === 'accepted' ? { ...e, note: null } : e));
    return [{ ...first, note: null }, ...later];
  }

  private summary(
    viewer: OrderViewer,
    o: OrderRow,
    businessName: string | null,
    shopName: string,
    itemCount: number,
  ): OrderSummary {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      totalPaise: o.totalPaise,
      itemCount,
      wholesaler:
        viewer !== 'retailer' && o.wholesalerId ? { id: o.wholesalerId, businessName: businessName ?? '' } : null,
      retailer: { id: o.retailerId, shopName },
      createdAt: o.createdAt.toISOString(),
    };
  }

  // ================================================================ admin: choosing wholesalers

  /** Who can supply each item of a waiting order, and at what cost. */
  async supplierOptions(orderId: string): Promise<SupplierOptions> {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (!o) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.productName));
    const address = o.addressSnapshot as AddressSnapshot;

    const offers = items.length
      ? await this.db
          .select({
            variantId: supplierOffers.variantId,
            wholesalerId: supplierOffers.wholesalerId,
            supplyPricePaise: supplierOffers.supplyPricePaise,
            stockQty: supplierOffers.stockQty,
            businessName: wholesalerProfiles.businessName,
            city: wholesalerProfiles.city,
            state: wholesalerProfiles.state,
            pincode: wholesalerProfiles.pincode,
          })
          .from(supplierOffers)
          .innerJoin(users, eq(users.id, supplierOffers.wholesalerId))
          .innerJoin(wholesalerProfiles, eq(wholesalerProfiles.userId, supplierOffers.wholesalerId))
          .where(
            and(
              inArray(
                supplierOffers.variantId,
                items.map((i) => i.variantId),
              ),
              eq(supplierOffers.isActive, true),
              eq(users.status, 'approved'),
              isNull(users.deletedAt),
            ),
          )
          .orderBy(asc(supplierOffers.supplyPricePaise))
      : [];

    const byWholesaler = new Map<string, SupplierOptions['wholesalers'][number]>();
    for (const off of offers) {
      if (!byWholesaler.has(off.wholesalerId)) {
        byWholesaler.set(off.wholesalerId, {
          id: off.wholesalerId,
          businessName: off.businessName,
          city: off.city,
          state: off.state,
          pincode: off.pincode,
          sameCity: off.city.trim().toLowerCase() === address.city.trim().toLowerCase(),
          itemIds: [],
          coversAll: false,
          supplyTotalPaise: 0,
        });
      }
    }
    // The same variant can appear only once per order, so per-item stock checks are exact.
    for (const item of items) {
      for (const off of offers) {
        if (off.variantId !== item.variantId || off.stockQty < item.qty) continue;
        const w = byWholesaler.get(off.wholesalerId) as SupplierOptions['wholesalers'][number];
        w.itemIds.push(item.id);
        w.supplyTotalPaise += off.supplyPricePaise * item.qty;
      }
    }
    const wholesalers = [...byWholesaler.values()]
      .map((w) => ({ ...w, coversAll: items.length > 0 && w.itemIds.length === items.length }))
      .sort(
        (a, b) =>
          Number(b.coversAll) - Number(a.coversAll) ||
          b.itemIds.length - a.itemIds.length ||
          Number(b.sameCity) - Number(a.sameCity) ||
          a.supplyTotalPaise - b.supplyTotalPaise,
      );
    const full = wholesalers.filter((w) => w.coversAll);
    const cheapest = Math.min(...full.map((w) => w.supplyTotalPaise));
    // Same city wins when it costs at most 2% more: faster delivery is worth a little.
    const suggested =
      full.find((w) => w.sameCity && w.supplyTotalPaise <= cheapest * 1.02) ??
      full.find((w) => w.supplyTotalPaise === cheapest) ??
      null;

    return {
      orderId,
      status: o.status,
      deliveryArea: { city: address.city, state: address.state, pincode: address.pincode },
      items: items.map((i) => ({
        id: i.id,
        productName: i.productName,
        variantName: i.variantName,
        qty: i.qty,
        unitPricePaise: i.unitPricePaise,
        offers: offers
          .filter((off) => off.variantId === i.variantId)
          .map((off) => ({ wholesalerId: off.wholesalerId, supplyPricePaise: off.supplyPricePaise, stockQty: off.stockQty })),
      })),
      wholesalers,
      suggestedWholesalerId: suggested?.id ?? null,
    };
  }

  /**
   * Sends a waiting order to the chosen wholesaler(s). Each item goes to one wholesaler; when
   * they differ, the order is split into parts (one per wholesaler) that add up to the original.
   * Stock comes out of each wholesaler's offer now, and their supply prices are frozen.
   */
  async forward(adminId: string, orderId: string, input: z.infer<typeof forwardBody>, ip: string): Promise<OrderDetail> {
    const created: string[] = [];
    await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!o) throw notFound('ORDER_NOT_FOUND', 'Order not found');
      if (o.status !== 'placed' || o.wholesalerId !== null) {
        throw conflict('INVALID_STATUS_TRANSITION', 'Only orders waiting for a wholesaler can be forwarded');
      }
      // Serialises numbering of the parts of this checkout.
      await tx.select({ id: checkouts.id }).from(checkouts).where(eq(checkouts.id, o.checkoutId)).for('update');

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.id));
      const pick = new Map<string, string>();
      for (const a of input.assignments ?? []) {
        if (!items.some((i) => i.id === a.itemId)) throw badRequest('INVALID_ITEM', 'An item does not belong to this order');
        pick.set(a.itemId, a.wholesalerId);
      }
      for (const i of items) {
        if (!pick.has(i.id) && input.wholesalerId) pick.set(i.id, input.wholesalerId);
        if (!pick.has(i.id)) throw badRequest('ITEM_UNASSIGNED', `Choose a wholesaler for ${i.productName}`);
      }

      const chosen = [...new Set(pick.values())];
      const okWholesalers = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, chosen), eq(users.role, 'wholesaler'), eq(users.status, 'approved'), isNull(users.deletedAt)));
      if (okWholesalers.length !== chosen.length) {
        throw badRequest('INVALID_WHOLESALER', 'Choose approved wholesalers only');
      }

      // Take stock from each offer, locking offers in a fixed order so forwards cannot deadlock.
      const sorted = [...items].sort((a, b) =>
        `${pick.get(a.id)}${a.variantId}`.localeCompare(`${pick.get(b.id)}${b.variantId}`),
      );
      for (const i of sorted) {
        const wholesalerId = pick.get(i.id) as string;
        const [offer] = await tx
          .select()
          .from(supplierOffers)
          .where(and(eq(supplierOffers.wholesalerId, wholesalerId), eq(supplierOffers.variantId, i.variantId)))
          .for('update');
        if (!offer?.isActive || offer.stockQty < i.qty) {
          throw conflict(
            'SUPPLIER_OUT_OF_STOCK',
            `The chosen wholesaler has ${offer?.isActive ? offer.stockQty : 0} of ${i.productName} (${i.variantName}); ${i.qty} needed`,
          );
        }
        await tx
          .update(supplierOffers)
          .set({ stockQty: sql`${supplierOffers.stockQty} - ${i.qty}` })
          .where(eq(supplierOffers.id, offer.id));
        await tx.update(orderItems).set({ supplyUnitPricePaise: offer.supplyPricePaise }).where(eq(orderItems.id, i.id));
        i.supplyUnitPricePaise = offer.supplyPricePaise;
      }

      // Parts in order of first appearance; the first part keeps the original order.
      const parts = chosen.map((wholesalerId) => ({
        wholesalerId,
        items: items.filter((i) => pick.get(i.id) === wholesalerId),
      }));
      const totals = splitTotals(
        parts.map((p) => p.items.reduce((s, i) => s + i.lineTotalPaise, 0)),
        o,
      );
      const [existing] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .where(eq(orders.checkoutId, o.checkoutId));
      let nextPart = (existing?.n ?? 1) + 1;

      for (const [idx, part] of parts.entries()) {
        const t = totals[idx] as (typeof totals)[number];
        const supply = part.items.reduce((s, i) => s + (i.supplyUnitPricePaise as number) * i.qty, 0);
        const values = {
          wholesalerId: part.wholesalerId,
          status: 'forwarded' as const,
          subtotalPaise: t.subtotalPaise,
          discountPaise: t.discountPaise,
          deliveryFeePaise: t.deliveryFeePaise,
          totalPaise: t.totalPaise,
          commissionPaise: marginFor(t, supply),
        };
        let partId = orderId;
        if (idx === 0) {
          await tx.update(orders).set(values).where(eq(orders.id, orderId));
        } else {
          const [row] = await tx
            .insert(orders)
            .values({
              ...values,
              orderNumber: partNumber(o.orderNumber, nextPart++),
              checkoutId: o.checkoutId,
              retailerId: o.retailerId,
              addressSnapshot: o.addressSnapshot,
              createdAt: o.createdAt,
            })
            .returning({ id: orders.id, orderNumber: orders.orderNumber });
          partId = (row as { id: string }).id;
          created.push(partId);
          await tx
            .update(orderItems)
            .set({ orderId: partId })
            .where(
              inArray(
                orderItems.id,
                part.items.map((i) => i.id),
              ),
            );
          await tx.insert(orderEvents).values({
            orderId: partId,
            status: 'placed',
            actorId: o.retailerId,
            note: `Split from ${o.orderNumber}`,
            createdAt: o.createdAt,
          });
        }
        await tx.insert(orderEvents).values({ orderId: partId, status: 'forwarded', actorId: adminId });
      }

      await audit(tx, {
        actorId: adminId,
        action: 'order.forward',
        entity: 'order',
        entityId: orderId,
        data: { parts: parts.map((p) => ({ wholesalerId: p.wholesalerId, items: p.items.map((i) => i.id) })) },
        ip,
      });
    });
    for (const id of [orderId, ...created]) this.notifications.orderChanged(id, 'forwarded');
    return this.get('admin', adminId, orderId);
  }

  /**
   * A wholesaler that cannot fulfil a forwarded order hands it back to the admin, who forwards
   * it to someone else. Their stock is restored. The retailer's order is not cancelled.
   */
  async handBack(wholesalerId: string, orderId: string, reason: string): Promise<{ ok: true }> {
    await this.db.transaction(async (tx) => {
      const [o] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.wholesalerId, wholesalerId)))
        .for('update');
      if (!o) throw notFound('ORDER_NOT_FOUND', 'Order not found');
      if (o.status !== 'forwarded' && o.status !== 'accepted') {
        throw conflict('INVALID_STATUS_TRANSITION', `An order that is ${o.status.replace(/_/g, ' ')} cannot be handed back`);
      }
      await this.restoreStock(tx, orderId, wholesalerId);
      await tx.update(orderItems).set({ supplyUnitPricePaise: null }).where(eq(orderItems.orderId, orderId));
      await tx
        .update(orders)
        .set({ status: 'placed', wholesalerId: null, commissionPaise: 0 })
        .where(eq(orders.id, orderId));
      await tx.insert(orderEvents).values({ orderId, status: 'placed', actorId: wholesalerId, note: `Returned by wholesaler: ${reason}` });
    });
    return { ok: true };
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
        .select({ status: orders.status, wholesalerId: orders.wholesalerId })
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

      // Goods never left the wholesaler, so the stock goes back on sale.
      if (rule.to === 'cancelled' && o.wholesalerId) await this.restoreStock(tx, orderId, o.wholesalerId);
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
    if (rule.to === 'packed') this.notifications.offerJob(orderId);
    return this.get(viewer, userId, orderId);
  }

  private async restoreStock(tx: Tx, orderId: string, wholesalerId: string): Promise<void> {
    const items = await tx
      .select({ variantId: orderItems.variantId, qty: orderItems.qty })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.variantId));
    for (const i of items) {
      await tx
        .update(supplierOffers)
        .set({ stockQty: sql`${supplierOffers.stockQty} + ${i.qty}` })
        .where(and(eq(supplierOffers.wholesalerId, wholesalerId), eq(supplierOffers.variantId, i.variantId)));
    }
  }
}
