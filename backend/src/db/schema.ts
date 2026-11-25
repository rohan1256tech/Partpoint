/**
 * Partpoint database schema (v1).
 *
 * Conventions:
 * - All money is stored as BIGINT paise (`*Paise` columns). Never floats.
 * - Percentages are stored as integer basis points (`*Bps`, 1800 = 18%).
 * - Column names are camelCase in TS and snake_case in Postgres (casing: 'snake_case').
 * - Timestamps are timestamptz.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const id = () => uuid().primaryKey().defaultRandom();
const paise = () => bigint({ mode: 'number' });
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum('user_role', ['admin', 'wholesaler', 'retailer', 'delivery']);
export const userStatus = pgEnum('user_status', ['pending', 'approved', 'blocked']);
export const clientApp = pgEnum('client_app', ['partpoint', 'delivery', 'admin']);
export const otpChannel = pgEnum('otp_channel', ['sms', 'email']);
export const otpPurpose = pgEnum('otp_purpose', ['login', 'signup', 'reset_password', 'verify_email']);
export const productStatus = pgEnum('product_status', ['draft', 'active', 'hidden', 'blocked']);
export const discountType = pgEnum('discount_type', ['percent', 'flat']);
/** 'placed': orders created without online payment (settled offline in v1). The rest are for a future gateway. */
export const checkoutStatus = pgEnum('checkout_status', ['pending_payment', 'paid', 'failed', 'expired', 'placed']);
export const paymentStatus = pgEnum('payment_status', ['created', 'authorized', 'captured', 'failed', 'refunded']);
export const orderStatus = pgEnum('order_status', [
  'placed',
  'accepted',
  'packed',
  'assigned',
  'picked_up',
  'out_for_delivery',
  'delivered',
  'cancelled',
]);
export const reviewStatus = pgEnum('review_status', ['visible', 'hidden']);
export const deletionStatus = pgEnum('deletion_status', ['requested', 'completed', 'rejected']);

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: id(),
    role: userRole().notNull(),
    status: userStatus().notNull().default('pending'),
    name: text().notNull(),
    phone: text(), // E.164, e.g. +919876543210
    email: text(), // stored lower-cased
    passwordHash: text(),
    phoneVerifiedAt: timestamp({ withTimezone: true }),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    statusReason: text(),
    /** DPDP: when the user accepted the privacy policy, and which version. */
    consentAt: timestamp({ withTimezone: true }),
    consentVersion: text(),
    /** Admin 2FA: TOTP secret, AES-GCM encrypted (lib/totp.ts SecretBox). */
    totpSecret: text(),
    totpEnabledAt: timestamp({ withTimezone: true }),
    /** Last accepted TOTP time step; older or equal steps are refused (no replay). */
    totpLastStep: bigint({ mode: 'number' }),
    approvedBy: uuid(),
    approvedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_phone_uq').on(t.phone),
    uniqueIndex('users_email_uq').on(t.email),
    index('users_role_status_idx').on(t.role, t.status),
    // Every live account needs a way to sign in; deleted accounts have their contact details erased.
    check('users_contact_ck', sql`${t.deletedAt} IS NOT NULL OR ${t.phone} IS NOT NULL OR ${t.email} IS NOT NULL`),
  ],
);

export const wholesalerProfiles = pgTable('wholesaler_profiles', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  businessName: text().notNull(),
  gstin: text(),
  addressLine: text().notNull(),
  city: text().notNull(),
  state: text().notNull(),
  pincode: text().notNull(),
  latitude: doublePrecision(),
  longitude: doublePrecision(),
  /** Overrides the platform default commission when set. */
  commissionBps: integer(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const retailerProfiles = pgTable('retailer_profiles', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  shopName: text().notNull(),
  gstin: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const deliveryProfiles = pgTable('delivery_profiles', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  vehicleType: text(),
  vehicleNumber: text(),
  isAvailable: boolean().notNull().default(false),
  lastLatitude: doublePrecision(),
  lastLongitude: doublePrecision(),
  lastLocationAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const addresses = pgTable(
  'addresses',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text().notNull().default('Shop'),
    contactName: text().notNull(),
    contactPhone: text().notNull(),
    line1: text().notNull(),
    line2: text(),
    landmark: text(),
    city: text().notNull(),
    state: text().notNull(),
    pincode: text().notNull(),
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    isDefault: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('addresses_user_idx').on(t.userId)],
);

/** Refresh-token sessions. Tokens are rotated on every use; only a hash is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    app: clientApp().notNull(),
    deviceId: text().notNull(),
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    /** When this session passed a second factor (admin TOTP). */
    mfaAt: timestamp({ withTimezone: true }),
    lastUsedAt: timestamp({ withTimezone: true }),
    userAgent: text(),
    ip: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_hash_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: id(),
    channel: otpChannel().notNull(),
    target: text().notNull(), // phone (E.164) or lower-cased email
    purpose: otpPurpose().notNull(),
    codeHash: text().notNull(),
    attempts: smallint().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    ip: text(),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_target_idx').on(t.target, t.purpose, t.createdAt)],
);

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    app: clientApp().notNull(),
    token: text().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('push_tokens_token_uq').on(t.token), index('push_tokens_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: id(),
    parentId: uuid().references((): AnyPgColumn => categories.id),
    name: text().notNull(),
    slug: text().notNull(),
    imageKey: text(),
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('categories_slug_uq').on(t.slug), index('categories_parent_idx').on(t.parentId)],
);

export const brands = pgTable(
  'brands',
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull(),
    logoKey: text(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('brands_slug_uq').on(t.slug)],
);

export const products = pgTable(
  'products',
  {
    id: id(),
    wholesalerId: uuid()
      .notNull()
      .references(() => users.id),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id),
    brandId: uuid().references(() => brands.id),
    name: text().notNull(),
    description: text(),
    partNumber: text(),
    hsnCode: text(),
    gstRateBps: integer().notNull().default(1800),
    status: productStatus().notNull().default('draft'),
    /** Why an admin blocked the product; shown to the wholesaler. */
    statusReason: text(),
    ratingAvg: doublePrecision().notNull().default(0),
    ratingCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('products_wholesaler_idx').on(t.wholesalerId),
    index('products_category_status_idx').on(t.categoryId, t.status),
    index('products_brand_idx').on(t.brandId),
    index('products_status_created_idx').on(t.status, t.createdAt.desc(), t.id.desc()),
    // Requires the pg_trgm extension (migration 0002).
    index('products_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    index('products_part_number_trgm_idx').using('gin', t.partNumber.op('gin_trgm_ops')),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text(),
    name: text().notNull(), // e.g. "Pack of 10", "Front - Left"
    mrpPaise: paise().notNull(),
    pricePaise: paise().notNull(),
    stockQty: integer().notNull().default(0),
    minOrderQty: integer().notNull().default(1),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('product_variants_product_idx').on(t.productId),
    check('product_variants_stock_ck', sql`${t.stockQty} >= 0`),
    check('product_variants_price_ck', sql`${t.pricePaise} > 0 AND ${t.pricePaise} <= ${t.mrpPaise}`),
    check('product_variants_moq_ck', sql`${t.minOrderQty} >= 1`),
  ],
);

/** Bulk pricing: buying >= minQty units costs pricePaise per unit. */
export const priceSlabs = pgTable(
  'price_slabs',
  {
    id: id(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    minQty: integer().notNull(),
    pricePaise: paise().notNull(),
  },
  (t) => [
    uniqueIndex('price_slabs_variant_qty_uq').on(t.variantId, t.minQty),
    check('price_slabs_qty_ck', sql`${t.minQty} >= 2`),
    check('price_slabs_price_ck', sql`${t.pricePaise} > 0`),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: id(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    objectKey: text().notNull(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('product_images_product_idx').on(t.productId)],
);

// ---------------------------------------------------------------------------
// Shopping
// ---------------------------------------------------------------------------

export const cartItems = pgTable(
  'cart_items',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    qty: integer().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.variantId] }), check('cart_items_qty_ck', sql`${t.qty} > 0`)],
);

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);

export const coupons = pgTable(
  'coupons',
  {
    id: id(),
    code: text().notNull(), // stored upper-cased
    description: text(),
    discountType: discountType().notNull(),
    /** Basis points when percent, paise when flat. */
    discountValue: bigint({ mode: 'number' }).notNull(),
    maxDiscountPaise: paise(),
    minOrderPaise: paise().notNull().default(0),
    usageLimit: integer(),
    perUserLimit: integer().notNull().default(1),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('coupons_code_uq').on(t.code), check('coupons_value_ck', sql`${t.discountValue} > 0`)],
);

export const banners = pgTable('banners', {
  id: id(),
  title: text().notNull(),
  imageKey: text().notNull(),
  /** e.g. 'category' | 'product' | 'brand' | 'none' */
  linkType: text().notNull().default('none'),
  linkValue: text(),
  sortOrder: integer().notNull().default(0),
  isActive: boolean().notNull().default(true),
  startsAt: timestamp({ withTimezone: true }),
  endsAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Checkout, payments, orders
// ---------------------------------------------------------------------------

/** One retailer checkout (one payment). Split into one order per wholesaler once paid. */
export const checkouts = pgTable(
  'checkouts',
  {
    id: id(),
    retailerId: uuid()
      .notNull()
      .references(() => users.id),
    idempotencyKey: text().notNull(),
    status: checkoutStatus().notNull().default('pending_payment'),
    addressSnapshot: jsonb().notNull(),
    couponId: uuid().references(() => coupons.id),
    subtotalPaise: paise().notNull(),
    discountPaise: paise().notNull().default(0),
    deliveryFeePaise: paise().notNull().default(0),
    totalPaise: paise().notNull(),
    razorpayOrderId: text(),
    paidAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('checkouts_idempotency_uq').on(t.retailerId, t.idempotencyKey),
    uniqueIndex('checkouts_razorpay_order_uq').on(t.razorpayOrderId),
    check('checkouts_total_ck', sql`${t.totalPaise} >= 0`),
  ],
);

export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: id(),
    couponId: uuid()
      .notNull()
      .references(() => coupons.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    checkoutId: uuid()
      .notNull()
      .references(() => checkouts.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('coupon_redemptions_checkout_uq').on(t.checkoutId),
    index('coupon_redemptions_coupon_user_idx').on(t.couponId, t.userId),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    checkoutId: uuid()
      .notNull()
      .references(() => checkouts.id),
    razorpayPaymentId: text().notNull(),
    amountPaise: paise().notNull(),
    method: text(),
    status: paymentStatus().notNull(),
    raw: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_razorpay_payment_uq').on(t.razorpayPaymentId),
    index('payments_checkout_idx').on(t.checkoutId),
  ],
);

/** Order handled by one wholesaler and (optionally) one delivery partner. */
export const orders = pgTable(
  'orders',
  {
    id: id(),
    orderNumber: text().notNull(), // human-readable, e.g. PP-20261125-00042
    checkoutId: uuid()
      .notNull()
      .references(() => checkouts.id),
    retailerId: uuid()
      .notNull()
      .references(() => users.id),
    wholesalerId: uuid()
      .notNull()
      .references(() => users.id),
    deliveryPartnerId: uuid().references(() => users.id),
    status: orderStatus().notNull().default('placed'),
    addressSnapshot: jsonb().notNull(),
    subtotalPaise: paise().notNull(),
    discountPaise: paise().notNull().default(0),
    deliveryFeePaise: paise().notNull().default(0),
    totalPaise: paise().notNull(),
    commissionPaise: paise().notNull().default(0),
    deliveryOtpHash: text(), // unused: the delivery OTP is derived from OTP_SECRET + order id (see delivery-otp.ts)
    /** When the assigned delivery partner accepted the job. */
    deliveryAcceptedAt: timestamp({ withTimezone: true }),
    /** Wrong delivery-OTP entries; locked after 5 until an admin resets it. */
    deliveryOtpAttempts: smallint().notNull().default(0),
    invoiceKey: text(),
    cancelReason: text(),
    deliveredAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_number_uq').on(t.orderNumber),
    index('orders_retailer_idx').on(t.retailerId, t.createdAt),
    index('orders_wholesaler_idx').on(t.wholesalerId, t.createdAt),
    index('orders_delivery_idx').on(t.deliveryPartnerId, t.status),
    index('orders_status_idx').on(t.status),
    index('orders_checkout_idx').on(t.checkoutId),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    // Snapshots: invoices must not change if the product is edited later.
    productName: text().notNull(),
    variantName: text().notNull(),
    hsnCode: text(),
    gstRateBps: integer().notNull(),
    qty: integer().notNull(),
    unitPricePaise: paise().notNull(),
    lineTotalPaise: paise().notNull(),
  },
  (t) => [index('order_items_order_idx').on(t.orderId), check('order_items_qty_ck', sql`${t.qty} > 0`)],
);

/** Append-only status history (drives tracking timeline and audit). */
export const orderEvents = pgTable(
  'order_events',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    status: orderStatus().notNull(),
    actorId: uuid().references(() => users.id),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Earnings & payouts
// ---------------------------------------------------------------------------

export const deliveryEarnings = pgTable(
  'delivery_earnings',
  {
    id: id(),
    deliveryPartnerId: uuid()
      .notNull()
      .references(() => users.id),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    amountPaise: paise().notNull(),
    paidOutAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('delivery_earnings_order_uq').on(t.orderId),
    index('delivery_earnings_partner_idx').on(t.deliveryPartnerId, t.createdAt),
  ],
);

export const wholesalerPayouts = pgTable(
  'wholesaler_payouts',
  {
    id: id(),
    wholesalerId: uuid()
      .notNull()
      .references(() => users.id),
    amountPaise: paise().notNull(),
    reference: text(), // bank UTR / transaction reference
    note: text(),
    paidAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('wholesaler_payouts_wholesaler_idx').on(t.wholesalerId, t.paidAt),
    check('wholesaler_payouts_amount_ck', sql`${t.amountPaise} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Reviews (UGC — must support reporting + moderation for Play policy)
// ---------------------------------------------------------------------------

export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    retailerId: uuid()
      .notNull()
      .references(() => users.id),
    rating: smallint().notNull(),
    comment: text(),
    status: reviewStatus().notNull().default('visible'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('reviews_unique_per_order_uq').on(t.orderId, t.productId, t.retailerId),
    index('reviews_product_idx').on(t.productId, t.status),
    check('reviews_rating_ck', sql`${t.rating} BETWEEN 1 AND 5`),
  ],
);

export const reviewReports = pgTable(
  'review_reports',
  {
    id: id(),
    reviewId: uuid()
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    reporterId: uuid()
      .notNull()
      .references(() => users.id),
    reason: text().notNull(),
    resolvedAt: timestamp({ withTimezone: true }),
    resolvedBy: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('review_reports_once_uq').on(t.reviewId, t.reporterId)],
);

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

/** Cached responses for idempotent write endpoints (safe client retries). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    route: text().notNull(),
    requestHash: text().notNull(),
    statusCode: smallint(),
    responseBody: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] }), index('idempotency_keys_created_idx').on(t.createdAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: uuid().references(() => users.id),
    action: text().notNull(), // e.g. 'user.approve', 'product.block'
    entity: text().notNull(),
    entityId: text(),
    data: jsonb(),
    ip: text(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_entity_idx').on(t.entity, t.entityId), index('audit_logs_created_idx').on(t.createdAt)],
);

/** Key/value platform settings (default commission, delivery fee, etc.). */
export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedBy: uuid().references(() => users.id),
  updatedAt: updatedAt(),
});

/** Account deletion requests (in-app and public web form — required by Play policy). */
export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: id(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** 'app' (signed in, processed at once) or 'web' (public form, processed by an admin). */
    source: text().notNull().default('web'),
    contact: text().notNull(),
    reason: text(),
    status: deletionStatus().notNull().default('requested'),
    /** Outcome note, e.g. why a request was rejected. */
    note: text(),
    processedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('account_deletion_requests_status_idx').on(t.status, t.createdAt)],
);
