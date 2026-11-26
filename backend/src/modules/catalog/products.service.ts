import { and, asc, count, eq, inArray, max, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/index.js';
import {
  brands,
  categories,
  priceSlabs,
  productImages,
  products,
  productVariants,
  wholesalerProfiles,
} from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { decodeCursor, paginate } from '../../lib/cursor.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import type { PresignedUpload, Storage } from '../../lib/storage.js';
import type {
  adminProductsQuery,
  browseQuery,
  ownProductsQuery,
  productCreate,
  productUpdate,
  VariantInput,
  variantUpdate,
} from './catalog.schemas.js';
import { pricingProblems, type Slab } from './pricing.js';
import { publicProductFilters } from './visibility.js';
import { escapeLike } from '../../lib/like.js';

type ProductRow = typeof products.$inferSelect;
type ProductStatus = ProductRow['status'];

export const MAX_IMAGES_PER_PRODUCT = 8;
export const MAX_IMAGE_BYTES = 1024 * 1024;

export interface ProductSummary {
  id: string;
  name: string;
  partNumber: string | null;
  brandName: string | null;
  wholesaler: { id: string; businessName: string; city: string };
  minPricePaise: number | null;
  mrpPaise: number | null;
  totalStock: number;
  thumbnailUrl: string | null;
  ratingAvg: number;
  ratingCount: number;
  status: ProductStatus;
  statusReason: string | null;
  createdAt: string;
}

export interface VariantView {
  id: string;
  name: string;
  sku: string | null;
  mrpPaise: number;
  pricePaise: number;
  stockQty: number;
  minOrderQty: number;
  isActive: boolean;
  slabs: Slab[];
}

export interface ProductDetail {
  id: string;
  name: string;
  description: string | null;
  partNumber: string | null;
  hsnCode: string | null;
  gstRateBps: number;
  status: ProductStatus;
  statusReason: string | null;
  ratingAvg: number;
  ratingCount: number;
  category: { id: string; name: string };
  brand: { id: string; name: string } | null;
  wholesaler: { id: string; businessName: string; city: string; state: string };
  images: { id: string; url: string; sortOrder: number }[];
  variants: VariantView[];
  createdAt: string;
  updatedAt: string;
}

type Viewer = 'public' | 'owner' | 'admin';


function assertPricing(v: Parameters<typeof pricingProblems>[0]): void {
  const problems = pricingProblems(v);
  if (problems.length) {
    throw badRequest('INVALID_PRICING', problems[0] as string, problems.map((message) => ({ message })));
  }
}

export class ProductsService {
  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
  ) {}

  // ================================================================ wholesaler

  async create(wholesalerId: string, input: z.infer<typeof productCreate>): Promise<ProductDetail> {
    await this.assertTaxonomy(input.categoryId, input.brandId ?? null);
    input.variants.forEach((v) => assertPricing(v));

    const productId = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(products)
        .values({
          wholesalerId,
          categoryId: input.categoryId,
          brandId: input.brandId ?? null,
          name: input.name,
          description: input.description ?? null,
          partNumber: input.partNumber ?? null,
          hsnCode: input.hsnCode ?? null,
          gstRateBps: input.gstRateBps,
          status: 'draft',
        })
        .returning({ id: products.id });
      const id = (p as { id: string }).id;
      for (const v of input.variants) await this.insertVariant(tx, id, v);
      return id;
    });
    return this.getOwn(wholesalerId, productId);
  }

  async update(wholesalerId: string, productId: string, input: z.infer<typeof productUpdate>): Promise<ProductDetail> {
    const current = await this.own(wholesalerId, productId);
    if (input.categoryId || input.brandId) {
      await this.assertTaxonomy(input.categoryId ?? current.categoryId, input.brandId ?? null);
    }
    await this.db.update(products).set(input).where(eq(products.id, productId));
    return this.getOwn(wholesalerId, productId);
  }

  async setVisibility(wholesalerId: string, productId: string, to: 'active' | 'hidden'): Promise<ProductDetail> {
    const p = await this.own(wholesalerId, productId);
    if (p.status === 'blocked') {
      throw forbidden('PRODUCT_BLOCKED', 'This product was blocked by the admin and cannot be changed');
    }
    if (to === 'active') {
      const [active] = await this.db
        .select({ n: count() })
        .from(productVariants)
        .where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true)));
      if (!active?.n) throw badRequest('NO_ACTIVE_VARIANT', 'Add at least one active variant before publishing');
    }
    await this.db.update(products).set({ status: to }).where(eq(products.id, productId));
    return this.getOwn(wholesalerId, productId);
  }

  async addVariant(wholesalerId: string, productId: string, input: VariantInput): Promise<ProductDetail> {
    await this.own(wholesalerId, productId);
    assertPricing(input);
    const [existing] = await this.db
      .select({ n: count() })
      .from(productVariants)
      .where(eq(productVariants.productId, productId));
    if ((existing?.n ?? 0) >= 20) throw badRequest('TOO_MANY_VARIANTS', 'A product can have at most 20 variants');
    await this.db.transaction((tx) => this.insertVariant(tx, productId, input));
    return this.getOwn(wholesalerId, productId);
  }

  async updateVariant(
    wholesalerId: string,
    variantId: string,
    input: z.infer<typeof variantUpdate>,
  ): Promise<ProductDetail> {
    const [row] = await this.db
      .select({ variant: productVariants, productId: products.id })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.id, variantId), eq(products.wholesalerId, wholesalerId)));
    if (!row) throw notFound('VARIANT_NOT_FOUND', 'Variant not found');

    const slabs =
      input.slabs ??
      (await this.db
        .select({ minQty: priceSlabs.minQty, pricePaise: priceSlabs.pricePaise })
        .from(priceSlabs)
        .where(eq(priceSlabs.variantId, variantId)));
    assertPricing({
      mrpPaise: input.mrpPaise ?? row.variant.mrpPaise,
      pricePaise: input.pricePaise ?? row.variant.pricePaise,
      minOrderQty: input.minOrderQty ?? row.variant.minOrderQty,
      slabs,
    });

    const { slabs: newSlabs, ...fields } = input;
    await this.db.transaction(async (tx) => {
      if (Object.keys(fields).length) {
        await tx.update(productVariants).set(fields).where(eq(productVariants.id, variantId));
      }
      if (newSlabs) {
        await tx.delete(priceSlabs).where(eq(priceSlabs.variantId, variantId));
        if (newSlabs.length) await tx.insert(priceSlabs).values(newSlabs.map((s) => ({ variantId, ...s })));
      }
    });
    return this.getOwn(wholesalerId, row.productId);
  }

  /** Step 1 of an image upload: a short-lived URL the app PUTs the WebP file to, straight to R2. */
  async imageUploadUrl(
    wholesalerId: string,
    productId: string,
    sizeBytes: number,
  ): Promise<{ objectKey: string; upload: PresignedUpload }> {
    await this.own(wholesalerId, productId);
    await this.assertImageRoom(productId);
    const objectKey = `products/${productId}/${crypto.randomUUID()}.webp`;
    return { objectKey, upload: this.storage.presignUpload(objectKey, 'image/webp', sizeBytes) };
  }

  /** Step 2: after the upload succeeds, attach it. The object is checked in R2 before it is accepted. */
  async attachImage(wholesalerId: string, productId: string, objectKey: string): Promise<ProductDetail> {
    await this.own(wholesalerId, productId);
    const expected = new RegExp(`^products/${productId}/[0-9a-f-]{36}\\.webp$`);
    if (!expected.test(objectKey)) throw badRequest('INVALID_IMAGE_KEY', 'This image does not belong to this product');
    await this.assertImageRoom(productId);

    const object = await this.storage.head(objectKey);
    if (!object) throw badRequest('IMAGE_NOT_UPLOADED', 'Upload the image before attaching it');
    if (object.size > MAX_IMAGE_BYTES || object.contentType !== 'image/webp') {
      throw badRequest('INVALID_IMAGE', 'Images must be WebP and at most 1 MB');
    }

    const [last] = await this.db
      .select({ n: max(productImages.sortOrder) })
      .from(productImages)
      .where(eq(productImages.productId, productId));
    await this.db.insert(productImages).values({ productId, objectKey, sortOrder: (last?.n ?? -1) + 1 });
    return this.getOwn(wholesalerId, productId);
  }

  async removeImage(wholesalerId: string, productId: string, imageId: string): Promise<ProductDetail> {
    await this.own(wholesalerId, productId);
    const deleted = await this.db
      .delete(productImages)
      .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
      .returning({ id: productImages.id });
    if (deleted.length === 0) throw notFound('IMAGE_NOT_FOUND', 'Image not found');
    // The R2 object is left for a periodic cleanup job: invoices and caches may still reference it briefly.
    return this.getOwn(wholesalerId, productId);
  }

  listOwn(wholesalerId: string, q: z.infer<typeof ownProductsQuery>) {
    return this.list('owner', q, [sql`p.wholesaler_id = ${wholesalerId}`, q.status ? sql`p.status = ${q.status}` : undefined]);
  }

  async getOwn(wholesalerId: string, productId: string): Promise<ProductDetail> {
    return this.detail(await this.own(wholesalerId, productId), 'owner');
  }

  // ================================================================ public (signed-in buyers)

  browse(q: z.infer<typeof browseQuery>) {
    return this.list('public', q, [
      ...publicProductFilters(),
      q.categoryId ? sql`(p.category_id = ${q.categoryId} OR c.parent_id = ${q.categoryId})` : undefined,
      q.brandId ? sql`p.brand_id = ${q.brandId}` : undefined,
      q.wholesalerId ? sql`p.wholesaler_id = ${q.wholesalerId}` : undefined,
    ]);
  }

  /** Buyer-visible summaries for the given products, in the given order. Hidden products are skipped. */
  async summariesByIds(ids: string[]): Promise<ProductSummary[]> {
    if (ids.length === 0) return [];
    const { items } = await this.list('public', { limit: ids.length }, [
      ...publicProductFilters(),
      sql`p.id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    ]);
    const byId = new Map(items.map((i) => [i.id, i]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  async getPublic(productId: string): Promise<ProductDetail> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT p.id FROM products p
      JOIN users u ON u.id = p.wholesaler_id
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.id = ${productId} AND ${sql.join(publicProductFilters(), sql` AND `)}`);
    if (rows.rows.length === 0) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
    const [p] = await this.db.select().from(products).where(eq(products.id, productId));
    return this.detail(p as ProductRow, 'public');
  }

  // ================================================================ admin

  listAll(q: z.infer<typeof adminProductsQuery>) {
    return this.list('admin', q, [
      q.status ? sql`p.status = ${q.status}` : undefined,
      q.wholesalerId ? sql`p.wholesaler_id = ${q.wholesalerId}` : undefined,
    ]);
  }

  async getAny(productId: string): Promise<ProductDetail> {
    const [p] = await this.db.select().from(products).where(eq(products.id, productId));
    if (!p) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
    return this.detail(p, 'admin');
  }

  async moderate(
    adminId: string,
    productId: string,
    action: 'block' | 'unblock',
    reason: string | null,
    ip: string,
  ): Promise<ProductDetail> {
    await this.db.transaction(async (tx) => {
      const [p] = await tx
        .select({ status: products.status })
        .from(products)
        .where(eq(products.id, productId))
        .for('update');
      if (!p) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
      if ((action === 'block') === (p.status === 'blocked')) {
        throw conflict('INVALID_STATUS_TRANSITION', `Product is ${action === 'block' ? 'already' : 'not'} blocked`);
      }
      await tx
        .update(products)
        // Unblocked products come back hidden; the wholesaler decides when to publish again.
        .set(action === 'block' ? { status: 'blocked', statusReason: reason } : { status: 'hidden', statusReason: null })
        .where(eq(products.id, productId));
      await audit(tx, {
        actorId: adminId,
        action: `product.${action}`,
        entity: 'product',
        entityId: productId,
        data: { from: p.status, ...(reason ? { reason } : {}) },
        ip,
      });
    });
    return this.getAny(productId);
  }

  // ================================================================ internals

  private async list(
    viewer: Viewer,
    q: { q?: string | undefined; limit: number; cursor?: string | undefined },
    extra: (SQL | undefined)[],
  ): Promise<{ items: ProductSummary[]; nextCursor: string | null }> {
    const filters = extra.filter((f): f is SQL => f !== undefined);
    if (q.q) {
      const pattern = `%${escapeLike(q.q)}%`;
      filters.push(sql`(p.name ILIKE ${pattern} OR p.part_number ILIKE ${pattern})`);
    }
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(p.created_at, p.id) < (${c.createdAt.toISOString()}::timestamptz, ${c.id}::uuid)`);
    }
    const where = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const { rows } = await this.db.execute<{
      id: string;
      name: string;
      part_number: string | null;
      status: ProductStatus;
      status_reason: string | null;
      rating_avg: number;
      rating_count: number;
      created_at: Date;
      brand_name: string | null;
      wholesaler_id: string;
      business_name: string;
      city: string;
      min_price_paise: string | null;
      mrp_paise: string | null;
      total_stock: string;
      thumb_key: string | null;
    }>(sql`
      SELECT p.id, p.name, p.part_number, p.status, p.status_reason, p.rating_avg, p.rating_count, p.created_at,
             b.name AS brand_name, p.wholesaler_id, wp.business_name, wp.city,
             pv.price_paise AS min_price_paise, pv.mrp_paise,
             (SELECT COALESCE(SUM(v.stock_qty), 0) FROM product_variants v
               WHERE v.product_id = p.id AND v.is_active) AS total_stock,
             (SELECT i.object_key FROM product_images i
               WHERE i.product_id = p.id ORDER BY i.sort_order, i.created_at LIMIT 1) AS thumb_key
      FROM products p
      JOIN users u ON u.id = p.wholesaler_id
      JOIN wholesaler_profiles wp ON wp.user_id = p.wholesaler_id
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN LATERAL (
        SELECT v.price_paise, v.mrp_paise FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active ORDER BY v.price_paise LIMIT 1
      ) pv ON true
      ${where}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${q.limit + 1}`);

    const mapped = rows.map((r) => ({
      id: r.id,
      createdAt: new Date(r.created_at),
      summary: {
        id: r.id,
        name: r.name,
        partNumber: r.part_number,
        brandName: r.brand_name,
        wholesaler: { id: r.wholesaler_id, businessName: r.business_name, city: r.city },
        minPricePaise: r.min_price_paise === null ? null : Number(r.min_price_paise),
        mrpPaise: r.mrp_paise === null ? null : Number(r.mrp_paise),
        totalStock: Number(r.total_stock),
        thumbnailUrl: r.thumb_key ? this.storage.publicUrl(r.thumb_key) : null,
        ratingAvg: Number(r.rating_avg),
        ratingCount: Number(r.rating_count),
        status: r.status,
        statusReason: viewer === 'public' ? null : r.status_reason,
        createdAt: new Date(r.created_at).toISOString(),
      } satisfies ProductSummary,
    }));
    const { page, nextCursor } = paginate(mapped, q.limit);
    return { items: page.map((r) => r.summary), nextCursor };
  }

  private async detail(p: ProductRow, viewer: Viewer): Promise<ProductDetail> {
    const [variants, images, [category], brand, [wholesaler]] = await Promise.all([
      this.db
        .select()
        .from(productVariants)
        .where(
          viewer === 'public'
            ? and(eq(productVariants.productId, p.id), eq(productVariants.isActive, true))
            : eq(productVariants.productId, p.id),
        )
        .orderBy(asc(productVariants.pricePaise), asc(productVariants.createdAt)),
      this.db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, p.id))
        .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt)),
      this.db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.id, p.categoryId)),
      p.brandId
        ? this.db.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.id, p.brandId))
        : Promise.resolve([]),
      this.db
        .select({
          businessName: wholesalerProfiles.businessName,
          city: wholesalerProfiles.city,
          state: wholesalerProfiles.state,
        })
        .from(wholesalerProfiles)
        .where(eq(wholesalerProfiles.userId, p.wholesalerId)),
    ]);

    const slabs = variants.length
      ? await this.db
          .select()
          .from(priceSlabs)
          .where(
            inArray(
              priceSlabs.variantId,
              variants.map((v) => v.id),
            ),
          )
          .orderBy(asc(priceSlabs.minQty))
      : [];

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      partNumber: p.partNumber,
      hsnCode: p.hsnCode,
      gstRateBps: p.gstRateBps,
      status: p.status,
      statusReason: viewer === 'public' ? null : p.statusReason,
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
      category: category ?? { id: p.categoryId, name: '' },
      brand: brand[0] ?? null,
      wholesaler: { id: p.wholesalerId, ...(wholesaler ?? { businessName: '', city: '', state: '' }) },
      images: images.map((i) => ({ id: i.id, url: this.storage.publicUrl(i.objectKey), sortOrder: i.sortOrder })),
      variants: variants.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        mrpPaise: v.mrpPaise,
        pricePaise: v.pricePaise,
        stockQty: v.stockQty,
        minOrderQty: v.minOrderQty,
        isActive: v.isActive,
        slabs: slabs.filter((s) => s.variantId === v.id).map((s) => ({ minQty: s.minQty, pricePaise: s.pricePaise })),
      })),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  /** Object-level authorization: a wholesaler only ever sees their own products. Others get 404, not 403. */
  private async own(wholesalerId: string, productId: string): Promise<ProductRow> {
    const [p] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.wholesalerId, wholesalerId)));
    if (!p) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
    return p;
  }

  private async assertTaxonomy(categoryId: string, brandId: string | null): Promise<void> {
    const [c] = await this.db
      .select({ isActive: categories.isActive })
      .from(categories)
      .where(eq(categories.id, categoryId));
    if (!c?.isActive) throw badRequest('INVALID_CATEGORY', 'Choose an active category');
    if (brandId) {
      const [b] = await this.db.select({ isActive: brands.isActive }).from(brands).where(eq(brands.id, brandId));
      if (!b?.isActive) throw badRequest('INVALID_BRAND', 'Choose an active brand');
    }
  }

  private async assertImageRoom(productId: string): Promise<void> {
    const [n] = await this.db
      .select({ n: count() })
      .from(productImages)
      .where(eq(productImages.productId, productId));
    if ((n?.n ?? 0) >= MAX_IMAGES_PER_PRODUCT) {
      throw badRequest('TOO_MANY_IMAGES', `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`);
    }
  }

  private async insertVariant(tx: Pick<Database, 'insert'>, productId: string, v: VariantInput): Promise<void> {
    const [row] = await tx
      .insert(productVariants)
      .values({
        productId,
        name: v.name,
        sku: v.sku ?? null,
        mrpPaise: v.mrpPaise,
        pricePaise: v.pricePaise,
        stockQty: v.stockQty,
        minOrderQty: v.minOrderQty,
      })
      .returning({ id: productVariants.id });
    const variantId = (row as { id: string }).id;
    if (v.slabs.length) await tx.insert(priceSlabs).values(v.slabs.map((s) => ({ variantId, ...s })));
  }
}
