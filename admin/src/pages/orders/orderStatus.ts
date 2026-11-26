import type { OrderStatus } from '../../api/types';

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  placed: 'blue',
  accepted: 'cyan',
  packed: 'violet',
  assigned: 'grape',
  picked_up: 'orange',
  out_for_delivery: 'orange',
  delivered: 'green',
  cancelled: 'gray',
};

/** Statuses in which the admin may still cancel (before the rider picks the goods up). */
export const ADMIN_CANCELLABLE: readonly OrderStatus[] = ['placed', 'accepted', 'packed', 'assigned'];

/** Packed orders wait for a rider; assigned ones can be reassigned until pickup. */
export const ASSIGNABLE: readonly OrderStatus[] = ['packed', 'assigned'];

/** An invoice exists once the wholesaler has packed the order. */
export const INVOICED: readonly OrderStatus[] = ['packed', 'assigned', 'picked_up', 'out_for_delivery', 'delivered'];

export const DELIVERY_OTP_MAX_ATTEMPTS = 5;
