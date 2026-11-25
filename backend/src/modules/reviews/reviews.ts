import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { orderItems, orders, products, reviewReports, reviews, users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { decodeCursor, paginate } from '../../lib/cursor.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';
import type { ProductsService } from '../catalog/products.service.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const reviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(1000).optional(),
});
const reportBody = z.object({ reason: z.string().trim().min(3).max(300) });
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});
const adminQuery = pageQuery.extend({
  status: z.enum(['visible', 'hidden']).optional(),
  /** Only reviews with unresolved reports. */
  reported: z.enum(['true', 'false']).optional(),
});

export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  /** First name only: enough to feel genuine, without exposing the shop. */
  reviewerName: string;
  createdAt: string;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? 'Retailer';

export class ReviewsService {
  constructor(
    private readonly db: Database,
    private readonly products: ProductsService,
  ) {}

  /** Creates or updates the retailer's review of one product from one of their delivered orders. */
  async upsert(retailerId: string, orderId: string, productId: string, input: z.infer<typeof reviewBody>) {
    const [o] = await this.db
      .select({ status: orders.status })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.retailerId, retailerId)));
    if (!o) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    if (o.status !== 'delivered') throw conflict('NOT_DELIVERED', 'You can review items once the order is delivered');
    const [item] = await this.db
      .select({ productId: orderItems.productId })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), eq(orderItems.productId, productId)))
      .limit(1);
    if (!item) throw badRequest('NOT_IN_ORDER', 'This product is not part of the order');

    return this.db.transaction(async (tx) => {
      const [r] = await tx
        .insert(reviews)
        .values({ productId, orderId, retailerId, rating: input.rating, comment: input.comment ?? null })
        .onConflictDoUpdate({
          target: [reviews.orderId, reviews.productId, reviews.retailerId],
          set: { rating: input.rating, comment: input.comment ?? null },
        })
        .returning();
      await this.recomputeRating(tx, productId);
      return r;
    });
  }

  async listForProduct(productId: string, q: z.infer<typeof pageQuery>) {
    await this.products.getPublic(productId); // 404 unless buyers can see the product
    const filters = [eq(reviews.productId, productId), eq(reviews.status, 'visible')];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${reviews.createdAt}, ${reviews.id}) < (${c.createdAt.toISOString()}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({ r: reviews, name: users.name })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.retailerId))
      .where(and(...filters))
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(q.limit + 1);
    const { page, nextCursor } = paginate(
      rows.map((x) => ({ id: x.r.id, createdAt: x.r.createdAt, x })),
      q.limit,
    );
    return {
      items: page.map(({ x }): PublicReview => ({
        id: x.r.id,
        rating: x.r.rating,
        comment: x.r.comment,
        reviewerName: firstName(x.name),
        createdAt: x.r.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  /** Play policy (user-generated content): any user can report a review once. */
  async report(userId: string, reviewId: string, reason: string): Promise<void> {
    const [r] = await this.db
      .select({ retailerId: reviews.retailerId })
      .from(reviews)
      .where(and(eq(reviews.id, reviewId), eq(reviews.status, 'visible')));
    if (!r) throw notFound('REVIEW_NOT_FOUND', 'Review not found');
    if (r.retailerId === userId) throw badRequest('OWN_REVIEW', 'You cannot report your own review');
    await this.db.insert(reviewReports).values({ reviewId, reporterId: userId, reason }).onConflictDoNothing();
  }

  // ---- admin moderation

  async listForAdmin(q: z.infer<typeof adminQuery>) {
    const openReports = sql<number>`(SELECT count(*)::int FROM review_reports rr
      WHERE rr.review_id = ${reviews.id} AND rr.resolved_at IS NULL)`;
    const filters = [q.status ? eq(reviews.status, q.status) : undefined];
    if (q.reported === 'true') filters.push(sql`${openReports} > 0`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${reviews.createdAt}, ${reviews.id}) < (${c.createdAt.toISOString()}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({
        r: reviews,
        productName: products.name,
        reviewer: users.name,
        openReports,
        reasons: sql<string[]>`COALESCE((SELECT array_agg(rr.reason ORDER BY rr.created_at) FROM review_reports rr
          WHERE rr.review_id = ${reviews.id} AND rr.resolved_at IS NULL), '{}')`,
      })
      .from(reviews)
      .innerJoin(products, eq(products.id, reviews.productId))
      .innerJoin(users, eq(users.id, reviews.retailerId))
      .where(and(...filters))
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(q.limit + 1);
    const { page, nextCursor } = paginate(
      rows.map((x) => ({ id: x.r.id, createdAt: x.r.createdAt, x })),
      q.limit,
    );
    return {
      items: page.map(({ x }) => ({
        id: x.r.id,
        productId: x.r.productId,
        productName: x.productName,
        orderId: x.r.orderId,
        reviewer: x.reviewer,
        rating: x.r.rating,
        comment: x.r.comment,
        status: x.r.status,
        openReports: x.openReports,
        reportReasons: x.reasons,
        createdAt: x.r.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  /** hide/unhide change visibility; every action closes the open reports. */
  async moderate(adminId: string, reviewId: string, action: 'hide' | 'unhide' | 'dismiss_reports', ip: string) {
    await this.db.transaction(async (tx) => {
      const [r] = await tx
        .select({ productId: reviews.productId, status: reviews.status })
        .from(reviews)
        .where(eq(reviews.id, reviewId))
        .for('update');
      if (!r) throw notFound('REVIEW_NOT_FOUND', 'Review not found');
      if (action !== 'dismiss_reports') {
        await tx
          .update(reviews)
          .set({ status: action === 'hide' ? 'hidden' : 'visible' })
          .where(eq(reviews.id, reviewId));
        await this.recomputeRating(tx, r.productId);
      }
      await tx
        .update(reviewReports)
        .set({ resolvedAt: new Date(), resolvedBy: adminId })
        .where(and(eq(reviewReports.reviewId, reviewId), isNull(reviewReports.resolvedAt)));
      await audit(tx, { actorId: adminId, action: `review.${action}`, entity: 'review', entityId: reviewId, ip });
    });
  }

  /** Average and count over visible reviews only, so hidden ones stop counting at once. */
  private async recomputeRating(tx: Tx, productId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE products SET
        rating_avg = COALESCE((SELECT round(avg(rating)::numeric, 2) FROM reviews WHERE product_id = ${productId} AND status = 'visible'), 0),
        rating_count = (SELECT count(*) FROM reviews WHERE product_id = ${productId} AND status = 'visible')
      WHERE id = ${productId}`);
  }
}

// ---------------------------------------------------------------- routes

interface Deps {
  reviews: ReviewsService;
  authenticate: Authenticate;
}
const me = (req: FastifyRequest) => currentUser(req).id;

/** Mounted at /v1. */
export const reviewRoutes: FastifyPluginAsync<Deps> = async (app, { reviews: svc, authenticate }) => {
  const buyers = authenticate({ roles: ['retailer', 'wholesaler', 'admin'] });

  app.put('/orders/:orderId/reviews/:productId', { preHandler: authenticate({ roles: ['retailer'] }) }, async (req) => {
    const { orderId, productId } = parse(z.object({ orderId: z.uuid(), productId: z.uuid() }), req.params);
    return svc.upsert(me(req), orderId, productId, parse(reviewBody, req.body));
  });

  app.get('/products/:id/reviews', { preHandler: buyers }, async (req) =>
    svc.listForProduct(parse(z.object({ id: z.uuid() }), req.params).id, parse(pageQuery, req.query)),
  );

  app.post(
    '/reviews/:id/report',
    { preHandler: authenticate({ roles: ['retailer', 'wholesaler'] }), config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      await svc.report(me(req), parse(z.object({ id: z.uuid() }), req.params).id, parse(reportBody, req.body).reason);
      return reply.status(204).send();
    },
  );
};

/** Mounted at /v1/admin/reviews. */
export const adminReviewRoutes: FastifyPluginAsync<Deps> = async (app, { reviews: svc, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['admin'] }));
  const id = (req: FastifyRequest) => parse(z.object({ id: z.uuid() }), req.params).id;

  app.get('/', async (req) => svc.listForAdmin(parse(adminQuery, req.query)));
  for (const action of ['hide', 'unhide', 'dismiss_reports'] as const) {
    app.post(`/:id/${action.replace('_', '-')}`, async (req, reply) => {
      await svc.moderate(me(req), id(req), action, req.ip);
      return reply.status(204).send();
    });
  }
};
