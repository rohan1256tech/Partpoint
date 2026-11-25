import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { wishlistItems } from '../../db/schema.js';
import { badRequest } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';
import type { ProductsService, ProductSummary } from '../catalog/products.service.js';

export const MAX_WISHLIST = 200;

export class WishlistService {
  constructor(
    private readonly db: Database,
    private readonly products: ProductsService,
  ) {}

  /** Newest first. Products that are no longer for sale are left out (but kept, in case they return). */
  async list(userId: string): Promise<ProductSummary[]> {
    const rows = await this.db
      .select({ productId: wishlistItems.productId })
      .from(wishlistItems)
      .where(eq(wishlistItems.userId, userId))
      .orderBy(desc(wishlistItems.createdAt))
      .limit(MAX_WISHLIST);
    return this.products.summariesByIds(rows.map((r) => r.productId));
  }

  async add(userId: string, productId: string): Promise<void> {
    // Only products a buyer can currently see may be added (throws 404 otherwise).
    await this.products.getPublic(productId);
    const count = await this.db.$count(wishlistItems, eq(wishlistItems.userId, userId));
    if (count >= MAX_WISHLIST) throw badRequest('WISHLIST_FULL', `Your wishlist can hold ${MAX_WISHLIST} items`);
    await this.db.insert(wishlistItems).values({ userId, productId }).onConflictDoNothing();
  }

  async remove(userId: string, productId: string): Promise<void> {
    await this.db
      .delete(wishlistItems)
      .where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, productId)));
  }
}

const params = z.object({ productId: z.uuid() });

/** Mounted at /v1/wishlist. PUT/DELETE are idempotent so the app can update optimistically. */
export const wishlistRoutes: FastifyPluginAsync<{ wishlist: WishlistService; authenticate: Authenticate }> = async (
  app,
  { wishlist, authenticate },
) => {
  app.addHook('preHandler', authenticate({ roles: ['retailer'] }));
  const me = (req: Parameters<typeof currentUser>[0]) => currentUser(req).id;

  app.get('/', async (req) => ({ items: await wishlist.list(me(req)) }));
  app.put('/:productId', async (req, reply) => {
    await wishlist.add(me(req), parse(params, req.params).productId);
    return reply.status(204).send();
  });
  app.delete('/:productId', async (req, reply) => {
    await wishlist.remove(me(req), parse(params, req.params).productId);
    return reply.status(204).send();
  });
};
