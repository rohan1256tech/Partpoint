import { Alert, Anchor, Badge, Group, Loader, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, errorMessage } from '../api/client';
import type { Dashboard } from '../api/types';
import { DailyColumns } from '../components/DailyColumns';
import { count, dateTime, humanize, rupees } from '../lib/format';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fz={28} fw={700} lh={1.2} mt={4} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed" mt={2}>
          {hint}
        </Text>
      )}
    </Paper>
  );
}

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/v1/admin/dashboard'),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Loader />;
  if (error || !data) return <Alert color="red">{errorMessage(error)}</Alert>;

  return (
    <Stack>
      <Group justify="space-between" align="baseline">
        <Title order={2}>Dashboard</Title>
        <Text size="xs" c="dimmed">
          Updated {dateTime(data.generatedAt)}
        </Text>
      </Group>

      {data.users.pendingApprovals > 0 && (
        <Alert color="yellow" title="Waiting for approval">
          {count(data.users.pendingApprovals)} account(s) need review.{' '}
          <Anchor component={Link} to="/users?status=pending">
            Review now
          </Anchor>
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
        <Stat label="GMV this month" value={rupees(data.sales.gmvThisMonthPaise, { decimals: false })} hint={`Today ${rupees(data.sales.gmvTodayPaise, { decimals: false })}`} />
        <Stat label="Orders this month" value={count(data.orders.thisMonth)} hint={`Today ${count(data.orders.today)}`} />
        <Stat label="Commission this month" value={rupees(data.sales.commissionThisMonthPaise, { decimals: false })} hint="On delivered orders" />
        <Stat
          label="Active businesses"
          value={count(data.users.retailers + data.users.wholesalers)}
          hint={`${count(data.users.retailers)} retailers · ${count(data.users.wholesalers)} wholesalers · ${count(data.users.deliveryPartners)} riders`}
        />
      </SimpleGrid>

      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="xs">
          Orders per day, last 30 days
        </Text>
        <DailyColumns data={data.last30Days} />
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="xs">
            Orders by status
          </Text>
          <Group gap="xs">
            {Object.entries(data.orders.byStatus).length === 0 && <Text c="dimmed" size="sm">No orders yet</Text>}
            {Object.entries(data.orders.byStatus).map(([status, n]) => (
              <Badge key={status} variant="light" color="gray" size="lg" radius="sm">
                {humanize(status)}: {count(n)}
              </Badge>
            ))}
          </Group>
          <Group mt="md" gap="lg">
            <Text size="sm">
              Open review reports: <b>{count(data.openReviewReports)}</b>
            </Text>
            <Text size="sm">
              Unpaid rider earnings: <b>{rupees(data.unpaidDeliveryEarningsPaise, { decimals: false })}</b>
            </Text>
          </Group>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="xs">
            Top this month
          </Text>
          <Table fz="sm" verticalSpacing={4}>
            <Table.Tbody>
              {data.topWholesalers.map((w) => (
                <Table.Tr key={w.id}>
                  <Table.Td>{w.name}</Table.Td>
                  <Table.Td ta="right">{rupees(w.gmvPaise, { decimals: false })}</Table.Td>
                </Table.Tr>
              ))}
              {data.topProducts.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td c="dimmed">{p.name}</Table.Td>
                  <Table.Td ta="right" c="dimmed">
                    {count(p.qty)} sold
                  </Table.Td>
                </Table.Tr>
              ))}
              {data.topWholesalers.length + data.topProducts.length === 0 && (
                <Table.Tr>
                  <Table.Td c="dimmed">No sales yet this month</Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
