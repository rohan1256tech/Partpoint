import {
  Alert,
  Button,
  Divider,
  Drawer,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Timeline,
} from '@mantine/core';
import { IconFileInvoice } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { DeliveryPartner, OrderDetail } from '../../api/types';
import { dateTime, humanize, rupees } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { OrderStatusBadge } from './OrderStatusBadge';
import { ADMIN_CANCELLABLE, ASSIGNABLE, DELIVERY_OTP_MAX_ATTEMPTS, INVOICED } from './orderStatus';

export function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get<OrderDetail>(`/v1/admin/orders/${orderId}`),
    enabled: !!orderId,
  });
  const o = detail.data;

  return (
    <Drawer opened={!!orderId} onClose={onClose} position="right" size="xl" title={o ? `Order ${o.orderNumber}` : 'Order'}>
      {detail.error && <Alert color="red">{errorMessage(detail.error)}</Alert>}
      {detail.isLoading || !o ? <Loader /> : <OrderBody o={o} />}
    </Drawer>
  );
}

function OrderBody({ o }: { o: OrderDetail }) {
  const invalidate = [['orders'], ['order', o.id], ['dashboard'], ['delivery-partners']];
  const [downloading, setDownloading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  async function invoice() {
    setDownloading(true);
    setInvoiceError(null);
    try {
      await api.download(`/v1/admin/orders/${o.id}/invoice.pdf`);
    } catch (err) {
      setInvoiceError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <OrderStatusBadge status={o.status} />
          <Text size="sm" c="dimmed">
            Placed {dateTime(o.createdAt)}
          </Text>
        </Group>
        {INVOICED.includes(o.status) || o.status === 'cancelled' ? (
          <Button size="xs" variant="default" leftSection={<IconFileInvoice size={16} />} onClick={() => void invoice()} loading={downloading}>
            GST invoice
          </Button>
        ) : null}
      </Group>
      {invoiceError && (
        <Text size="xs" c="red">
          {invoiceError}
        </Text>
      )}
      {o.cancelReason && (
        <Alert color="gray" title="Cancelled">
          {o.cancelReason}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Party title="Retailer (deliver to)">
          <Text size="sm" fw={600}>
            {o.retailer.shopName}
          </Text>
          <Text size="sm">
            {o.address.contactName} · {o.address.contactPhone}
          </Text>
          <Text size="sm" c="dimmed">
            {[o.address.line1, o.address.line2, o.address.landmark].filter(Boolean).join(', ')}
            <br />
            {o.address.city}, {o.address.state} {o.address.pincode}
          </Text>
        </Party>
        <Party title="Wholesaler (pick up from)">
          <Text size="sm" fw={600}>
            {o.wholesaler.businessName}
          </Text>
          {o.pickup && (
            <Text size="sm" c="dimmed">
              {o.pickup.addressLine}
              <br />
              {o.pickup.city}, {o.pickup.state} {o.pickup.pincode}
              {o.pickup.phone && (
                <>
                  <br />
                  {o.pickup.phone}
                </>
              )}
            </Text>
          )}
        </Party>
      </SimpleGrid>

      <Table fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Item</Table.Th>
            <Table.Th ta="right">Qty</Table.Th>
            <Table.Th ta="right">Unit price</Table.Th>
            <Table.Th ta="right">Amount</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {o.items.map((i) => (
            <Table.Tr key={i.variantId}>
              <Table.Td>
                {i.productName}
                <Text size="xs" c="dimmed">
                  {i.variantName}
                  {i.hsnCode ? ` · HSN ${i.hsnCode}` : ''} · GST {i.gstRateBps / 100}%
                </Text>
              </Table.Td>
              <Table.Td ta="right">{i.qty}</Table.Td>
              <Table.Td ta="right">{rupees(i.unitPricePaise)}</Table.Td>
              <Table.Td ta="right">{rupees(i.lineTotalPaise)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Stack gap={2} align="flex-end">
        <Money label="Subtotal" paise={o.subtotalPaise} />
        {o.discountPaise > 0 && <Money label="Discount" paise={-o.discountPaise} />}
        {o.deliveryFeePaise > 0 && <Money label="Delivery fee" paise={o.deliveryFeePaise} />}
        <Money label="Total" paise={o.totalPaise} bold />
        {o.commissionPaise !== null && <Money label="Platform commission" paise={o.commissionPaise} dimmed />}
      </Stack>

      <Divider />
      <DeliverySection o={o} invalidate={invalidate} />

      <Divider />
      <Text fw={600}>Timeline</Text>
      <Timeline bulletSize={14} lineWidth={2} active={o.timeline.length - 1}>
        {o.timeline.map((e, idx) => (
          <Timeline.Item key={idx} title={humanize(e.status)}>
            <Text size="xs" c="dimmed">
              {dateTime(e.at)}
            </Text>
            {e.note && <Text size="sm">{e.note}</Text>}
          </Timeline.Item>
        ))}
      </Timeline>

      {ADMIN_CANCELLABLE.includes(o.status) && <CancelSection o={o} invalidate={invalidate} />}
    </Stack>
  );
}

function DeliverySection({ o, invalidate }: { o: OrderDetail; invalidate: string[][] }) {
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const partners = useQuery({
    queryKey: ['delivery-partners', 'available'],
    queryFn: () => api.get<{ items: DeliveryPartner[] }>('/v1/admin/delivery-partners', { available: 'true' }),
    enabled: ASSIGNABLE.includes(o.status),
  });
  const assign = useAction({
    run: () => api.post<OrderDetail>(`/v1/admin/orders/${o.id}/assign`, { deliveryPartnerId: partnerId }),
    success: (r: OrderDetail) => `Assigned to ${r.deliveryPartner?.name ?? 'rider'}`,
    invalidate,
    onDone: () => setPartnerId(null),
  });
  const resetOtp = useAction({
    run: () => api.post<OrderDetail>(`/v1/admin/orders/${o.id}/reset-delivery-otp`),
    success: 'Delivery code unlocked',
    invalidate,
  });
  const locked = (o.deliveryOtpAttempts ?? 0) >= DELIVERY_OTP_MAX_ATTEMPTS;

  return (
    <Stack gap="xs">
      <Text fw={600}>Delivery</Text>
      {o.deliveryPartner ? (
        <Text size="sm">
          {o.deliveryPartner.name}
          {o.deliveryPartner.phone ? ` · ${o.deliveryPartner.phone}` : ''} ·{' '}
          {o.deliveryAccepted ? 'accepted the job' : 'has not accepted yet'}
        </Text>
      ) : (
        <Text size="sm" c="dimmed">
          No rider assigned.
        </Text>
      )}
      {locked && (
        <Alert color="orange" title="Delivery code locked">
          The rider entered a wrong code {o.deliveryOtpAttempts} times. Confirm with the retailer before unlocking.
          <Group mt="xs">
            <Button size="xs" color="orange" onClick={() => resetOtp.mutate(undefined)} loading={resetOtp.isPending}>
              Unlock code
            </Button>
          </Group>
        </Alert>
      )}
      {ASSIGNABLE.includes(o.status) && (
        <Group align="flex-end">
          <Select
            label={o.deliveryPartner ? 'Reassign to' : 'Assign a rider'}
            placeholder={partners.isLoading ? 'Loading…' : 'Choose an available rider'}
            data={(partners.data?.items ?? [])
              .filter((p) => p.id !== o.deliveryPartner?.id)
              .map((p) => ({
                value: p.id,
                label: `${p.name}${p.vehicleType ? ` (${p.vehicleType})` : ''} · ${p.activeDeliveries} active`,
              }))}
            value={partnerId}
            onChange={setPartnerId}
            nothingFoundMessage="No riders are available"
            searchable
            w={320}
          />
          <Button onClick={() => assign.mutate(undefined)} disabled={!partnerId} loading={assign.isPending}>
            {o.deliveryPartner ? 'Reassign' : 'Assign'}
          </Button>
        </Group>
      )}
    </Stack>
  );
}

function CancelSection({ o, invalidate }: { o: OrderDetail; invalidate: string[][] }) {
  const [reason, setReason] = useState('');
  const cancel = useAction({
    run: () => api.post<OrderDetail>(`/v1/admin/orders/${o.id}/cancel`, { reason: reason.trim() }),
    success: 'Order cancelled; stock returned',
    invalidate,
    onDone: () => setReason(''),
  });
  return (
    <>
      <Divider />
      <Stack gap="xs">
        <Textarea
          label="Cancel this order"
          description="The retailer, wholesaler and any assigned rider are notified. Stock goes back on sale."
          placeholder="Reason"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Group>
          <Button color="red" variant="light" disabled={!reason.trim()} onClick={() => cancel.mutate(undefined)} loading={cancel.isPending}>
            Cancel order
          </Button>
        </Group>
      </Stack>
    </>
  );
}

function Party({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {title}
      </Text>
      {children}
    </Stack>
  );
}

function Money({ label, paise, bold, dimmed }: { label: string; paise: number; bold?: boolean; dimmed?: boolean }) {
  return (
    <Group gap="lg" justify="flex-end">
      <Text size="sm" c={dimmed ? 'dimmed' : undefined}>
        {label}
      </Text>
      <Text size="sm" fw={bold ? 700 : undefined} c={dimmed ? 'dimmed' : undefined} w={120} ta="right" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {rupees(paise)}
      </Text>
    </Group>
  );
}
