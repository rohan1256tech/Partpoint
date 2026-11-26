import { Badge } from '@mantine/core';
import type { OrderStatus } from '../../api/types';
import { humanize } from '../../lib/format';
import { ORDER_STATUS_COLOR } from './orderStatus';

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="light" color={ORDER_STATUS_COLOR[status]}>
      {humanize(status)}
    </Badge>
  );
}
