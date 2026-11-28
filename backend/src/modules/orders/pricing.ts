/**
 * Order money maths. Pure functions over integer paise, so they are easy to test and audit.
 * Prices are GST-inclusive (they are capped by MRP, which is inclusive by law).
 */

export interface OrderTotals {
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  totalPaise: number;
}

/** Totals of one order; the discount never exceeds the subtotal. */
export function orderTotals(subtotalPaise: number, discountPaise: number, deliveryFeePaise: number): OrderTotals {
  const discount = Math.min(discountPaise, subtotalPaise);
  return { subtotalPaise, discountPaise: discount, deliveryFeePaise, totalPaise: subtotalPaise - discount + deliveryFeePaise };
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

/**
 * Splitting an order across wholesalers: the coupon discount is shared by subtotal, and the
 * delivery fee stays on the first part (the retailer paid it once). The parts add up exactly
 * to the original order.
 */
export function splitTotals(
  partSubtotals: readonly number[],
  original: Pick<OrderTotals, 'discountPaise' | 'deliveryFeePaise'>,
): OrderTotals[] {
  const discounts = allocate(original.discountPaise, partSubtotals);
  return partSubtotals.map((sub, i) => orderTotals(sub, discounts[i] as number, i === 0 ? original.deliveryFeePaise : 0));
}

/** Partpoint's margin on a forwarded order: goods value after discount, minus what the wholesaler is paid. */
export function marginFor(totals: Pick<OrderTotals, 'subtotalPaise' | 'discountPaise'>, supplyTotalPaise: number): number {
  return totals.subtotalPaise - totals.discountPaise - supplyTotalPaise;
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
