import { Alert, Button, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { PlatformSettings } from '../../api/types';
import { RupeeInput } from '../../components/MoneyInput';
import { rupees } from '../../lib/format';
import { useAction } from '../../lib/mutations';

/** Platform-wide money settings. Changes apply to new orders only; placed orders keep their amounts. */
export function SettingsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<PlatformSettings>('/v1/admin/settings') });
  if (error) return <Alert color="red">{errorMessage(error)}</Alert>;
  if (isLoading || !data) return <Loader />;
  // Keyed on the saved values, so the form starts again from them after a save.
  return <SettingsForm key={JSON.stringify(data)} saved={data} />;
}

function SettingsForm({ saved }: { saved: PlatformSettings }) {
  const [form, setForm] = useState<PlatformSettings>(saved);

  const save = useAction({
    run: (s: PlatformSettings) => api.patch<PlatformSettings>('/v1/admin/settings', s),
    success: 'Settings saved',
    invalidate: [['settings']],
  });

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  return (
    <Stack maw={560}>
      <Title order={2}>Settings</Title>
      <Text size="sm" c="dimmed">
        Changes apply to orders placed from now on. Existing orders keep their amounts. Sakshay Connect's margin is the difference between the retailer
        price and the wholesaler's supply price, set per product.
      </Text>
      <Paper withBorder p="md" radius="md">
        <Stack>
          <RupeeInput
            label="Delivery fee per order"
            description="Charged to the retailer once per order, even when you split it across wholesalers."
            max={1000}
            paise={form.deliveryFeePaise}
            onPaise={(p) => setForm({ ...form, deliveryFeePaise: p ?? 0 })}
          />
          <RupeeInput
            label="Rider earning per delivery"
            description={`What a delivery partner earns for each delivered order${form.deliveryFeePaise ? ` (fee charged: ${rupees(form.deliveryFeePaise)})` : ''}.`}
            max={1000}
            paise={form.deliveryEarningPaise}
            onPaise={(p) => setForm({ ...form, deliveryEarningPaise: p ?? 0 })}
          />
          <RupeeInput
            label="Minimum order value"
            description="Smallest cart a retailer can check out. 0 = no minimum."
            max={100000}
            paise={form.minOrderPaise}
            onPaise={(p) => setForm({ ...form, minOrderPaise: p ?? 0 })}
          />
          <Group justify="flex-end">
            <Button variant="default" disabled={!dirty} onClick={() => setForm(saved)}>
              Reset
            </Button>
            <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(form)}>
              Save
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}
