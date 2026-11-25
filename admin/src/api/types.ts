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
