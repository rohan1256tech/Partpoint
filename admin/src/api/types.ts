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
  variants: {
    id: string;
    name: string;
    sku: string | null;
    mrpPaise: number;
    pricePaise: number;
    stockQty: number;
    minOrderQty: number;
    isActive: boolean;
    slabs: { minQty: number; pricePaise: number }[];
  }[];
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
  wholesaler: { id: string; businessName: string };
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
  commissionPaise: number | null;
  address: Address;
  items: {
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

export interface DeliveryPartner {
  id: string;
  name: string;
  phone: string | null;
  vehicleType: string | null;
  vehicleNumber: string | null;
  isAvailable: boolean;
  activeDeliveries: number;
}
