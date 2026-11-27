import { Alert, Anchor, Badge, Group, Loader, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, errorMessage } from '../api/client';
import type { Dashboard, OrderStatus } from '../api/types';
import { DailyColumns } from '../components/DailyColumns';
import { count, dateTime, humanize, rupees } from '../lib/format';
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL } from './orders/orderStatus';

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

const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;

function TopList({ title, rows }: { title: string; rows: { id: string; name: string; value: string }[] }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
        {title}
      </Text>
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          —
        </Text>
      ) : (
        <Table fz="sm" verticalSpacing={4}>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={r.id}>
                <Table.Td c="dimmed" w={24}>
                  {i + 1}
                </Table.Td>
                <Table.Td>
                  <Text size="sm" lineClamp={1} title={r.name}>
                    {r.name}
                  </Text>
                </Table.Td>
                <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                  {r.value}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </div>
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

      {(data.orders.byStatus.placed ?? 0) > 0 && (
        <Alert color="red" title="Orders waiting for a wholesaler">
          {count(data.orders.byStatus.placed ?? 0)} order(s) need you to choose who fulfils them.{' '}
          <Anchor component={Link} to="/orders?tab=placed">
            Forward now
          </Anchor>
        </Alert>
      )}
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
        <Stat label="Margin this month" value={rupees(data.sales.commissionThisMonthPaise, { decimals: false })} hint="On delivered orders" />
        <Stat
          label="Active businesses"
          value={count(data.users.retailers + data.users.wholesalers)}
          hint={[plural(data.users.retailers, 'retailer'), plural(data.users.wholesalers, 'wholesaler'), plural(data.users.deliveryPartners, 'rider')].join(' · ')}
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
              <Badge key={status} variant="light" color={ORDER_STATUS_COLOR[status as OrderStatus] ?? 'gray'} size="lg" radius="sm">
                {ORDER_STATUS_LABEL[status as OrderStatus] ?? humanize(status)}: {count(n)}
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
          {data.topWholesalers.length + data.topProducts.length === 0 ? (
            <Text size="sm" c="dimmed">
              No sales yet this month.
            </Text>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
              <TopList title="Wholesalers by sales" rows={data.topWholesalers.map((w) => ({ id: w.id, name: w.name, value: rupees(w.gmvPaise, { decimals: false }) }))} />
              <TopList title="Products by units sold" rows={data.topProducts.map((p) => ({ id: p.id, name: p.name, value: `${count(p.qty)} sold` }))} />
            </SimpleGrid>
          )}
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
