import { and, asc, count, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { banners, couponRedemptions, coupons } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { Storage } from '../../lib/storage.js';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';

// ---------------------------------------------------------------- schemas

const dateTime = z.coerce.date();

const couponFields = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,20}$/, 'Use 3–20 letters and digits'),
  description: z.string().trim().max(200).nullable().optional(),
  discountType: z.enum(['percent', 'flat']),
  /** Basis points for percent (1000 = 10%), paise for flat. */
  discountValue: z.number().int().positive(),
  maxDiscountPaise: z.number().int().positive().nullable().optional(),
  minOrderPaise: z.number().int().min(0).default(0),
  usageLimit: z.number().int().positive().nullable().optional(),
  perUserLimit: z.number().int().min(1).max(100).default(1),
  startsAt: dateTime.nullable().optional(),
  endsAt: dateTime.nullable().optional(),
  isActive: z.boolean().default(true),
});

function checkCoupon(c: {
  discountType?: 'percent' | 'flat' | undefined;
  discountValue?: number | undefined;
  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;
}) {
  if (c.discountType === 'percent' && c.discountValue !== undefined && c.discountValue > 10_000) {
    throw badRequest('INVALID_COUPON', 'A percentage discount cannot exceed 100%');
  }
  if (c.startsAt && c.endsAt && c.endsAt <= c.startsAt) {
    throw badRequest('INVALID_COUPON', 'The end date must be after the start date');
  }
}

export const couponCreate = couponFields;
// The code is fixed once created: redemptions and receipts refer to it.
export const couponUpdate = couponFields.omit({ code: true }).partial();

const linkTypes = ['none', 'category', 'product', 'brand'] as const;
const bannerFields = z.object({
  title: z.string().trim().min(1).max(100),
  imageKey: z.string().regex(/^banners\/[0-9a-f-]{36}\.webp$/, 'Upload the image via /v1/admin/uploads first'),
  linkType: z.enum(linkTypes).default('none'),
  linkValue: z.uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
  startsAt: dateTime.nullable().optional(),
  endsAt: dateTime.nullable().optional(),
});
export const bannerCreate = bannerFields;
export const bannerUpdate = bannerFields.partial();

function checkBanner(b: { linkType?: string | undefined; linkValue?: string | null | undefined }) {
  if (b.linkType && b.linkType !== 'none' && !b.linkValue) {
    throw badRequest('INVALID_BANNER', 'Choose what the banner links to');
  }
}

// ---------------------------------------------------------------- service

type CouponRow = typeof coupons.$inferSelect;
type BannerRow = typeof banners.$inferSelect;

export interface PublicBanner {
  id: string;
  title: string;
  imageUrl: string;
  linkType: string;
  linkValue: string | null;
}

const BANNER_CACHE_MS = 60_000;

export class MarketingService {
  private bannerCache: { at: number; items: PublicBanner[] } | null = null;

  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
  ) {}

  // ---- coupons (admin)

  async listCoupons() {
    const rows = await this.db
      .select({ coupon: coupons, used: count(couponRedemptions.id) })
      .from(coupons)
      .leftJoin(couponRedemptions, eq(couponRedemptions.couponId, coupons.id))
      .groupBy(coupons.id)
      .orderBy(desc(coupons.createdAt));
    return rows.map((r) => ({ ...r.coupon, timesUsed: r.used }));
  }

  async createCoupon(adminId: string, input: z.infer<typeof couponCreate>, ip: string): Promise<CouponRow> {
    checkCoupon(input);
    try {
      const [c] = await this.db.insert(coupons).values(input).returning();
      await audit(this.db, { actorId: adminId, action: 'coupon.create', entity: 'coupon', entityId: c?.id, data: { code: input.code }, ip });
      return c as CouponRow;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('COUPON_CODE_TAKEN', 'A coupon with this code already exists');
      throw err;
    }
  }

  async updateCoupon(adminId: string, id: string, input: z.infer<typeof couponUpdate>, ip: string): Promise<CouponRow> {
    const [current] = await this.db.select().from(coupons).where(eq(coupons.id, id));
    if (!current) throw notFound('COUPON_NOT_FOUND', 'Coupon not found');
    checkCoupon({
      discountType: input.discountType ?? current.discountType,
      discountValue: input.discountValue ?? current.discountValue,
      startsAt: input.startsAt === undefined ? current.startsAt : input.startsAt,
      endsAt: input.endsAt === undefined ? current.endsAt : input.endsAt,
    });
    const [c] = await this.db.update(coupons).set(input).where(eq(coupons.id, id)).returning();
    await audit(this.db, { actorId: adminId, action: 'coupon.update', entity: 'coupon', entityId: id, data: input, ip });
    return c as CouponRow;
  }

  // ---- banners

  /** Live banners for the app's home screen: active and within their date window. */
  async activeBanners(): Promise<PublicBanner[]> {
    if (this.bannerCache && Date.now() - this.bannerCache.at < BANNER_CACHE_MS) return this.bannerCache.items;
    const now = new Date();
    const rows = await this.db
      .select()
      .from(banners)
      .where(
        and(
          eq(banners.isActive, true),
          or(isNull(banners.startsAt), lte(banners.startsAt, now)),
          or(isNull(banners.endsAt), gt(banners.endsAt, now)),
        ),
      )
      .orderBy(asc(banners.sortOrder), desc(banners.createdAt));
    const items = rows.map((b) => ({
      id: b.id,
      title: b.title,
      imageUrl: this.storage.publicUrl(b.imageKey),
      linkType: b.linkType,
      linkValue: b.linkValue,
    }));
    this.bannerCache = { at: Date.now(), items };
    return items;
  }

  async listBanners(): Promise<(BannerRow & { imageUrl: string })[]> {
    const rows = await this.db.select().from(banners).orderBy(asc(banners.sortOrder), desc(banners.createdAt));
    return rows.map((b) => ({ ...b, imageUrl: this.storage.publicUrl(b.imageKey) }));
  }

  async createBanner(adminId: string, input: z.infer<typeof bannerCreate>, ip: string): Promise<BannerRow> {
    checkBanner(input);
    const [b] = await this.db.insert(banners).values(input).returning();
    this.bannerCache = null;
    await audit(this.db, { actorId: adminId, action: 'banner.create', entity: 'banner', entityId: b?.id, ip });
    return b as BannerRow;
  }

  async updateBanner(adminId: string, id: string, input: z.infer<typeof bannerUpdate>, ip: string): Promise<BannerRow> {
    const [current] = await this.db.select().from(banners).where(eq(banners.id, id));
    if (!current) throw notFound('BANNER_NOT_FOUND', 'Banner not found');
    checkBanner({
      linkType: input.linkType ?? current.linkType,
      linkValue: input.linkValue === undefined ? current.linkValue : input.linkValue,
    });
    const [b] = await this.db.update(banners).set(input).where(eq(banners.id, id)).returning();
    this.bannerCache = null;
    await audit(this.db, { actorId: adminId, action: 'banner.update', entity: 'banner', entityId: id, data: input, ip });
    return b as BannerRow;
  }

  async deleteBanner(adminId: string, id: string, ip: string): Promise<void> {
    const deleted = await this.db.delete(banners).where(eq(banners.id, id)).returning({ id: banners.id });
    if (deleted.length === 0) throw notFound('BANNER_NOT_FOUND', 'Banner not found');
    this.bannerCache = null;
    await audit(this.db, { actorId: adminId, action: 'banner.delete', entity: 'banner', entityId: id, ip });
  }
}

// ---------------------------------------------------------------- routes

interface Deps {
  marketing: MarketingService;
  authenticate: Authenticate;
}
const idParams = z.object({ id: z.uuid() });
const me = (req: FastifyRequest) => currentUser(req).id;
const id = (req: FastifyRequest) => parse(idParams, req.params).id;

/** Mounted at /v1. Home-screen banners for signed-in business users. */
export const bannerRoutes: FastifyPluginAsync<Deps> = async (app, { marketing, authenticate }) => {
  app.get('/banners', { preHandler: authenticate({ roles: ['retailer', 'wholesaler', 'admin'] }) }, async (_req, reply) => {
    void reply.header('cache-control', 'private, max-age=60');
    return { items: await marketing.activeBanners() };
  });
};

/** Mounted at /v1/admin. */
export const adminMarketingRoutes: FastifyPluginAsync<Deps> = async (app, { marketing, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['admin'] }));

  app.get('/coupons', async () => ({ items: await marketing.listCoupons() }));
  app.post('/coupons', async (req, reply) =>
    reply.status(201).send(await marketing.createCoupon(me(req), parse(couponCreate, req.body), req.ip)),
  );
  app.patch('/coupons/:id', async (req) => marketing.updateCoupon(me(req), id(req), parse(couponUpdate, req.body), req.ip));

  app.get('/banners', async () => ({ items: await marketing.listBanners() }));
  app.post('/banners', async (req, reply) =>
    reply.status(201).send(await marketing.createBanner(me(req), parse(bannerCreate, req.body), req.ip)),
  );
  app.patch('/banners/:id', async (req) => marketing.updateBanner(me(req), id(req), parse(bannerUpdate, req.body), req.ip));
  app.delete('/banners/:id', async (req, reply) => {
    await marketing.deleteBanner(me(req), id(req), req.ip);
    return reply.status(204).send();
  });
};
