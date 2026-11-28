import { Alert, Badge, Button, Group, Loader, Select, Stack, Table, Tabs, Title } from '@mantine/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from '../../api/client';
import type { OrderStatus, OrderSummary, Page, PublicUser } from '../../api/types';
import { count, dateTime, rupees } from '../../lib/format';
import { OrderDrawer } from './OrderDrawer';
import { OrderStatusBadge } from './OrderStatusBadge';
import { rowLink } from '../../lib/rowLink';
import { IconReceipt } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';

/**
 * Tabs follow the operator's work: every new order needs a wholesaler first, then a rider once
 * it is packed.
 */
const TABS: { value: string; label: string; query: { status?: OrderStatus; scope?: 'active' | 'history' } }[] = [
  { value: 'all', label: 'All', query: {} },
  { value: 'placed', label: 'Needs wholesaler', query: { status: 'placed' } },
  { value: 'forwarded', label: 'With wholesaler', query: { status: 'forwarded' } },
  { value: 'accepted', label: 'Accepted', query: { status: 'accepted' } },
  { value: 'packed', label: 'Needs a rider', query: { status: 'packed' } },
  { value: 'active', label: 'Out with riders', query: { scope: 'active' } },
  { value: 'delivered', label: 'Delivered', query: { status: 'delivered' } },
  { value: 'cancelled', label: 'Cancelled', query: { status: 'cancelled' } },
];

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'all';
  const wholesalerId = params.get('wholesalerId') ?? '';
  const [openId, setOpenId] = useState<string | null>(params.get('order'));
  const query = TABS.find((t) => t.value === tab)?.query ?? {};

  const wholesalers = useQuery({
    queryKey: ['wholesalers', 'approved'],
    queryFn: () => api.get<Page<PublicUser>>('/v1/admin/users', { role: 'wholesaler', limit: 100 }),
  });

  const waiting = useQuery({
    queryKey: ['orders', 'waiting-count'],
    queryFn: () => api.get<Page<OrderSummary>>('/v1/admin/orders', { status: 'placed', limit: 50 }),
    refetchInterval: 30_000,
  });
  const waitingCount = waiting.data?.items.length ?? 0;

  const list = useInfiniteQuery({
    queryKey: ['orders', tab, wholesalerId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Page<OrderSummary>>('/v1/admin/orders', {
        ...query,
        wholesalerId: wholesalerId || undefined,
        cursor: pageParam,
        limit: 50,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 30_000,
  });
  const orders = list.data?.pages.flatMap((p) => p.items) ?? [];

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <Stack>
      <Title order={2}>Orders</Title>
      <Tabs value={tab} onChange={(v) => set('tab', v)}>
        <Tabs.List>
          {TABS.map((t) => (
            <Tabs.Tab
              key={t.value}
              value={t.value}
              rightSection={
                t.value === 'placed' && waitingCount > 0 ? (
                  <Badge size="sm" color="red" circle={waitingCount < 10}>
                    {waitingCount >= 50 ? '50+' : waitingCount}
                  </Badge>
                ) : null
              }
            >
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      <Select
        placeholder="All wholesalers"
        clearable
        searchable
        value={wholesalerId || null}
        onChange={(v) => set('wholesalerId', v)}
        data={(wholesalers.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))}
        w={260}
        aria-label="Wholesaler"
      />

      {list.error && <Alert color="red">{errorMessage(list.error)}</Alert>}
      {list.isLoading ? (
        <Loader />
      ) : orders.length === 0 ? (
        <EmptyState icon={IconReceipt} title="No orders here">Orders appear as soon as retailers place them. Try another tab or wholesaler.</EmptyState>
      ) : (
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Order</Table.Th>
              <Table.Th>Retailer</Table.Th>
              <Table.Th>Wholesaler</Table.Th>
              <Table.Th ta="right">Items</Table.Th>
              <Table.Th ta="right">Total</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Placed</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {orders.map((o) => (
              <Table.Tr key={o.id} {...rowLink(() => setOpenId(o.id))}>
                <Table.Td ff="monospace" fz="sm">
                  {o.orderNumber}
                </Table.Td>
                <Table.Td>{o.retailer.shopName}</Table.Td>
                <Table.Td c={o.wholesaler ? undefined : 'dimmed'}>{o.wholesaler?.businessName ?? '—'}</Table.Td>
                <Table.Td ta="right">{count(o.itemCount)}</Table.Td>
                <Table.Td ta="right">{rupees(o.totalPaise)}</Table.Td>
                <Table.Td>
                  <OrderStatusBadge status={o.status} />
                </Table.Td>
                <Table.Td>{dateTime(o.createdAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {list.hasNextPage && (
        <Group>
          <Button variant="default" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
            Load more
          </Button>
        </Group>
      )}

      <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} />
    </Stack>
  );
}
