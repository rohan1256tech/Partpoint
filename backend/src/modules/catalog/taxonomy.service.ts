import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/index.js';
import { brands, categories } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { Storage } from '../../lib/storage.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { slugify, type brandCreate, type brandUpdate, type categoryCreate, type categoryUpdate } from './catalog.schemas.js';

type CategoryRow = typeof categories.$inferSelect;
type BrandRow = typeof brands.$inferSelect;

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  children: CategoryNode[];
}

export interface PublicBrand {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

/** Categories and brands. Public reads are served from memory; admin writes clear the cache. */
export class TaxonomyService {
  private cache: { at: number; tree: CategoryNode[]; brands: PublicBrand[] } | null = null;

  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
  ) {}

  invalidate(): void {
    this.cache = null;
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache;
    const [cats, brandRows] = await Promise.all([
      this.db.select().from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.sortOrder), asc(categories.name)),
      this.db.select().from(brands).where(eq(brands.isActive, true)).orderBy(asc(brands.name)),
    ]);
    const node = (c: CategoryRow): CategoryNode => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      imageUrl: c.imageKey ? this.storage.publicUrl(c.imageKey) : null,
      children: [],
    });
    const top = cats.filter((c) => !c.parentId).map(node);
    const byId = new Map(top.map((n) => [n.id, n]));
    for (const c of cats) {
      if (c.parentId) byId.get(c.parentId)?.children.push(node(c)); // children of inactive parents are hidden
    }
    this.cache = {
      at: Date.now(),
      tree: top,
      brands: brandRows.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        logoUrl: b.logoKey ? this.storage.publicUrl(b.logoKey) : null,
      })),
    };
    return this.cache;
  }

  async categoryTree(): Promise<CategoryNode[]> {
    return (await this.load()).tree;
  }

  async activeBrands(): Promise<PublicBrand[]> {
    return (await this.load()).brands;
  }

  // ---------------------------------------------------------------- admin

  listAllCategories(): Promise<CategoryRow[]> {
    return this.db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
  }

  listAllBrands(): Promise<BrandRow[]> {
    return this.db.select().from(brands).orderBy(asc(brands.name));
  }

  async createCategory(adminId: string, input: z.infer<typeof categoryCreate>, ip: string): Promise<CategoryRow> {
    if (input.parentId) await this.assertValidParent(input.parentId, null);
    const row = await this.write(async () => {
      const [c] = await this.db
        .insert(categories)
        .values({
          name: input.name,
          slug: input.slug ?? slugify(input.name),
          parentId: input.parentId ?? null,
          imageKey: input.imageKey ?? null,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        })
        .returning();
      return c as CategoryRow;
    });
    await audit(this.db, { actorId: adminId, action: 'category.create', entity: 'category', entityId: row.id, ip });
    return row;
  }

  async updateCategory(
    adminId: string,
    id: string,
    input: z.infer<typeof categoryUpdate>,
    ip: string,
  ): Promise<CategoryRow> {
    if (input.parentId) await this.assertValidParent(input.parentId, id);
    if (input.parentId) {
      const [child] = await this.db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id)).limit(1);
      if (child) throw badRequest('CATEGORY_DEPTH', 'A category with subcategories cannot become a subcategory');
    }
    const row = await this.write(async () => {
      const [c] = await this.db
        .update(categories)
        .set(input)
        .where(eq(categories.id, id))
        .returning();
      return c;
    });
    if (!row) throw notFound('CATEGORY_NOT_FOUND', 'Category not found');
    await audit(this.db, {
      actorId: adminId,
      action: 'category.update',
      entity: 'category',
      entityId: id,
      data: input,
      ip,
    });
    return row;
  }

  async createBrand(adminId: string, input: z.infer<typeof brandCreate>, ip: string): Promise<BrandRow> {
    const row = await this.write(async () => {
      const [b] = await this.db
        .insert(brands)
        .values({
          name: input.name,
          slug: input.slug ?? slugify(input.name),
          logoKey: input.logoKey ?? null,
          isActive: input.isActive,
        })
        .returning();
      return b as BrandRow;
    });
    await audit(this.db, { actorId: adminId, action: 'brand.create', entity: 'brand', entityId: row.id, ip });
    return row;
  }

  async updateBrand(adminId: string, id: string, input: z.infer<typeof brandUpdate>, ip: string): Promise<BrandRow> {
    const row = await this.write(async () => {
      const [b] = await this.db.update(brands).set(input).where(eq(brands.id, id)).returning();
      return b;
    });
    if (!row) throw notFound('BRAND_NOT_FOUND', 'Brand not found');
    await audit(this.db, { actorId: adminId, action: 'brand.update', entity: 'brand', entityId: id, data: input, ip });
    return row;
  }

  /** Two levels only: a parent must itself be top-level, and not the category being edited. */
  private async assertValidParent(parentId: string, selfId: string | null): Promise<void> {
    if (parentId === selfId) throw badRequest('INVALID_PARENT', 'A category cannot be its own parent');
    const [parent] = await this.db
      .select({ parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, parentId));
    if (!parent) throw badRequest('INVALID_PARENT', 'Parent category not found');
    if (parent.parentId) throw badRequest('CATEGORY_DEPTH', 'Categories can only be nested one level deep');
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('SLUG_TAKEN', 'That slug is already in use');
      throw err;
    } finally {
      this.invalidate();
    }
  }
}
