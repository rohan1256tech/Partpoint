/** Shapes returned by the backend API (see backend/src/modules). Money is always integer paise. */

export type Role = 'admin' | 'wholesaler' | 'retailer' | 'delivery';
export type UserStatus = 'pending' | 'approved' | 'blocked';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PublicUser {
  id: string;
  role: Role;
  status: UserStatus;
  name: string;
  phone: string | null;
  email: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export interface UserWithProfile extends PublicUser {
  statusReason: string | null;
  profile: Record<string, unknown> | null;
}

export type LoginResult =
  | { user: PublicUser; tokens: { accessToken: string; expiresIn: number } }
  | { status: 'totp_required'; challengeToken: string };

export interface Dashboard {
  generatedAt: string;
  users: { pendingApprovals: number; retailers: number; wholesalers: number; deliveryPartners: number };
  orders: { today: number; thisMonth: number; byStatus: Record<string, number> };
  sales: {
    gmvTodayPaise: number;
    gmvThisMonthPaise: number;
    commissionThisMonthPaise: number;
    deliveryFeesThisMonthPaise: number;
  };
  last30Days: { date: string; orders: number; gmvPaise: number }[];
  topWholesalers: { id: string; name: string; orders: number; gmvPaise: number }[];
  topProducts: { id: string; name: string; qty: number; salesPaise: number }[];
  openReviewReports: number;
  unpaidDeliveryEarningsPaise: number;
}

// ---------------------------------------------------------------- catalog

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  imageKey: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface Brand {
  id: string;
  name: string;
  slug: string;
  logoKey: string | null;
  logoUrl: string | null;
  isActive: boolean;
}

export type ProductStatus = 'draft' | 'active' | 'hidden' | 'blocked';

export interface ProductSummary {
  id: string;
  name: string;
  partNumber: string | null;
  brandName: string | null;
  categoryName: string;
  minPricePaise: number | null;
  mrpPaise: number | null;
  totalStock: number;
  thumbnailUrl: string | null;
  ratingAvg: number;
  ratingCount: number;
  status: ProductStatus;
  statusReason: string | null;
  /** Wholesalers with stock of it. */
  supplierCount: number | null;
  createdAt: string;
}

/** A wholesaler's stock of one variant, and what Partpoint pays them for it. */
export interface Offer {
  wholesalerId: string;
  businessName: string;
  city: string;
  state: string;
  supplyPricePaise: number;
  stockQty: number;
  isActive: boolean;
  /** The wholesaler's account can trade (approved, not deleted). */
  usable: boolean;
  updatedAt: string;
}

export interface Variant {
  id: string;
  name: string;
  sku: string | null;
  mrpPaise: number;
  pricePaise: number;
  /** Units buyers can order now, across all suppliers. */
  stockQty: number;
  minOrderQty: number;
  isActive: boolean;
  slabs: { minQty: number; pricePaise: number }[];
  offers: Offer[] | null;
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
  variants: Variant[];
  createdAt: string;
  updatedAt: string;
}

export interface PresignedUpload {
  objectKey: string;
  upload: { method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: string };
}

// ---------------------------------------------------------------- orders & delivery

export type OrderStatus =
  | 'placed'
  | 'forwarded'
  | 'accepted'
  | 'packed'
  | 'assigned'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalPaise: number;
  itemCount: number;
  /** Null while the order waits for the admin to choose a wholesaler. */
  wholesaler: { id: string; businessName: string } | null;
  retailer: { id: string; shopName: string };
  createdAt: string;
}

export interface Address {
  contactName: string;
  contactPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface OrderDetail extends OrderSummary {
  subtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  /** Partpoint's margin, once forwarded. */
  commissionPaise: number | null;
  /** What Partpoint pays the wholesaler(s). */
  supplyTotalPaise: number | null;
  address: Address;
  items: {
    id: string;
    supplyUnitPricePaise: number | null;
    productId: string;
    variantId: string;
    productName: string;
    variantName: string;
    hsnCode: string | null;
    gstRateBps: number;
    qty: number;
    unitPricePaise: number;
    lineTotalPaise: number;
  }[];
  timeline: { status: OrderStatus; note: string | null; at: string }[];
  /** Other parts of the same checkout, when it was split. */
  siblings: { id: string; orderNumber: string; status: OrderStatus }[];
  cancelReason: string | null;
  deliveredAt: string | null;
  deliveryPartner: { id: string; name: string; phone: string | null } | null;
  deliveryAccepted: boolean;
  deliveryOtpAttempts: number | null;
  pickup: {
    businessName: string;
    addressLine: string;
    city: string;
    state: string;
    pincode: string;
    phone: string | null;
  } | null;
}

/** Who can supply a waiting order. */
export interface SupplierOptions {
  orderId: string;
  status: OrderStatus;
  deliveryArea: { city: string; state: string; pincode: string };
  items: {
    id: string;
    productName: string;
    variantName: string;
    qty: number;
    unitPricePaise: number;
    offers: { wholesalerId: string; supplyPricePaise: number; stockQty: number }[];
  }[];
  wholesalers: {
    id: string;
    businessName: string;
    city: string;
    state: string;
    pincode: string;
    sameCity: boolean;
    itemIds: string[];
    coversAll: boolean;
    supplyTotalPaise: number;
  }[];
  suggestedWholesalerId: string | null;
}

export interface DeliveryPartner {
  id: string;
  name: string;
  phone: string | null;
  vehicleType: string | null;
  vehicleNumber: string | null;
  isAvailable: boolean;
  activeDeliveries: number;
}

// ---------------------------------------------------------------- marketing, reviews, money, settings

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discountType: 'percent' | 'flat';
  /** Basis points for percent, paise for flat. */
  discountValue: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  usageLimit: number | null;
  perUserLimit: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  timesUsed: number;
}

export type BannerLink = 'none' | 'category' | 'product' | 'brand';
export interface Banner {
  id: string;
  title: string;
  imageKey: string;
  imageUrl: string;
  linkType: BannerLink;
  linkValue: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export interface AdminReview {
  id: string;
  productId: string;
  productName: string;
  orderId: string;
  reviewer: string;
  rating: number;
  comment: string | null;
  status: 'visible' | 'hidden';
  openReports: number;
  reportReasons: string[];
  createdAt: string;
}

export interface WholesalerBalance {
  wholesalerId: string;
  businessName: string;
  deliveredOrders: number;
  goodsPaise: number;
  commissionPaise: number;
  owedPaise: number;
  paidPaise: number;
  balancePaise: number;
}

export interface Payout {
  id: string;
  amountPaise: number;
  reference: string | null;
  note: string | null;
  paidAt: string;
}

export interface RiderBalance {
  partnerId: string;
  name: string;
  unpaidPaise: number;
  unpaidDeliveries: number;
}

export interface PlatformSettings {
  commissionBps: number;
  deliveryFeePaise: number;
  minOrderPaise: number;
  deliveryEarningPaise: number;
}

export interface DeletionRequest {
  id: string;
  userId: string | null;
  source: 'app' | 'web' | string;
  contact: string;
  reason: string | null;
  status: 'requested' | 'completed' | 'rejected';
  note: string | null;
  processedAt: string | null;
  createdAt: string;
}

/** A row in the admin user list: the account plus the shop or business it represents. */
export interface UserListItem extends PublicUser {
  businessName: string | null;
}
