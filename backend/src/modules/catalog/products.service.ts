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
  supplierOffers,
  users,
  wholesalerProfiles,
} from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { decodeCursor, paginate } from '../../lib/cursor.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { escapeLike } from '../../lib/like.js';
import type { PresignedUpload, Storage } from '../../lib/storage.js';
import type {
  adminProductsQuery,
  browseQuery,
  offerBody,
  productCreate,
  productUpdate,
  supplierCatalogQuery,
  VariantInput,
  variantUpdate,
} from './catalog.schemas.js';
import { pricingProblems, type Slab } from './pricing.js';
import { availableStock, publicProductFilters } from './visibility.js';

type ProductRow = typeof products.$inferSelect;
type ProductStatus = ProductRow['status'];

export const MAX_IMAGES_PER_PRODUCT = 8;
export const MAX_IMAGE_BYTES = 1024 * 1024;

export interface ProductSummary {
  id: string;
  name: string;
  partNumber: string | null;
  brandName: string | null;
  categoryName: string;
  minPricePaise: number | null;
  mrpPaise: number | null;
  /** Units buyers can order now, across all suppliers. */
  totalStock: number;
  thumbnailUrl: string | null;
  ratingAvg: number;
  ratingCount: number;
  status: ProductStatus;
  statusReason: string | null;
  /** Admin: how many wholesalers stock it. Supplier: null. */
  supplierCount: number | null;
  /** Supplier only: units of it the signed-in wholesaler has listed. */
  myStockQty: number | null;
  createdAt: string;
}

export interface OfferView {
  wholesalerId: string;
  businessName: string;
  city: string;
  state: string;
  supplyPricePaise: number;
  stockQty: number;
  isActive: boolean;
  /** Wholesaler account can trade (approved, not deleted). */
  usable: boolean;
  updatedAt: string;
}

export interface VariantView {
  id: string;
  name: string;
  sku: string | null;
  mrpPaise: number;
  pricePaise: number;
  /** Units buyers can order now. */
  stockQty: number;
  minOrderQty: number;
  isActive: boolean;
  slabs: Slab[];
  /** Admin only: every wholesaler's offer for this variant. */
  offers: OfferView[] | null;
  /** Supplier only: the signed-in wholesaler's own offer. */
  myOffer: { supplyPricePaise: number; stockQty: number; isActive: boolean } | null;
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
  images: { id: string; url: string; sortOrder: number }[];
  variants: VariantView[];
  createdAt: string;
  updatedAt: string;
}

type Viewer = { kind: 'public' } | { kind: 'admin' } | { kind: 'supplier'; wholesalerId: string };
const PUBLIC: Viewer = { kind: 'public' };
const ADMIN: Viewer = { kind: 'admin' };

function assertPricing(v: Parameters<typeof pricingProblems>[0]): void {
  const problems = pricingProblems(v);
  if (problems.length) {
    throw badRequest('INVALID_PRICING', problems[0] as string, problems.map((message) => ({ message })));
  }
}

/**
 * Partpoint's catalog. The admin creates and prices products; wholesalers attach offers
 * (their stock and the price Partpoint pays them) to the variants they can supply.
 */
export class ProductsService {
  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
  ) {}

  // ================================================================ admin: catalog

  async create(adminId: string, input: z.infer<typeof productCreate>, ip: string): Promise<ProductDetail> {
    await this.assertTaxonomy(input.categoryId, input.brandId ?? null);
    input.variants.forEach((v) => assertPricing(v));

    const productId = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(products)
        .values({
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
      await audit(tx, { actorId: adminId, action: 'product.create', entity: 'product', entityId: id, data: { name: input.name }, ip });
      return id;
    });
    return this.getAny(productId);
  }

  async update(adminId: string, productId: string, input: z.infer<typeof productUpdate>, ip: string): Promise<ProductDetail> {
    const current = await this.row(productId);
    if (input.categoryId || input.brandId) {
      await this.assertTaxonomy(input.categoryId ?? current.categoryId, input.brandId ?? null);
    }
    await this.db.transaction(async (tx) => {
      await tx.update(products).set(input).where(eq(products.id, productId));
      await audit(tx, { actorId: adminId, action: 'product.update', entity: 'product', entityId: productId, data: input, ip });
    });
    return this.getAny(productId);
  }

  async setVisibility(
    adminId: string,
    productId: string,
    to: 'active' | 'hidden',
    reason: string | null,
    ip: string,
  ): Promise<ProductDetail> {
    const p = await this.row(productId);
    if (to === 'active') {
      const [active] = await this.db
        .select({ n: count() })
        .from(productVariants)
        .where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true)));
      if (!active?.n) throw badRequest('NO_ACTIVE_VARIANT', 'Add at least one active variant before publishing');
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(products)
        .set({ status: to, statusReason: to === 'hidden' ? reason : null })
        .where(eq(products.id, productId));
      await audit(tx, {
        actorId: adminId,
        action: to === 'active' ? 'product.publish' : 'product.hide',
        entity: 'product',
        entityId: productId,
        data: { from: p.status, ...(reason ? { reason } : {}) },
        ip,
      });
    });
    return this.getAny(productId);
  }

  async addVariant(productId: string, input: VariantInput): Promise<ProductDetail> {
    await this.row(productId);
    assertPricing(input);
    const [existing] = await this.db
      .select({ n: count() })
      .from(productVariants)
      .where(eq(productVariants.productId, productId));
    if ((existing?.n ?? 0) >= 20) throw badRequest('TOO_MANY_VARIANTS', 'A product can have at most 20 variants');
    await this.db.transaction((tx) => this.insertVariant(tx, productId, input));
    return this.getAny(productId);
  }

  async updateVariant(variantId: string, input: z.infer<typeof variantUpdate>): Promise<ProductDetail> {
    const [variant] = await this.db.select().from(productVariants).where(eq(productVariants.id, variantId));
    if (!variant) throw notFound('VARIANT_NOT_FOUND', 'Variant not found');

    const slabs =
      input.slabs ??
      (await this.db
        .select({ minQty: priceSlabs.minQty, pricePaise: priceSlabs.pricePaise })
        .from(priceSlabs)
        .where(eq(priceSlabs.variantId, variantId)));
    assertPricing({
      mrpPaise: input.mrpPaise ?? variant.mrpPaise,
      pricePaise: input.pricePaise ?? variant.pricePaise,
      minOrderQty: input.minOrderQty ?? variant.minOrderQty,
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
    return this.getAny(variant.productId);
  }

  /** Step 1 of an image upload: a short-lived URL the client PUTs the WebP file to, straight to R2. */
  async imageUploadUrl(productId: string, sizeBytes: number): Promise<{ objectKey: string; upload: PresignedUpload }> {
    await this.row(productId);
    await this.assertImageRoom(productId);
    const objectKey = `products/${productId}/${crypto.randomUUID()}.webp`;
    return { objectKey, upload: this.storage.presignUpload(objectKey, 'image/webp', sizeBytes) };
  }

  /** Step 2: after the upload succeeds, attach it. The object is checked in R2 before it is accepted. */
  async attachImage(productId: string, objectKey: string): Promise<ProductDetail> {
    await this.row(productId);
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
    return this.getAny(productId);
  }

  async removeImage(productId: string, imageId: string): Promise<ProductDetail> {
    await this.row(productId);
    const deleted = await this.db
      .delete(productImages)
      .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
      .returning({ id: productImages.id });
    if (deleted.length === 0) throw notFound('IMAGE_NOT_FOUND', 'Image not found');
    // The R2 object is left for a periodic cleanup job: invoices and caches may still reference it briefly.
    return this.getAny(productId);
  }

  listAll(q: z.infer<typeof adminProductsQuery>) {
    return this.list(ADMIN, q, [
      q.status ? sql`p.status = ${q.status}` : undefined,
      q.categoryId ? sql`(p.category_id = ${q.categoryId} OR c.parent_id = ${q.categoryId})` : undefined,
      q.wholesalerId
        ? sql`EXISTS (SELECT 1 FROM supplier_offers so JOIN product_variants sv ON sv.id = so.variant_id
                      WHERE sv.product_id = p.id AND so.wholesaler_id = ${q.wholesalerId})`
        : undefined,
      q.stock === 'out'
        ? sql`NOT EXISTS (SELECT 1 FROM product_variants sv WHERE sv.product_id = p.id AND sv.is_active
                          AND ${availableStock(sql`sv.id`)} > 0)`
        : undefined,
    ]);
  }

  async getAny(productId: string): Promise<ProductDetail> {
    return this.detail(await this.row(productId), ADMIN);
  }

  // ================================================================ wholesalers: what they supply

  /** Published catalog products, for a wholesaler choosing what to stock. */
  supplierCatalog(wholesalerId: string, q: z.infer<typeof supplierCatalogQuery>) {
    return this.list({ kind: 'supplier', wholesalerId }, q, [
      sql`p.status = 'active'`,
      q.categoryId ? sql`(p.category_id = ${q.categoryId} OR c.parent_id = ${q.categoryId})` : undefined,
      q.mine
        ? sql`EXISTS (SELECT 1 FROM supplier_offers so JOIN product_variants sv ON sv.id = so.variant_id
                      WHERE sv.product_id = p.id AND so.wholesaler_id = ${wholesalerId})`
        : undefined,
    ]);
  }

  async supplierProduct(wholesalerId: string, productId: string): Promise<ProductDetail> {
    const p = await this.row(productId);
    if (p.status !== 'active') throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
    return this.detail(p, { kind: 'supplier', wholesalerId });
  }

  /** Creates or updates the wholesaler's offer for one variant. */
  async setOffer(wholesalerId: string, variantId: string, input: z.infer<typeof offerBody>): Promise<ProductDetail> {
    const [row] = await this.db
      .select({ productId: productVariants.productId, status: products.status })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, variantId));
    if (!row || row.status !== 'active') throw notFound('VARIANT_NOT_FOUND', 'Variant not found');
    await this.db
      .insert(supplierOffers)
      .values({ wholesalerId, variantId, ...input })
      .onConflictDoUpdate({ target: [supplierOffers.wholesalerId, supplierOffers.variantId], set: input });
    return this.supplierProduct(wholesalerId, row.productId);
  }

  // ================================================================ buyers

  browse(q: z.infer<typeof browseQuery>) {
    return this.list(PUBLIC, q, [
      ...publicProductFilters(),
      q.categoryId ? sql`(p.category_id = ${q.categoryId} OR c.parent_id = ${q.categoryId})` : undefined,
      q.brandId ? sql`p.brand_id = ${q.brandId}` : undefined,
    ]);
  }

  /** Buyer-visible summaries for the given products, in the given order. Hidden products are skipped. */
  async summariesByIds(ids: string[]): Promise<ProductSummary[]> {
    if (ids.length === 0) return [];
    const { items } = await this.list(PUBLIC, { limit: ids.length }, [
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
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.id = ${productId} AND ${sql.join(publicProductFilters(), sql` AND `)}`);
    if (rows.rows.length === 0) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
    return this.detail(await this.row(productId), PUBLIC);
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
      filters.push(sql`(p.name ILIKE ${pattern} OR p.part_number ILIKE ${pattern} OR b.name ILIKE ${pattern})`);
    }
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(p.created_at, p.id) < (${c.createdAt.toISOString()}::timestamptz, ${c.id}::uuid)`);
    }
    const where = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
    const supplierId = viewer.kind === 'supplier' ? viewer.wholesalerId : null;

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
      category_name: string;
      min_price_paise: string | null;
      mrp_paise: string | null;
      total_stock: string;
      supplier_count: string;
      my_stock: string | null;
      thumb_key: string | null;
    }>(sql`
      SELECT p.id, p.name, p.part_number, p.status, p.status_reason, p.rating_avg, p.rating_count, p.created_at,
             b.name AS brand_name, c.name AS category_name,
             pv.price_paise AS min_price_paise, pv.mrp_paise,
             (SELECT COALESCE(SUM(${availableStock(sql`v.id`)}), 0) FROM product_variants v
               WHERE v.product_id = p.id AND v.is_active) AS total_stock,
             (SELECT count(DISTINCT so.wholesaler_id) FROM supplier_offers so
               JOIN product_variants v ON v.id = so.variant_id
               WHERE v.product_id = p.id AND so.is_active AND so.stock_qty > 0) AS supplier_count,
             ${
               supplierId
                 ? sql`(SELECT COALESCE(SUM(so.stock_qty), 0) FROM supplier_offers so
                        JOIN product_variants v ON v.id = so.variant_id
                        WHERE v.product_id = p.id AND so.wholesaler_id = ${supplierId} AND so.is_active)`
                 : sql`NULL`
             } AS my_stock,
             (SELECT i.object_key FROM product_images i
               WHERE i.product_id = p.id ORDER BY i.sort_order, i.created_at LIMIT 1) AS thumb_key
      FROM products p
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
        categoryName: r.category_name,
        minPricePaise: r.min_price_paise === null ? null : Number(r.min_price_paise),
        mrpPaise: r.mrp_paise === null ? null : Number(r.mrp_paise),
        totalStock: Number(r.total_stock),
        thumbnailUrl: r.thumb_key ? this.storage.publicUrl(r.thumb_key) : null,
        ratingAvg: Number(r.rating_avg),
        ratingCount: Number(r.rating_count),
        status: r.status,
        statusReason: viewer.kind === 'admin' ? r.status_reason : null,
        supplierCount: viewer.kind === 'admin' ? Number(r.supplier_count) : null,
        myStockQty: r.my_stock === null ? null : Number(r.my_stock),
        createdAt: new Date(r.created_at).toISOString(),
      } satisfies ProductSummary,
    }));
    const { page, nextCursor } = paginate(mapped, q.limit);
    return { items: page.map((r) => r.summary), nextCursor };
  }

  private async detail(p: ProductRow, viewer: Viewer): Promise<ProductDetail> {
    const [variants, images, [category], brand] = await Promise.all([
      this.db
        .select({ v: productVariants, stock: sql<string>`${availableStock(sql`${productVariants.id}`)}` })
        .from(productVariants)
        .where(
          viewer.kind === 'admin'
            ? eq(productVariants.productId, p.id)
            : and(eq(productVariants.productId, p.id), eq(productVariants.isActive, true)),
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
    ]);
    const variantIds = variants.map((r) => r.v.id);

    const [slabs, offers] = await Promise.all([
      variantIds.length
        ? this.db.select().from(priceSlabs).where(inArray(priceSlabs.variantId, variantIds)).orderBy(asc(priceSlabs.minQty))
        : Promise.resolve([]),
      variantIds.length && viewer.kind !== 'public'
        ? this.db
            .select({
              offer: supplierOffers,
              businessName: wholesalerProfiles.businessName,
              city: wholesalerProfiles.city,
              state: wholesalerProfiles.state,
              usable: sql<boolean>`(${users.status} = 'approved' AND ${users.deletedAt} IS NULL)`,
            })
            .from(supplierOffers)
            .innerJoin(wholesalerProfiles, eq(wholesalerProfiles.userId, supplierOffers.wholesalerId))
            .innerJoin(users, eq(users.id, supplierOffers.wholesalerId))
            .where(
              and(
                inArray(supplierOffers.variantId, variantIds),
                viewer.kind === 'supplier' ? eq(supplierOffers.wholesalerId, viewer.wholesalerId) : undefined,
              ),
            )
            .orderBy(asc(supplierOffers.supplyPricePaise))
        : Promise.resolve([]),
    ]);

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      partNumber: p.partNumber,
      hsnCode: p.hsnCode,
      gstRateBps: p.gstRateBps,
      status: p.status,
      statusReason: viewer.kind === 'admin' ? p.statusReason : null,
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
      category: category ?? { id: p.categoryId, name: '' },
      brand: brand[0] ?? null,
      images: images.map((i) => ({ id: i.id, url: this.storage.publicUrl(i.objectKey), sortOrder: i.sortOrder })),
      variants: variants.map(({ v, stock }) => {
        const mine = offers.filter((o) => o.offer.variantId === v.id);
        return {
          id: v.id,
          name: v.name,
          sku: v.sku,
          mrpPaise: v.mrpPaise,
          pricePaise: v.pricePaise,
          stockQty: Number(stock),
          minOrderQty: v.minOrderQty,
          isActive: v.isActive,
          slabs: slabs.filter((s) => s.variantId === v.id).map((s) => ({ minQty: s.minQty, pricePaise: s.pricePaise })),
          offers:
            viewer.kind === 'admin'
              ? mine.map((o) => ({
                  wholesalerId: o.offer.wholesalerId,
                  businessName: o.businessName,
                  city: o.city,
                  state: o.state,
                  supplyPricePaise: o.offer.supplyPricePaise,
                  stockQty: o.offer.stockQty,
                  isActive: o.offer.isActive,
                  usable: o.usable,
                  updatedAt: o.offer.updatedAt.toISOString(),
                }))
              : null,
          myOffer:
            viewer.kind === 'supplier' && mine[0]
              ? { supplyPricePaise: mine[0].offer.supplyPricePaise, stockQty: mine[0].offer.stockQty, isActive: mine[0].offer.isActive }
              : null,
        };
      }),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private async row(productId: string): Promise<ProductRow> {
    const [p] = await this.db.select().from(products).where(eq(products.id, productId));
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
        minOrderQty: v.minOrderQty,
      })
      .returning({ id: productVariants.id });
    const variantId = (row as { id: string }).id;
    if (v.slabs.length) await tx.insert(priceSlabs).values(v.slabs.map((s) => ({ variantId, ...s })));
  }
}
