import { Alert, Badge, Button, Checkbox, Group, Loader, SegmentedControl, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPackage, IconPlus } from '@tabler/icons-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from '../../api/client';
import type { Category, Page, ProductStatus, ProductSummary, PublicUser } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { Thumb } from '../../components/Thumb';
import { count, humanize, rupees } from '../../lib/format';
import { rowLink } from '../../lib/rowLink';
import { ProductEditor } from './ProductEditor';

const STATUS_COLOR: Record<ProductStatus, string> = { draft: 'gray', active: 'green', hidden: 'yellow', blocked: 'red' };

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge variant="light" color={STATUS_COLOR[status]}>
      {status === 'active' ? 'Live' : humanize(status)}
    </Badge>
  );
}

/**
 * Partpoint's catalog. The admin creates products and sets what retailers pay; wholesalers add
 * their stock and supply price to each variant from the Partpoint app.
 */
export function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const wholesalerId = params.get('wholesalerId') ?? '';
  const categoryId = params.get('categoryId') ?? '';
  const outOfStock = params.get('stock') === 'out';
  const [q, setQ] = useState('');
  const [debouncedQ] = useDebouncedValue(q.trim(), 300);
  const [openId, setOpenId] = useState<string | null>(null);

  const wholesalers = useQuery({
    queryKey: ['wholesalers', 'approved'],
    queryFn: () => api.get<Page<PublicUser>>('/v1/admin/users', { role: 'wholesaler', limit: 100 }),
  });
  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: () => api.get<{ items: Category[] }>('/v1/admin/categories'),
  });

  const list = useInfiniteQuery({
    queryKey: ['products', status, wholesalerId, categoryId, outOfStock, debouncedQ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Page<ProductSummary>>('/v1/admin/products', {
        status: status === 'all' ? undefined : status,
        wholesalerId: wholesalerId || undefined,
        categoryId: categoryId || undefined,
        stock: outOfStock ? 'out' : undefined,
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
  const cats = categories.data?.items ?? [];
  const catLabel = (c: Category) => {
    const parent = cats.find((p) => p.id === c.parentId);
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Products</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setOpenId('new')}>
          New product
        </Button>
      </Group>
      <Group align="flex-end">
        <SegmentedControl
          value={status}
          onChange={(v) => set('status', v)}
          data={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Live' },
            { value: 'draft', label: 'Draft' },
            { value: 'hidden', label: 'Hidden' },
          ]}
        />
        <Select
          placeholder="All categories"
          clearable
          searchable
          value={categoryId || null}
          onChange={(v) => set('categoryId', v ?? '')}
          data={cats.map((c) => ({ value: c.id, label: catLabel(c) }))}
          w={240}
          aria-label="Category"
        />
        <Select
          placeholder="Any supplier"
          clearable
          searchable
          value={wholesalerId || null}
          onChange={(v) => set('wholesalerId', v ?? '')}
          data={(wholesalers.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))}
          w={220}
          aria-label="Supplied by"
        />
        <TextInput placeholder="Search name, part no. or brand" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={260} aria-label="Search" />
        <Checkbox label="Out of stock" checked={outOfStock} onChange={(e) => set('stock', e.currentTarget.checked ? 'out' : '')} mb={8} />
      </Group>

      {list.error && <Alert color="red">{errorMessage(list.error)}</Alert>}
      {list.isLoading ? (
        <Loader />
      ) : products.length === 0 ? (
        <EmptyState icon={IconPackage} title="No products match">
          Create products with “New product”; wholesalers then add their stock in the Partpoint app.
        </EmptyState>
      ) : (
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Product</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th ta="right">Price from</Table.Th>
              <Table.Th ta="right">In stock</Table.Th>
              <Table.Th ta="right">Suppliers</Table.Th>
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
                  <Text size="sm">{p.categoryName}</Text>
                </Table.Td>
                <Table.Td ta="right">{p.minPricePaise !== null ? rupees(p.minPricePaise) : '—'}</Table.Td>
                <Table.Td ta="right" c={p.totalStock === 0 ? 'red' : undefined}>
                  {p.totalStock === 0 ? 'Out of stock' : count(p.totalStock)}
                </Table.Td>
                <Table.Td ta="right">{count(p.supplierCount ?? 0)}</Table.Td>
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

      <ProductEditor productId={openId} onOpen={setOpenId} onClose={() => setOpenId(null)} />
    </Stack>
  );
}
