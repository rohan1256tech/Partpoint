import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { cartItems } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { Storage } from '../../lib/storage.js';
import { unitPriceFor, type Slab } from '../catalog/pricing.js';
import { publicProductFilters, publicProductJoins } from '../catalog/visibility.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { CouponsService } from './coupons.service.js';
import { priceOrderGroups } from './pricing.js';

export const MAX_CART_LINES = 100;
export const MAX_LINE_QTY = 100_000;

type Executor = Pick<Database, 'execute'>;

/** Everything needed to price and order one variant, read in one query. */
export interface VariantLine {
  variantId: string;
  variantName: string;
  mrpPaise: number;
  pricePaise: number;
  stockQty: number;
  minOrderQty: number;
  slabs: Slab[];
  productId: string;
  productName: string;
  hsnCode: string | null;
  gstRateBps: number;
  wholesalerId: string;
  businessName: string;
  city: string;
  commissionBps: number | null;
  thumbKey: string | null;
  /** Buyer-visible product and active variant. */
  available: boolean;
}

export type LineIssue = 'UNAVAILABLE' | 'BELOW_MIN_QTY' | 'OUT_OF_STOCK';

export interface CartLine {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  thumbnailUrl: string | null;
  qty: number;
  unitPricePaise: number;
  mrpPaise: number;
  lineTotalPaise: number;
  minOrderQty: number;
  stockQty: number;
  issue: LineIssue | null;
}

export interface CartGroup {
  wholesaler: { id: string; businessName: string; city: string };
  lines: CartLine[];
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  /** Below the platform minimum order value for one wholesaler. */
  belowMinOrder: boolean;
}

export interface Cart {
  groups: CartGroup[];
  itemCount: number;
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  coupon: { code: string; discountPaise: number } | null;
  couponError: string | null;
  minOrderPaise: number;
  /** True when every line can be ordered as it is. */
  canCheckout: boolean;
}

/** Loads variants with product, wholesaler and visibility. Unknown ids are simply absent. */
export async function loadVariantLines(db: Executor, variantIds: readonly string[]): Promise<Map<string, VariantLine>> {
  if (variantIds.length === 0) return new Map();
  const ids = sql.join(
    variantIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const { rows } = await db.execute<{
    variant_id: string;
    variant_name: string;
    mrp_paise: string;
    price_paise: string;
    stock_qty: number;
    min_order_qty: number;
    slabs: Slab[];
    product_id: string;
    product_name: string;
    hsn_code: string | null;
    gst_rate_bps: number;
    wholesaler_id: string;
    business_name: string;
    city: string;
    commission_bps: number | null;
    thumb_key: string | null;
    available: boolean;
  }>(sql`
    SELECT v.id AS variant_id, v.name AS variant_name, v.mrp_paise, v.price_paise, v.stock_qty, v.min_order_qty,
           COALESCE((SELECT json_agg(json_build_object('minQty', s.min_qty, 'pricePaise', s.price_paise))
                     FROM price_slabs s WHERE s.variant_id = v.id), '[]'::json) AS slabs,
           p.id AS product_id, p.name AS product_name, p.hsn_code, p.gst_rate_bps, p.wholesaler_id,
           wp.business_name, wp.city, wp.commission_bps,
           (SELECT i.object_key FROM product_images i WHERE i.product_id = p.id
             ORDER BY i.sort_order, i.created_at LIMIT 1) AS thumb_key,
           (v.is_active AND ${sql.join(publicProductFilters(), sql` AND `)}) AS available
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    JOIN wholesaler_profiles wp ON wp.user_id = p.wholesaler_id
    ${publicProductJoins}
    WHERE v.id IN (${ids})`);

  return new Map(
    rows.map((r) => [
      r.variant_id,
      {
        variantId: r.variant_id,
        variantName: r.variant_name,
        mrpPaise: Number(r.mrp_paise),
        pricePaise: Number(r.price_paise),
        stockQty: r.stock_qty,
        minOrderQty: r.min_order_qty,
        slabs: r.slabs.map((s) => ({ minQty: Number(s.minQty), pricePaise: Number(s.pricePaise) })),
        productId: r.product_id,
        productName: r.product_name,
        hsnCode: r.hsn_code,
        gstRateBps: r.gst_rate_bps,
        wholesalerId: r.wholesaler_id,
        businessName: r.business_name,
        city: r.city,
        commissionBps: r.commission_bps,
        thumbKey: r.thumb_key,
        available: r.available,
      },
    ]),
  );
}

export class CartService {
  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
    private readonly settings: SettingsService,
    private readonly coupons: CouponsService,
  ) {}

  async get(retailerId: string, couponCode?: string): Promise<Cart> {
    return this.build(this.db, retailerId, couponCode);
  }

  async setQty(retailerId: string, variantId: string, qty: number): Promise<Cart> {
    const line = (await loadVariantLines(this.db, [variantId])).get(variantId);
    if (!line?.available) throw notFound('PRODUCT_NOT_FOUND', 'This item is not available');
    if (qty < line.minOrderQty) {
      throw badRequest('BELOW_MIN_QTY', `Minimum order quantity is ${line.minOrderQty}`);
    }
    if (qty > line.stockQty) throw badRequest('OUT_OF_STOCK', `Only ${line.stockQty} in stock`);

    const existing = await this.db.$count(cartItems, eq(cartItems.userId, retailerId));
    const [already] = await this.db
      .select({ v: cartItems.variantId })
      .from(cartItems)
      .where(and(eq(cartItems.userId, retailerId), eq(cartItems.variantId, variantId)));
    if (!already && existing >= MAX_CART_LINES) {
      throw badRequest('CART_FULL', `A cart can hold up to ${MAX_CART_LINES} different items`);
    }
    await this.db
      .insert(cartItems)
      .values({ userId: retailerId, variantId, qty })
      .onConflictDoUpdate({ target: [cartItems.userId, cartItems.variantId], set: { qty } });
    return this.get(retailerId);
  }

  async remove(retailerId: string, variantId: string): Promise<Cart> {
    await this.db.delete(cartItems).where(and(eq(cartItems.userId, retailerId), eq(cartItems.variantId, variantId)));
    return this.get(retailerId);
  }

  async clear(retailerId: string): Promise<void> {
    await this.db.delete(cartItems).where(eq(cartItems.userId, retailerId));
  }

  /**
   * Prices the cart. Order placement calls this inside its transaction (after locking the
   * variants), so the cart the retailer sees and the order use exactly the same rules.
   */
  async build(db: Pick<Database, 'select' | 'execute'>, retailerId: string, couponCode?: string): Promise<Cart> {
    const items = await db
      .select({ variantId: cartItems.variantId, qty: cartItems.qty })
      .from(cartItems)
      .where(eq(cartItems.userId, retailerId))
      .orderBy(asc(cartItems.updatedAt));
    const variants = await loadVariantLines(
      db,
      items.map((i) => i.variantId),
    );
    const settings = await this.settings.get();

    const groups = new Map<string, { wholesaler: CartGroup['wholesaler']; commissionBps: number | null; lines: CartLine[] }>();
    for (const item of items) {
      const v = variants.get(item.variantId);
      if (!v) continue; // variant deleted; cascades remove it shortly
      const unit = unitPriceFor(v, item.qty);
      const issue: LineIssue | null = !v.available
        ? 'UNAVAILABLE'
        : item.qty < v.minOrderQty
          ? 'BELOW_MIN_QTY'
          : item.qty > v.stockQty
            ? 'OUT_OF_STOCK'
            : null;
      const group = groups.get(v.wholesalerId) ?? {
        wholesaler: { id: v.wholesalerId, businessName: v.businessName, city: v.city },
        commissionBps: v.commissionBps,
        lines: [],
      };
      group.lines.push({
        variantId: v.variantId,
        productId: v.productId,
        productName: v.productName,
        variantName: v.variantName,
        thumbnailUrl: v.thumbKey ? this.storage.publicUrl(v.thumbKey) : null,
        qty: item.qty,
        unitPricePaise: unit,
        mrpPaise: v.mrpPaise,
        lineTotalPaise: unit * item.qty,
        minOrderQty: v.minOrderQty,
        stockQty: v.stockQty,
        issue,
      });
      groups.set(v.wholesalerId, group);
    }

    // Only orderable lines count towards money.
    const list = [...groups.values()];
    const subtotals = list.map((g) =>
      g.lines.filter((l) => !l.issue).reduce((sum, l) => sum + l.lineTotalPaise, 0),
    );
    const subtotalPaise = subtotals.reduce((a, b) => a + b, 0);

    let coupon: Cart['coupon'] = null;
    let couponError: string | null = null;
    if (couponCode) {
      const result = await this.coupons.evaluate(db, couponCode, retailerId, subtotalPaise);
      if (result.ok) coupon = { code: result.code, discountPaise: result.discountPaise };
      else couponError = result.error;
    }

    const orderable = list.map((g, i) => ({ g, subtotal: subtotals[i] as number })).filter((x) => x.subtotal > 0);
    const totals = priceOrderGroups(
      orderable.map((x) => ({ wholesalerId: x.g.wholesaler.id, subtotalPaise: x.subtotal, commissionBps: x.g.commissionBps })),
      {
        discountPaise: coupon?.discountPaise ?? 0,
        deliveryFeePaise: settings.deliveryFeePaise,
        defaultCommissionBps: settings.commissionBps,
      },
    );
    const byWholesaler = new Map(totals.map((t) => [t.wholesalerId, t]));

    const cartGroups: CartGroup[] = list.map((g, i) => {
      const t = byWholesaler.get(g.wholesaler.id);
      const subtotal = subtotals[i] as number;
      return {
        wholesaler: g.wholesaler,
        lines: g.lines,
        subtotalPaise: subtotal,
        discountPaise: t?.discountPaise ?? 0,
        deliveryFeePaise: t?.deliveryFeePaise ?? 0,
        totalPaise: t?.totalPaise ?? 0,
        belowMinOrder: subtotal > 0 && subtotal < settings.minOrderPaise,
      };
    });

    const allLines = cartGroups.flatMap((g) => g.lines);
    return {
      groups: cartGroups,
      itemCount: allLines.length,
      subtotalPaise,
      discountPaise: coupon?.discountPaise ?? 0,
      deliveryFeePaise: totals.reduce((s, t) => s + t.deliveryFeePaise, 0),
      totalPaise: totals.reduce((s, t) => s + t.totalPaise, 0),
      coupon,
      couponError,
      minOrderPaise: settings.minOrderPaise,
      canCheckout:
        allLines.length > 0 && allLines.every((l) => !l.issue) && cartGroups.every((g) => !g.belowMinOrder),
    };
  }
}
