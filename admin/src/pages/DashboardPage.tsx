import { Alert, Badge, Button, Group, Loader, Paper, Progress, SimpleGrid, Stack, Table, Text, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBuildingStore,
  IconCash,
  IconChartLine,
  IconFlag,
  IconPackage,
  IconPlus,
  IconReceipt,
  IconTruckDelivery,
  IconUserCheck,
  type Icon,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, errorMessage } from '../api/client';
import type { Dashboard, OrderStatus } from '../api/types';
import { useSession } from '../auth/context';
import { DailyColumns } from '../components/DailyColumns';
import { count, dateTime, humanize, rupees } from '../lib/format';
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL } from './orders/orderStatus';

const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** A big number with an icon: the month at a glance. */
function Kpi({ label, value, hint, icon: I, color }: { label: string; value: string; hint?: string; icon: Icon; color: string }) {
  return (
    <Paper p="lg" shadow="xs" withBorder>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '0.06em' }}>
            {label}
          </Text>
          <Text fz={30} fw={800} lh={1.15} mt={6} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Text>
          {hint && (
            <Text size="xs" c="dimmed" mt={4}>
              {hint}
            </Text>
          )}
        </div>
        <ThemeIcon size={44} radius="md" variant="light" color={color}>
          <I size={24} stroke={1.8} />
        </ThemeIcon>
      </Group>
    </Paper>
  );
}

/** Work waiting for the operator; the card opens the right list. */
function Attention({ to, n, label, hint, icon: I, color }: { to: string; n: number; label: string; hint: string; icon: Icon; color: string }) {
  const quiet = n === 0;
  return (
    <UnstyledButton component={Link} to={to} style={{ display: 'block' }}>
      <Paper p="md" withBorder shadow={quiet ? undefined : 'sm'} style={{ borderLeft: `4px solid var(--mantine-color-${quiet ? 'gray-4' : `${color}-6`})` }}>
        <Group wrap="nowrap" gap="md">
          <ThemeIcon size={40} radius="xl" variant={quiet ? 'light' : 'filled'} color={quiet ? 'gray' : color}>
            <I size={20} />
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Group gap={8} align="baseline">
              <Text fz={24} fw={800} lh={1}>
                {count(n)}
              </Text>
              <Text fw={600} size="sm">
                {label}
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mt={4} lineClamp={1}>
              {quiet ? 'All clear' : hint}
            </Text>
          </div>
        </Group>
      </Paper>
    </UnstyledButton>
  );
}

function TopList({ title, rows }: { title: string; rows: { id: string; name: string; value: string }[] }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={6} style={{ letterSpacing: '0.06em' }}>
        {title}
      </Text>
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing yet this month.
        </Text>
      ) : (
        <Table fz="sm" verticalSpacing={6}>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={r.id}>
                <Table.Td w={32}>
                  <Badge variant={i === 0 ? 'filled' : 'light'} color={i === 0 ? 'brand' : 'gray'} circle>
                    {i + 1}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={500} lineClamp={1} title={r.name}>
                    {r.name}
                  </Text>
                </Table.Td>
                <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }} fw={600}>
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
  const { user } = useSession();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/v1/admin/dashboard'),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Loader />;
  if (error || !data) return <Alert color="red">{errorMessage(error)}</Alert>;

  const by = data.orders.byStatus;
  const statuses = Object.entries(by) as [OrderStatus, number][];
  const totalOrders = statuses.reduce((s, [, n]) => s + n, 0);
  const firstName = (user?.name ?? '').split(' ')[0];

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </Title>
          <Text c="dimmed" size="sm" mt={4}>
            Here is your marketplace today. Updated {dateTime(data.generatedAt)}.
          </Text>
        </div>
        <Group gap="sm">
          <Button variant="default" leftSection={<IconReceipt size={16} />} component={Link} to="/orders">
            Orders
          </Button>
          <Button leftSection={<IconPlus size={16} />} component={Link} to="/catalog/products">
            Add product
          </Button>
        </Group>
      </Group>

      <div>
        <Text fw={700} mb="sm">
          Needs your attention
        </Text>
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>
          <Attention to="/orders?tab=placed" n={by.placed ?? 0} label="to forward" hint="New orders waiting for a wholesaler" icon={IconAlertTriangle} color="red" />
          <Attention to="/orders?tab=packed" n={by.packed ?? 0} label="need a rider" hint="Packed; offered to riders, nobody took them yet" icon={IconTruckDelivery} color="orange" />
          <Attention to="/users?status=pending" n={data.users.pendingApprovals} label="to approve" hint="New retailers, wholesalers and riders" icon={IconUserCheck} color="blue" />
          <Attention to="/marketing/reviews" n={data.openReviewReports} label="reported reviews" hint="Reviews flagged by users" icon={IconFlag} color="violet" />
        </SimpleGrid>
      </div>

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>
        <Kpi label="Sales this month" value={rupees(data.sales.gmvThisMonthPaise, { decimals: false })} hint={`Today ${rupees(data.sales.gmvTodayPaise, { decimals: false })}`} icon={IconChartLine} color="teal" />
        <Kpi label="Orders this month" value={count(data.orders.thisMonth)} hint={`Today ${count(data.orders.today)}`} icon={IconPackage} color="blue" />
        <Kpi label="Margin this month" value={rupees(data.sales.commissionThisMonthPaise, { decimals: false })} hint="On delivered orders" icon={IconCash} color="green" />
        <Kpi
          label="Active businesses"
          value={count(data.users.retailers + data.users.wholesalers)}
          hint={[plural(data.users.retailers, 'retailer'), plural(data.users.wholesalers, 'wholesaler'), plural(data.users.deliveryPartners, 'rider')].join(' · ')}
          icon={IconBuildingStore}
          color="grape"
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 3 }}>
        <Paper p="lg" withBorder shadow="xs" style={{ gridColumn: 'span 2' }}>
          <Group justify="space-between" mb="sm">
            <Text fw={700}>Orders per day</Text>
            <Text size="xs" c="dimmed">
              Last 30 days
            </Text>
          </Group>
          <DailyColumns data={data.last30Days} />
        </Paper>

        <Paper p="lg" withBorder shadow="xs">
          <Text fw={700} mb="md">
            Orders by status
          </Text>
          {statuses.length === 0 ? (
            <Text c="dimmed" size="sm">
              No orders yet
            </Text>
          ) : (
            <Stack gap="sm">
              {statuses.map(([status, n]) => (
                <div key={status}>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm">{ORDER_STATUS_LABEL[status] ?? humanize(status)}</Text>
                    <Text size="sm" fw={700}>
                      {count(n)}
                    </Text>
                  </Group>
                  <Progress value={(n / Math.max(1, totalOrders)) * 100} color={ORDER_STATUS_COLOR[status] ?? 'gray'} size="sm" radius="xl" />
                </div>
              ))}
              <Text size="xs" c="dimmed" mt="xs">
                Unpaid rider earnings: <b>{rupees(data.unpaidDeliveryEarningsPaise, { decimals: false })}</b>
              </Text>
            </Stack>
          )}
        </Paper>
      </SimpleGrid>

      <Paper p="lg" withBorder shadow="xs">
        <Text fw={700} mb="md">
          Top this month
        </Text>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <TopList title="Wholesalers by sales" rows={data.topWholesalers.map((w) => ({ id: w.id, name: w.name, value: rupees(w.gmvPaise, { decimals: false }) }))} />
          <TopList title="Products by units sold" rows={data.topProducts.map((p) => ({ id: p.id, name: p.name, value: `${count(p.qty)} sold` }))} />
        </SimpleGrid>
      </Paper>
    </Stack>
  );
}
