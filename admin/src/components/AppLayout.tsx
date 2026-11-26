import { ActionIcon, AppShell, Badge, Burger, Group, NavLink, ScrollArea, Text, Tooltip, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import {
  IconCash,
  IconCategory,
  IconGauge,
  IconLogout,
  IconMoon,
  IconPackage,
  IconPhoto,
  IconReceipt,
  IconReportAnalytics,
  IconSettings,
  IconStar,
  IconSun,
  IconTag,
  IconTicket,
  IconTruckDelivery,
  IconUsers,
  IconUserX,
} from '@tabler/icons-react';
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router';
import { api } from '../api/client';
import type { Dashboard } from '../api/types';
import { useSession } from '../auth/context';

/** Sections of the panel, grouped by the kind of work. */
const NAV = [
  {
    group: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', icon: IconGauge },
      { to: '/orders', label: 'Orders', icon: IconReceipt },
      { to: '/delivery-partners', label: 'Delivery partners', icon: IconTruckDelivery },
      { to: '/users', label: 'Users', icon: IconUsers },
    ],
  },
  {
    group: 'Catalog',
    items: [
      { to: '/catalog/products', label: 'Products', icon: IconPackage },
      { to: '/catalog/categories', label: 'Categories', icon: IconCategory },
      { to: '/catalog/brands', label: 'Brands', icon: IconTag },
    ],
  },
  {
    group: 'Marketing',
    items: [
      { to: '/marketing/coupons', label: 'Coupons', icon: IconTicket },
      { to: '/marketing/banners', label: 'Banners', icon: IconPhoto },
      { to: '/marketing/reviews', label: 'Reviews', icon: IconStar },
    ],
  },
  {
    group: 'Money',
    items: [
      { to: '/finance', label: 'Finance', icon: IconCash },
      { to: '/reports', label: 'Reports', icon: IconReportAnalytics },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/settings', label: 'Settings', icon: IconSettings },
      { to: '/account-deletions', label: 'Account deletions', icon: IconUserX },
    ],
  },
] as const;

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { user, signOut } = useSession();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { pathname } = useLocation();
  // Work waiting for the operator, shown as counts in the sidebar. Shares the dashboard's cache.
  const { data: dash } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/v1/admin/dashboard'),
    refetchInterval: 60_000,
  });
  const waiting: Record<string, number> = {
    '/users': dash?.users.pendingApprovals ?? 0,
    '/marketing/reviews': dash?.openReviewReports ?? 0,
  };

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Text fw={700}>Partpoint Admin</Text>
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed" visibleFrom="xs">
              {user?.email}
            </Text>
            <Tooltip label={colorScheme === 'dark' ? 'Light theme' : 'Dark theme'}>
              <ActionIcon variant="subtle" color="gray" onClick={toggleColorScheme} aria-label="Toggle theme">
                {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Sign out">
              <ActionIcon variant="subtle" color="gray" onClick={() => void signOut()} aria-label="Sign out">
                <IconLogout size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea}>
          {NAV.map(({ group, items }) => (
            <div key={group}>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" px="sm" pt="sm" pb={4}>
                {group}
              </Text>
              {items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  component={RouterLink}
                  to={to}
                  label={label}
                  leftSection={<Icon size={18} stroke={1.6} />}
                  rightSection={
                    waiting[to] ? (
                      <Badge size="sm" circle color="red" aria-label={`${waiting[to]} waiting`}>
                        {waiting[to]}
                      </Badge>
                    ) : undefined
                  }
                  active={to === '/' ? pathname === '/' : pathname.startsWith(to)}
                  onClick={close}
                />
              ))}
            </div>
          ))}
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
