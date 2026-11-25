import { sql, type SQL } from 'drizzle-orm';

/**
 * The single definition of "a buyer can see and buy this product". Used by browsing, the cart and checkout.
 * Expects the aliases: p = products, u = the wholesaler's users row, c = categories, b = brands (LEFT JOIN).
 */
export function publicProductFilters(): SQL[] {
  return [
    sql`p.status = 'active'`,
    sql`u.status = 'approved' AND u.deleted_at IS NULL`,
    sql`c.is_active AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM categories pc WHERE pc.id = c.parent_id AND pc.is_active))`,
    sql`(p.brand_id IS NULL OR b.is_active)`,
    sql`EXISTS (SELECT 1 FROM product_variants av WHERE av.product_id = p.id AND av.is_active)`,
  ];
}

/** Joins that publicProductFilters() relies on, starting from `products p`. */
export const publicProductJoins = sql`
  JOIN users u ON u.id = p.wholesaler_id
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id`;
