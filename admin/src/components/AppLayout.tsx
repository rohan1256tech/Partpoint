import { ActionIcon, AppShell, Burger, Group, NavLink, Text, Tooltip, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconGauge, IconLogout, IconMoon, IconSun, IconUsers } from '@tabler/icons-react';
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router';
import { useSession } from '../auth/context';

/** Sections of the panel. Later slices add catalog, orders, delivery, marketing, finance, reports. */
const NAV = [
  { to: '/', label: 'Dashboard', icon: IconGauge },
  { to: '/users', label: 'Users', icon: IconUsers },
] as const;

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { user, signOut } = useSession();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { pathname } = useLocation();

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
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            component={RouterLink}
            to={to}
            label={label}
            leftSection={<Icon size={18} stroke={1.6} />}
            active={to === '/' ? pathname === '/' : pathname.startsWith(to)}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
