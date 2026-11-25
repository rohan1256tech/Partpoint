import { and, count, eq } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { couponRedemptions, coupons } from '../../db/schema.js';
import { couponDiscount } from './pricing.js';

export type CouponResult =
  | { ok: true; couponId: string; code: string; discountPaise: number }
  | { ok: false; error: string };

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

/** Coupon eligibility. Admin CRUD for coupons arrives with the marketing module. */
export class CouponsService {
  async evaluate(
    db: Pick<Database, 'select'>,
    rawCode: string,
    userId: string,
    subtotalPaise: number,
    now = new Date(),
  ): Promise<CouponResult> {
    const code = rawCode.trim().toUpperCase();
    const [c] = await db.select().from(coupons).where(eq(coupons.code, code));
    if (!c || !c.isActive) return { ok: false, error: 'This coupon is not valid' };
    if (c.startsAt && c.startsAt > now) return { ok: false, error: 'This coupon is not active yet' };
    if (c.endsAt && c.endsAt <= now) return { ok: false, error: 'This coupon has expired' };
    if (subtotalPaise < c.minOrderPaise) {
      return { ok: false, error: `Add items worth ${rupees(c.minOrderPaise - subtotalPaise)} more to use this coupon` };
    }

    const [total] = await db.select({ n: count() }).from(couponRedemptions).where(eq(couponRedemptions.couponId, c.id));
    if (c.usageLimit !== null && (total?.n ?? 0) >= c.usageLimit) {
      return { ok: false, error: 'This coupon has been fully used' };
    }
    const [mine] = await db
      .select({ n: count() })
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.couponId, c.id), eq(couponRedemptions.userId, userId)));
    if ((mine?.n ?? 0) >= c.perUserLimit) return { ok: false, error: 'You have already used this coupon' };

    const discountPaise = couponDiscount(c, subtotalPaise);
    if (discountPaise <= 0) return { ok: false, error: 'This coupon does not apply to your cart' };
    return { ok: true, couponId: c.id, code: c.code, discountPaise };
  }
}
