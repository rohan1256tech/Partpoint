import { Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';
import type { ReactNode } from 'react';

/** A friendly, explained empty list: what would be here, and what to do next. */
export function EmptyState({ icon: Icon, title, children, action }: { icon: Icon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="xl" style={{ borderStyle: 'dashed' }}>
      <Stack align="center" gap="xs" ta="center" maw={420} mx="auto">
        <ThemeIcon size={48} radius="xl" variant="light" color="gray">
          <Icon size={26} stroke={1.5} />
        </ThemeIcon>
        <Text fw={600}>{title}</Text>
        {children && (
          <Text size="sm" c="dimmed">
            {children}
          </Text>
        )}
        {action}
      </Stack>
    </Paper>
  );
}
