import { Badge } from '@mantine/core';
import type { OrderStatus } from '../../api/types';
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL } from './orderStatus';

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="light" color={ORDER_STATUS_COLOR[status]}>
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  );
}
