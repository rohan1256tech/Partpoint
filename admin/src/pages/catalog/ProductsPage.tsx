import {
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Image,
  Loader,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from '../../api/client';
import type { Page, ProductDetail, ProductStatus, ProductSummary, PublicUser } from '../../api/types';
import { count, dateTime, humanize, rupees } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { Thumb } from '../../components/Thumb';
import { rowLink } from '../../lib/rowLink';
import { IconPackage } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';

const STATUS_COLOR: Record<ProductStatus, string> = { draft: 'gray', active: 'green', hidden: 'yellow', blocked: 'red' };

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge variant="light" color={STATUS_COLOR[status]}>
      {humanize(status)}
    </Badge>
  );
}

/** Moderation: wholesalers own their listings; the admin can block (with a reason) and unblock. */
export function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const wholesalerId = params.get('wholesalerId') ?? '';
  const [q, setQ] = useState('');
  const [debouncedQ] = useDebouncedValue(q.trim(), 300);
  const [openId, setOpenId] = useState<string | null>(null);

  const wholesalers = useQuery({
    queryKey: ['wholesalers', 'approved'],
    queryFn: () => api.get<Page<PublicUser>>('/v1/admin/users', { role: 'wholesaler', limit: 100 }),
  });

  const list = useInfiniteQuery({
    queryKey: ['products', status, wholesalerId, debouncedQ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Page<ProductSummary>>('/v1/admin/products', {
        status: status === 'all' ? undefined : status,
        wholesalerId: wholesalerId || undefined,
        q: debouncedQ.length >= 2 ? debouncedQ : undefined,
        cursor: pageParam,
        limit: 50,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const products = list.data?.pages.flatMap((p) => p.items) ?? [];

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <Stack>
      <Title order={2}>Products</Title>
      <Group align="flex-end">
        <SegmentedControl
          value={status}
          onChange={(v) => set('status', v)}
          data={['all', 'active', 'draft', 'hidden', 'blocked'].map((s) => ({ value: s, label: humanize(s) }))}
        />
        <Select
          placeholder="All wholesalers"
          clearable
          searchable
          value={wholesalerId || null}
          onChange={(v) => set('wholesalerId', v ?? '')}
          data={(wholesalers.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))}
          w={240}
          aria-label="Wholesaler"
        />
        <TextInput placeholder="Search name or part number" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={260} aria-label="Search" />
      </Group>

      {list.error && <Alert color="red">{errorMessage(list.error)}</Alert>}
      {list.isLoading ? (
        <Loader />
      ) : products.length === 0 ? (
        <EmptyState icon={IconPackage} title="No products match">Wholesalers add products in the Partpoint app. Try another status, wholesaler or search.</EmptyState>
      ) : (
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Product</Table.Th>
              <Table.Th>Wholesaler</Table.Th>
              <Table.Th ta="right">From</Table.Th>
              <Table.Th ta="right">Stock</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {products.map((p) => (
              <Table.Tr key={p.id} {...rowLink(() => setOpenId(p.id))}>
                <Table.Td>
                  <Group gap="sm" wrap="nowrap">
                    <Thumb src={p.thumbnailUrl} size={36} />
                    <div>
                      <Text size="sm" fw={600}>
                        {p.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {[p.brandName, p.partNumber].filter(Boolean).join(' · ')}
                      </Text>
                    </div>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p.wholesaler.businessName}</Text>
                  <Text size="xs" c="dimmed">
                    {p.wholesaler.city}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">{p.minPricePaise !== null ? rupees(p.minPricePaise) : '—'}</Table.Td>
                <Table.Td ta="right">{count(p.totalStock)}</Table.Td>
                <Table.Td>
                  <ProductStatusBadge status={p.status} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {list.hasNextPage && (
        <Button variant="default" w="fit-content" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
          Load more
        </Button>
      )}

      <ProductDrawer productId={openId} onClose={() => setOpenId(null)} />
    </Stack>
  );
}

function ProductDrawer({ productId, onClose }: { productId: string | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const detail = useQuery({
    queryKey: ['product', productId],
    queryFn: () => api.get<ProductDetail>(`/v1/admin/products/${productId}`),
    enabled: !!productId,
  });
  const moderate = useAction({
    run: (action: 'block' | 'unblock') =>
      api.post<ProductDetail>(`/v1/admin/products/${productId}/${action}`, action === 'block' ? { reason: reason.trim() } : {}),
    success: (_p: ProductDetail, action) => (action === 'block' ? 'Product blocked' : 'Product unblocked (hidden until the wholesaler publishes it)'),
    invalidate: [['products'], ['product', productId]],
    onDone: () => setReason(''),
  });

  const p = detail.data;
  return (
    <Drawer opened={!!productId} onClose={onClose} position="right" size="lg" title={p?.name ?? 'Product'}>
      {detail.isLoading || !p ? (
        <Loader />
      ) : (
        <Stack>
          <Group>
            <ProductStatusBadge status={p.status} />
            <Text size="sm" c="dimmed">
              {p.wholesaler.businessName}, {p.wholesaler.city} · updated {dateTime(p.updatedAt)}
            </Text>
          </Group>
          {p.statusReason && <Alert color="red" title="Blocked">{p.statusReason}</Alert>}

          {p.images.length > 0 && (
            <SimpleGrid cols={4}>
              {p.images.map((img) => (
                <Image key={img.id} src={img.url} radius="sm" h={96} fit="cover" alt="" />
              ))}
            </SimpleGrid>
          )}

          <Table fz="sm" verticalSpacing={4}>
            <Table.Tbody>
              <Info label="Category" value={p.category.name} />
              <Info label="Brand" value={p.brand?.name ?? null} />
              <Info label="Part number" value={p.partNumber} />
              <Info label="HSN / GST" value={`${p.hsnCode ?? '—'} / ${p.gstRateBps / 100}%`} />
              <Info label="Rating" value={p.ratingCount ? `${p.ratingAvg.toFixed(1)} (${p.ratingCount})` : null} />
            </Table.Tbody>
          </Table>
          {p.description && (
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              {p.description}
            </Text>
          )}

          <Text fw={600}>Variants</Text>
          <Table fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Variant</Table.Th>
                <Table.Th ta="right">MRP</Table.Th>
                <Table.Th ta="right">Price</Table.Th>
                <Table.Th ta="right">Stock</Table.Th>
                <Table.Th>Bulk prices</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {p.variants.map((v) => (
                <Table.Tr key={v.id} c={v.isActive ? undefined : 'dimmed'}>
                  <Table.Td>
                    {v.name}
                    {!v.isActive && ' (inactive)'}
                  </Table.Td>
                  <Table.Td ta="right">{rupees(v.mrpPaise)}</Table.Td>
                  <Table.Td ta="right">{rupees(v.pricePaise)}</Table.Td>
                  <Table.Td ta="right">{count(v.stockQty)}</Table.Td>
                  <Table.Td>
                    {v.slabs.length ? v.slabs.map((s) => `${s.minQty}+ @ ${rupees(s.pricePaise)}`).join(', ') : '—'}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          {p.status === 'blocked' ? (
            <Button variant="light" onClick={() => moderate.mutate('unblock')} loading={moderate.isPending}>
              Unblock
            </Button>
          ) : (
            <Stack gap="xs">
              <Textarea
                label="Reason for blocking"
                description="The wholesaler sees this reason. Blocked products disappear from the app at once."
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.currentTarget.value)}
              />
              <Button color="red" variant="light" disabled={!reason.trim()} onClick={() => moderate.mutate('block')} loading={moderate.isPending}>
                Block product
              </Button>
            </Stack>
          )}
        </Stack>
      )}
    </Drawer>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <Table.Tr>
      <Table.Td c="dimmed" w={130}>
        {label}
      </Table.Td>
      <Table.Td>{value ?? '—'}</Table.Td>
    </Table.Tr>
  );
}
