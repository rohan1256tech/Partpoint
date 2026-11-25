/**
 * Order money maths. Pure functions over integer paise, so they are easy to test and audit.
 * Prices are GST-inclusive (they are capped by MRP, which is inclusive by law).
 */

export interface PricedGroup {
  wholesalerId: string;
  subtotalPaise: number;
  /** Wholesaler-specific commission override, if any. */
  commissionBps: number | null;
}

export interface GroupTotals {
  wholesalerId: string;
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
  commissionPaise: number;
}

/**
 * Splits `total` across `weights` proportionally (largest-remainder method), so the parts
 * are whole paise and always add up to exactly `total`.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest-- <= 0) break;
    parts[i] = (parts[i] as number) + 1;
  }
  return parts;
}

export function commissionFor(goodsPaise: number, bps: number): number {
  return Math.floor((goodsPaise * bps) / 10_000);
}

/** Per-wholesaler totals: coupon discount shared by subtotal, flat delivery fee each, commission on goods. */
export function priceOrderGroups(
  groups: readonly PricedGroup[],
  opts: { discountPaise: number; deliveryFeePaise: number; defaultCommissionBps: number },
): GroupTotals[] {
  const discounts = allocate(
    opts.discountPaise,
    groups.map((g) => g.subtotalPaise),
  );
  return groups.map((g, i) => {
    const discountPaise = discounts[i] as number;
    const goods = g.subtotalPaise - discountPaise;
    return {
      wholesalerId: g.wholesalerId,
      subtotalPaise: g.subtotalPaise,
      discountPaise,
      deliveryFeePaise: opts.deliveryFeePaise,
      totalPaise: goods + opts.deliveryFeePaise,
      commissionPaise: commissionFor(goods, g.commissionBps ?? opts.defaultCommissionBps),
    };
  });
}

export interface CouponTerms {
  discountType: 'percent' | 'flat';
  /** Basis points when percent, paise when flat. */
  discountValue: number;
  maxDiscountPaise: number | null;
}

/** Discount for a subtotal; never more than the subtotal. */
export function couponDiscount(c: CouponTerms, subtotalPaise: number): number {
  const raw =
    c.discountType === 'percent' ? Math.floor((subtotalPaise * c.discountValue) / 10_000) : c.discountValue;
  const capped = c.maxDiscountPaise !== null ? Math.min(raw, c.maxDiscountPaise) : raw;
  return Math.max(0, Math.min(capped, subtotalPaise));
}
