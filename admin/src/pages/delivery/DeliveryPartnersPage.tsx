import { Alert, Badge, Loader, SegmentedControl, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { DeliveryPartner } from '../../api/types';
import { count } from '../../lib/format';

/** Approved riders, their availability (set by the rider in the app) and current workload. */
export function DeliveryPartnersPage() {
  const [filter, setFilter] = useState<'available' | 'all'>('available');
  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-partners', filter],
    queryFn: () =>
      api.get<{ items: DeliveryPartner[] }>('/v1/admin/delivery-partners', filter === 'available' ? { available: 'true' } : {}),
    refetchInterval: 30_000,
  });
  const partners = data?.items ?? [];

  return (
    <Stack>
      <Title order={2}>Delivery partners</Title>
      <SegmentedControl
        w="fit-content"
        value={filter}
        onChange={(v) => setFilter(v as 'available' | 'all')}
        data={[
          { value: 'available', label: 'Available now' },
          { value: 'all', label: 'All approved' },
        ]}
      />
      <Text size="sm" c="dimmed">
        Riders switch availability in the Partpoint Delivery app. New riders appear here once approved under Users.
      </Text>
      {error && <Alert color="red">{errorMessage(error)}</Alert>}
      {isLoading ? (
        <Loader />
      ) : partners.length === 0 ? (
        <Text c="dimmed">{filter === 'available' ? 'No riders are available right now.' : 'No approved riders yet.'}</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Rider</Table.Th>
              <Table.Th>Phone</Table.Th>
              <Table.Th>Vehicle</Table.Th>
              <Table.Th>Availability</Table.Th>
              <Table.Th ta="right">Active deliveries</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {partners.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td fw={600}>{p.name}</Table.Td>
                <Table.Td>{p.phone ?? '—'}</Table.Td>
                <Table.Td>{[p.vehicleType, p.vehicleNumber].filter(Boolean).join(' · ') || '—'}</Table.Td>
                <Table.Td>
                  {p.isAvailable ? (
                    <Badge color="green" variant="light">
                      Available
                    </Badge>
                  ) : (
                    <Badge color="gray" variant="light">
                      Off duty
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td ta="right">{count(p.activeDeliveries)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
