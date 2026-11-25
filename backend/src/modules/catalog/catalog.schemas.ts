import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const paise = z.number().int().positive().max(10_000_000_000); // ≤ ₹10 crore
const qty = z.number().int().min(1).max(1_000_000);

/**
 * GST rates in basis points. 0/5/18/40% are the GST 2.0 slabs (from 22 Sep 2025);
 * 12% and 28% are kept for goods still invoiced at legacy rates.
 */
export const GST_RATES_BPS = [0, 500, 1200, 1800, 2800, 4000] as const;
const gstRateBps = z
  .number()
  .int()
  .refine((v) => (GST_RATES_BPS as readonly number[]).includes(v), 'Unsupported GST rate');

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and hyphens')
  .max(80);

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export const idParams = z.object({ id: z.uuid() });
export const variantParams = z.object({ variantId: z.uuid() });
export const imageParams = z.object({ id: z.uuid(), imageId: z.uuid() });

export const pageQuery = {
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
};

// ---- taxonomy (admin)

const objectKey = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}/[0-9a-f-]{36}\\.webp$`), 'Invalid image key');

export const categoryCreate = z.object({
  name: text(80),
  slug: slug.optional(),
  parentId: z.uuid().nullable().optional(),
  imageKey: objectKey('categories').nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
});
export const categoryUpdate = categoryCreate.partial().omit({ sortOrder: true, isActive: true }).extend({
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});

export const brandCreate = z.object({
  name: text(80),
  slug: slug.optional(),
  logoKey: objectKey('brands').nullable().optional(),
  isActive: z.boolean().default(true),
});
export const brandUpdate = brandCreate.partial().omit({ isActive: true }).extend({ isActive: z.boolean().optional() });

export const uploadRequest = z.object({
  kind: z.enum(['categories', 'brands', 'banners']),
  contentType: z.literal('image/webp', 'Images must be WebP'),
  sizeBytes: z.number().int().min(1).max(1024 * 1024),
});

// ---- products (wholesaler)

export const slabInput = z.object({ minQty: z.number().int().min(2).max(1_000_000), pricePaise: paise });

export const variantInput = z.object({
  name: text(80),
  sku: text(60).optional(),
  mrpPaise: paise,
  pricePaise: paise,
  stockQty: z.number().int().min(0).max(10_000_000).default(0),
  minOrderQty: qty.default(1),
  slabs: z.array(slabInput).max(5).default([]),
});
export type VariantInput = z.infer<typeof variantInput>;

export const variantUpdate = z
  .object({
    name: text(80),
    sku: text(60).nullable(),
    mrpPaise: paise,
    pricePaise: paise,
    stockQty: z.number().int().min(0).max(10_000_000),
    minOrderQty: qty,
    isActive: z.boolean(),
    slabs: z.array(slabInput).max(5),
  })
  .partial();

const productFields = {
  categoryId: z.uuid(),
  brandId: z.uuid().nullable().optional(),
  name: text(150),
  description: z.string().trim().max(5000).optional(),
  partNumber: text(60).optional(),
  hsnCode: z
    .string()
    .regex(/^(\d{4}|\d{6}|\d{8})$/, 'HSN code must be 4, 6 or 8 digits')
    .optional(),
  gstRateBps: gstRateBps.default(1800),
};

export const productCreate = z.object({
  ...productFields,
  variants: z.array(variantInput).min(1).max(20),
});

export const productUpdate = z
  .object({
    ...productFields,
    description: productFields.description.nullable(),
    partNumber: productFields.partNumber.nullable(),
    hsnCode: productFields.hsnCode.nullable(),
    gstRateBps,
  })
  .partial();

export const productImageUpload = z.object({
  contentType: z.literal('image/webp', 'Images must be WebP (compressed on the device)'),
  sizeBytes: z.number().int().min(1).max(1024 * 1024),
});
export const productImageAttach = z.object({ objectKey: z.string().max(200) });

// ---- browsing

export const browseQuery = z.object({
  q: z.string().trim().min(2).max(80).optional(),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  wholesalerId: z.uuid().optional(),
  ...pageQuery,
});

export const ownProductsQuery = z.object({
  status: z.enum(['draft', 'active', 'hidden', 'blocked']).optional(),
  q: z.string().trim().min(2).max(80).optional(),
  ...pageQuery,
});

export const adminProductsQuery = ownProductsQuery.extend({ wholesalerId: z.uuid().optional() });

export const reasonBody = z.object({ reason: z.string().trim().min(1).max(500) });
