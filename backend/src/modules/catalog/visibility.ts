import { sql, type SQL } from 'drizzle-orm';

/**
 * The single definition of "a buyer can see and buy this product". Used by browsing, the cart and checkout.
 * Expects the aliases: p = products, c = categories, b = brands (LEFT JOIN).
 */
export function publicProductFilters(): SQL[] {
  return [
    sql`p.status = 'active'`,
    sql`c.is_active AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM categories pc WHERE pc.id = c.parent_id AND pc.is_active))`,
    sql`(p.brand_id IS NULL OR b.is_active)`,
    sql`EXISTS (SELECT 1 FROM product_variants av WHERE av.product_id = p.id AND av.is_active)`,
  ];
}

/** Joins that publicProductFilters() relies on, starting from `products p`. */
export const publicProductJoins = sql`
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id`;

/**
 * Units of a variant that can be sold now: the stock of every active offer from an approved,
 * live wholesaler. `variantId` is a SQL expression such as sql`v.id`.
 */
export function availableStock(variantId: SQL): SQL {
  return sql`(SELECT COALESCE(SUM(so.stock_qty), 0) FROM supplier_offers so
    JOIN users su ON su.id = so.wholesaler_id
    WHERE so.variant_id = ${variantId} AND so.is_active AND su.status = 'approved' AND su.deleted_at IS NULL)`;
}
