import {
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Box,
  Burger,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Text,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import {
  IconCash,
  IconCategory,
  IconChevronDown,
  IconGauge,
  IconLogout,
  IconMoon,
  IconPackage,
  IconPhoto,
  IconReceipt,
  IconReportAnalytics,
  IconSettings,
  IconSpeakerphone,
  IconStar,
  IconSun,
  IconTag,
  IconTicket,
  IconTruckDelivery,
  IconUsers,
  IconUserX,
  type Icon,
} from '@tabler/icons-react';
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router';
import { api } from '../api/client';
import type { Dashboard } from '../api/types';
import { useSession } from '../auth/context';
import { Wordmark } from './BrandMark';
import classes from './AppLayout.module.css';

interface NavItem {
  to: string;
  label: string;
  icon: Icon;
}

/** Sections of the panel, grouped by the kind of work. */
const NAV: { group: string; items: NavItem[] }[] = [
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
      { to: '/marketing/announcements', label: 'Announcements', icon: IconSpeakerphone },
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
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

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
    '/orders': (dash?.orders.byStatus.placed ?? 0) + (dash?.orders.byStatus.packed ?? 0),
    '/users': dash?.users.pendingApprovals ?? 0,
    '/marketing/reviews': dash?.openReviewReports ?? 0,
  };
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));
  const current = ALL_ITEMS.find((i) => isActive(i.to));
  const currentGroup = NAV.find((g) => g.items.some((i) => i === current))?.group;
  const initials = (user?.name ?? user?.email ?? 'A')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  return (
    <AppShell
      layout="alt"
      header={{ height: 64 }}
      navbar={{ width: 248, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
      classNames={{ navbar: classes.navbar, main: classes.main, header: classes.header }}
    >
      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Box hiddenFrom="sm">
              <Wordmark size={28} />
            </Box>
            <Text size="sm" c="dimmed" visibleFrom="sm">
              {currentGroup ?? 'Admin'}
              {current ? (
                <Text span c="var(--mantine-color-text)" fw={600}>
                  {'  /  '}
                  {current.label}
                </Text>
              ) : null}
            </Text>
          </Group>
          <Group gap="sm">
            <Tooltip label={colorScheme === 'dark' ? 'Light theme' : 'Dark theme'}>
              <ActionIcon variant="default" size="lg" radius="xl" onClick={toggleColorScheme} aria-label="Toggle theme">
                {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end" width={220} shadow="md">
              <Menu.Target>
                <UnstyledButton className={classes.user}>
                  <Group gap={10}>
                    <Avatar radius="xl" size={34} color="brand" variant="filled">
                      {initials}
                    </Avatar>
                    <Box visibleFrom="xs">
                      <Text size="sm" fw={600} lh={1.2}>
                        {user?.name ?? 'Admin'}
                      </Text>
                      <Text size="xs" c="dimmed" lh={1.2}>
                        {user?.email}
                      </Text>
                    </Box>
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Signed in as administrator</Menu.Label>
                <Menu.Item component={RouterLink} to="/settings" leftSection={<IconSettings size={16} />}>
                  Settings
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={() => void signOut()}>
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <AppShell.Section className={classes.brand}>
          <Wordmark onDark size={32} />
          <Text size="xs" c="gray.5" mt={6} pl={42}>
            Admin console
          </Text>
        </AppShell.Section>
        <AppShell.Section grow component={ScrollArea} mt="xs">
          {NAV.map(({ group, items }) => (
            <div key={group}>
              <Text className={classes.group}>{group}</Text>
              {items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  component={RouterLink}
                  to={to}
                  label={label}
                  className={classes.link}
                  leftSection={<Icon size={19} stroke={1.7} />}
                  rightSection={
                    waiting[to] ? (
                      <Badge size="sm" circle color="red" aria-label={`${waiting[to]} waiting`}>
                        {waiting[to]}
                      </Badge>
                    ) : undefined
                  }
                  active={isActive(to)}
                  onClick={close}
                />
              ))}
            </div>
          ))}
        </AppShell.Section>
        <AppShell.Section className={classes.footer}>
          <Text size="xs" c="gray.6">
            Sakshay Connect · Parts. Price. Fast Delivery.
          </Text>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box maw={1320} mx="auto">
          <Outlet />
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
