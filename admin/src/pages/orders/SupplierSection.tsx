import { Alert, Badge, Button, Group, Loader, SegmentedControl, Select, Stack, Table, Text } from '@mantine/core';
import { IconSparkles } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { OrderDetail, SupplierOptions } from '../../api/types';
import { rupees } from '../../lib/format';
import { useAction } from '../../lib/mutations';

/**
 * Every order comes to the admin first. Here the admin chooses who fulfils it: one wholesaler
 * for the whole order, or a wholesaler per item (the order is then split into parts).
 */
export function SupplierSection({ o, invalidate }: { o: OrderDetail; invalidate: string[][] }) {
  const options = useQuery({
    queryKey: ['order-suppliers', o.id],
    queryFn: () => api.get<SupplierOptions>(`/v1/admin/orders/${o.id}/suppliers`),
  });
  const [mode, setMode] = useState<'whole' | 'split'>('whole');
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const all = [...invalidate, ['order-suppliers', o.id]];

  const forward = useAction({
    run: (body: { wholesalerId?: string; assignments?: { itemId: string; wholesalerId: string }[] }) =>
      api.post<OrderDetail>(`/v1/admin/orders/${o.id}/forward`, body),
    success: (r: OrderDetail) =>
      r.siblings.length ? `Split into ${r.siblings.length + 1} orders and forwarded` : `Forwarded to ${r.wholesaler?.businessName ?? 'the wholesaler'}`,
    invalidate: all,
  });

  const data = options.data;
  const names = useMemo(() => new Map((data?.wholesalers ?? []).map((w) => [w.id, w])), [data]);
  if (options.isLoading) return <Loader size="sm" />;
  if (options.error || !data) return <Alert color="red">{errorMessage(options.error)}</Alert>;

  const goods = o.subtotalPaise - o.discountPaise;
  const full = data.wholesalers.filter((w) => w.coversAll);
  const suggested = data.wholesalers.find((w) => w.id === data.suggestedWholesalerId);
  const splitReady = data.items.every((i) => picks[i.id]);
  const splitSupply = data.items.reduce((sum, i) => {
    const offer = i.offers.find((x) => x.wholesalerId === picks[i.id]);
    return sum + (offer ? offer.supplyPricePaise * i.qty : 0);
  }, 0);

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>Choose who fulfils this order</Text>
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={(v) => setMode(v as 'whole' | 'split')}
          data={[
            { value: 'whole', label: 'One wholesaler' },
            { value: 'split', label: 'Split by item' },
          ]}
        />
      </Group>
      <Text size="sm" c="dimmed">
        Deliver to {data.deliveryArea.city}, {data.deliveryArea.pincode}. The retailer only ever sees Partpoint.
      </Text>

      {mode === 'whole' ? (
        <>
          {suggested ? (
            <Alert color="teal" icon={<IconSparkles size={18} />} title={`Suggested: ${suggested.businessName}`}>
              Has every item{suggested.sameCity ? ', in the delivery city' : ''}. Supply cost {rupees(suggested.supplyTotalPaise)}, margin{' '}
              {rupees(goods - suggested.supplyTotalPaise)}.
              <Group mt="xs">
                <Button size="xs" color="teal" loading={forward.isPending} onClick={() => forward.mutate({ wholesalerId: suggested.id })}>
                  Forward to {suggested.businessName}
                </Button>
              </Group>
            </Alert>
          ) : (
            <Alert color="orange" title="No single wholesaler has everything">
              Split the order by item, or ask a wholesaler to update their stock.
            </Alert>
          )}
          {data.wholesalers.length === 0 ? (
            <Text size="sm" c="dimmed">
              No wholesaler stocks these items yet.
            </Text>
          ) : (
            <Table fz="sm" verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Wholesaler</Table.Th>
                  <Table.Th>Has</Table.Th>
                  <Table.Th ta="right">Supply cost</Table.Th>
                  <Table.Th ta="right">Margin</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.wholesalers.map((w) => (
                  <Table.Tr key={w.id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {w.businessName}
                      </Text>
                      <Group gap={4}>
                        <Text size="xs" c="dimmed">
                          {w.city}
                        </Text>
                        {w.sameCity && (
                          <Badge size="xs" variant="light" color="teal">
                            Same city
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={w.coversAll ? 'green' : 'gray'}>
                        {w.itemIds.length} of {data.items.length} items
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right">{rupees(w.supplyTotalPaise)}</Table.Td>
                    <Table.Td ta="right" c={w.coversAll && goods - w.supplyTotalPaise < 0 ? 'red' : undefined}>
                      {w.coversAll ? rupees(goods - w.supplyTotalPaise) : '—'}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Button
                        size="xs"
                        variant={w.id === data.suggestedWholesalerId ? 'filled' : 'default'}
                        disabled={!w.coversAll}
                        loading={forward.isPending && forward.variables?.wholesalerId === w.id}
                        onClick={() => forward.mutate({ wholesalerId: w.id })}
                      >
                        Forward
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {full.length === 0 && data.wholesalers.length > 0 && (
            <Button variant="light" size="xs" onClick={() => setMode('split')} w="fit-content">
              Split by item instead
            </Button>
          )}
        </>
      ) : (
        <>
          <Table fz="sm" verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Item</Table.Th>
                <Table.Th>Supplied by</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((i) => {
                const usable = i.offers.filter((x) => x.stockQty >= i.qty);
                return (
                  <Table.Tr key={i.id}>
                    <Table.Td>
                      {i.productName}
                      <Text size="xs" c="dimmed">
                        {i.variantName} · {i.qty} × {rupees(i.unitPricePaise)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Select
                        size="xs"
                        placeholder={usable.length ? 'Choose a wholesaler' : 'Nobody has enough stock'}
                        disabled={usable.length === 0}
                        value={picks[i.id] ?? null}
                        onChange={(v) => setPicks({ ...picks, [i.id]: v })}
                        data={usable.map((x) => ({
                          value: x.wholesalerId,
                          label: `${names.get(x.wholesalerId)?.businessName ?? 'Wholesaler'} · ${rupees(x.supplyPricePaise)} · ${x.stockQty} in stock`,
                        }))}
                        w={300}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {splitReady
                ? `Supply cost ${rupees(splitSupply)} · margin ${rupees(goods - splitSupply)} · ${new Set(Object.values(picks)).size} parcel(s)`
                : 'Choose a wholesaler for every item'}
            </Text>
            <Button
              disabled={!splitReady}
              loading={forward.isPending}
              onClick={() =>
                forward.mutate({
                  assignments: data.items.map((i) => ({ itemId: i.id, wholesalerId: picks[i.id] as string })),
                })
              }
            >
              Forward
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );
}
