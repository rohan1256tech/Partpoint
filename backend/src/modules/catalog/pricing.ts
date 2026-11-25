/**
 * Bulk pricing. A variant has a base unit price; slabs lower the unit price once the
 * quantity reaches `minQty`. All amounts are integer paise.
 */
export interface Slab {
  minQty: number;
  pricePaise: number;
}

export interface PricedVariant {
  pricePaise: number;
  mrpPaise: number;
  minOrderQty: number;
  slabs: readonly Slab[];
}

export const MAX_SLABS = 5;

/** Unit price for `qty` units: the best slab reached, else the base price. */
export function unitPriceFor(variant: Pick<PricedVariant, 'pricePaise' | 'slabs'>, qty: number): number {
  let price = variant.pricePaise;
  let reached = 0;
  for (const s of variant.slabs) {
    if (qty >= s.minQty && s.minQty > reached) {
      reached = s.minQty;
      price = s.pricePaise;
    }
  }
  return price;
}

/** Returns a list of problems; empty when the pricing is consistent. */
export function pricingProblems(v: PricedVariant): string[] {
  const problems: string[] = [];
  if (v.pricePaise > v.mrpPaise) problems.push('Price cannot be higher than MRP');
  if (v.slabs.length > MAX_SLABS) problems.push(`At most ${MAX_SLABS} bulk price slabs`);

  const sorted = [...v.slabs].sort((a, b) => a.minQty - b.minQty);
  let prevQty = v.minOrderQty;
  let prevPrice = v.pricePaise;
  for (const s of sorted) {
    if (s.minQty <= prevQty) {
      problems.push(
        s.minQty <= v.minOrderQty
          ? `Slab quantity ${s.minQty} must be above the minimum order quantity (${v.minOrderQty})`
          : `Duplicate slab quantity ${s.minQty}`,
      );
    } else if (s.pricePaise >= prevPrice) {
      problems.push(`Slab for ${s.minQty}+ units must be cheaper than the previous price`);
    }
    prevQty = Math.max(prevQty, s.minQty);
    prevPrice = Math.min(prevPrice, s.pricePaise);
  }
  return problems;
}
