import type { OrderStatus } from '../../api/types';

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  placed: 'red',
  forwarded: 'blue',
  accepted: 'cyan',
  packed: 'violet',
  assigned: 'grape',
  picked_up: 'orange',
  out_for_delivery: 'orange',
  delivered: 'green',
  cancelled: 'gray',
};

/** Statuses in which the admin may still cancel (before the rider picks the goods up). */
export const ADMIN_CANCELLABLE: readonly OrderStatus[] = ['placed', 'forwarded', 'accepted', 'packed', 'assigned'];

/** How the admin panel names each status. "placed" orders wait for the admin. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Needs wholesaler',
  forwarded: 'Sent to wholesaler',
  accepted: 'Accepted',
  packed: 'Packed',
  assigned: 'Rider assigned',
  picked_up: 'Picked up',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Packed orders wait for a rider; assigned ones can be reassigned until pickup. */
export const ASSIGNABLE: readonly OrderStatus[] = ['packed', 'assigned'];

/** An invoice exists once the wholesaler has packed the order. */
export const INVOICED: readonly OrderStatus[] = ['packed', 'assigned', 'picked_up', 'out_for_delivery', 'delivered'];

export const DELIVERY_OTP_MAX_ATTEMPTS = 5;
