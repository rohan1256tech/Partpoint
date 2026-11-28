import { Alert, Badge, Button, Group, Loader, Modal, NumberInput, SegmentedControl, Stack, Switch, Table, TextInput, Title } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { Coupon } from '../../api/types';
import { PercentInput, RupeeInput } from '../../components/MoneyInput';
import { count, date, rupees } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { rowLink } from '../../lib/rowLink';
import { IconTicket } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';

type Draft = Omit<Coupon, 'id' | 'timesUsed' | 'startsAt' | 'endsAt'> & { id?: string; startsAt: Date | null; endsAt: Date | null };

const EMPTY: Draft = {
  code: '',
  description: '',
  discountType: 'percent',
  discountValue: 1000,
  maxDiscountPaise: null,
  minOrderPaise: 0,
  usageLimit: null,
  perUserLimit: 1,
  startsAt: null,
  endsAt: null,
  isActive: true,
};

function describeDiscount(c: Pick<Coupon, 'discountType' | 'discountValue' | 'maxDiscountPaise'>): string {
  if (c.discountType === 'flat') return `${rupees(c.discountValue, { decimals: false })} off`;
  const pct = `${c.discountValue / 100}% off`;
  return c.maxDiscountPaise ? `${pct} (up to ${rupees(c.maxDiscountPaise, { decimals: false })})` : pct;
}

function couponState(c: Coupon, now = new Date()): { label: string; color: string } {
  if (!c.isActive) return { label: 'Off', color: 'gray' };
  if (c.endsAt && new Date(c.endsAt) <= now) return { label: 'Expired', color: 'gray' };
  if (c.startsAt && new Date(c.startsAt) > now) return { label: 'Scheduled', color: 'blue' };
  if (c.usageLimit !== null && c.timesUsed >= c.usageLimit) return { label: 'Used up', color: 'gray' };
  return { label: 'Live', color: 'green' };
}

export function CouponsPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['coupons'], queryFn: () => api.get<{ items: Coupon[] }>('/v1/admin/coupons') });

  const save = useAction({
    run: (d: Draft) => {
      const body = {
        description: d.description?.trim() || null,
        discountType: d.discountType,
        discountValue: d.discountValue,
        maxDiscountPaise: d.discountType === 'percent' ? d.maxDiscountPaise : null,
        minOrderPaise: d.minOrderPaise,
        usageLimit: d.usageLimit,
        perUserLimit: d.perUserLimit,
        startsAt: d.startsAt?.toISOString() ?? null,
        endsAt: d.endsAt?.toISOString() ?? null,
        isActive: d.isActive,
      };
      return d.id
        ? api.patch<Coupon>(`/v1/admin/coupons/${d.id}`, body)
        : api.post<Coupon>('/v1/admin/coupons', { ...body, code: d.code.trim().toUpperCase() });
    },
    success: (c: Coupon) => `Saved ${c.code}`,
    invalidate: [['coupons']],
    onDone: () => setDraft(null),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Coupons</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setDraft({ ...EMPTY })}>
          New coupon
        </Button>
      </Group>
      {error && <Alert color="red">{errorMessage(error)}</Alert>}
      {isLoading ? (
        <Loader />
      ) : (data?.items ?? []).length === 0 ? (
        <EmptyState icon={IconTicket} title="No coupons yet">Create a code retailers can apply at checkout, e.g. 10% off a first order.</EmptyState>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Code</Table.Th>
              <Table.Th>Discount</Table.Th>
              <Table.Th>Min. order</Table.Th>
              <Table.Th>Valid</Table.Th>
              <Table.Th ta="right">Used</Table.Th>
              <Table.Th>State</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data?.items ?? []).map((c) => {
              const s = couponState(c);
              return (
                <Table.Tr
                  key={c.id}
                  {...rowLink(() => setDraft({ ...c, startsAt: c.startsAt ? new Date(c.startsAt) : null, endsAt: c.endsAt ? new Date(c.endsAt) : null }))}
                >
                  <Table.Td ff="monospace" fw={600}>
                    {c.code}
                  </Table.Td>
                  <Table.Td>{describeDiscount(c)}</Table.Td>
                  <Table.Td>{c.minOrderPaise ? rupees(c.minOrderPaise, { decimals: false }) : '—'}</Table.Td>
                  <Table.Td>
                    {c.startsAt ? date(c.startsAt) : 'Now'} – {c.endsAt ? date(c.endsAt) : 'no end'}
                  </Table.Td>
                  <Table.Td ta="right">
                    {count(c.timesUsed)}
                    {c.usageLimit !== null ? ` / ${count(c.usageLimit)}` : ''}
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={s.color}>
                      {s.label}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={!!draft} onClose={() => setDraft(null)} title={draft?.id ? `Edit ${draft.code}` : 'New coupon'} size="lg">
        {draft && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(draft);
            }}
          >
            <Stack>
              <TextInput
                label="Code"
                description={draft.id ? 'Codes cannot change once created.' : '3–20 letters and digits, e.g. DIWALI25'}
                required
                disabled={!!draft.id}
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                maxLength={20}
              />
              <TextInput label="Description" value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })} maxLength={200} />
              <SegmentedControl
                value={draft.discountType}
                onChange={(v) => setDraft({ ...draft, discountType: v as 'percent' | 'flat', discountValue: v === 'percent' ? 1000 : 10000 })}
                data={[
                  { value: 'percent', label: 'Percentage' },
                  { value: 'flat', label: 'Fixed amount' },
                ]}
              />
              <Group grow>
                {draft.discountType === 'percent' ? (
                  <>
                    <PercentInput label="Discount" required bps={draft.discountValue} onBps={(b) => setDraft({ ...draft, discountValue: b ?? 0 })} />
                    <RupeeInput label="Maximum discount" description="Optional cap" paise={draft.maxDiscountPaise} onPaise={(p) => setDraft({ ...draft, maxDiscountPaise: p })} />
                  </>
                ) : (
                  <RupeeInput label="Discount" required paise={draft.discountValue} onPaise={(p) => setDraft({ ...draft, discountValue: p ?? 0 })} />
                )}
              </Group>
              <Group grow>
                <RupeeInput label="Minimum order" paise={draft.minOrderPaise} onPaise={(p) => setDraft({ ...draft, minOrderPaise: p ?? 0 })} />
                <NumberInput
                  label="Total uses"
                  description="Empty = unlimited"
                  min={1}
                  value={draft.usageLimit ?? ''}
                  onChange={(v) => setDraft({ ...draft, usageLimit: v === '' ? null : Number(v) })}
                />
                <NumberInput label="Uses per retailer" min={1} max={100} value={draft.perUserLimit} onChange={(v) => setDraft({ ...draft, perUserLimit: Number(v) || 1 })} />
              </Group>
              <Group grow>
                <DateTimePicker label="Starts" clearable value={draft.startsAt} onChange={(v) => setDraft({ ...draft, startsAt: v ? new Date(v) : null })} placeholder="Immediately" />
                <DateTimePicker label="Ends" clearable value={draft.endsAt} onChange={(v) => setDraft({ ...draft, endsAt: v ? new Date(v) : null })} placeholder="No end date" />
              </Group>
              <Switch label="Active" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.currentTarget.checked })} />
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button type="submit" loading={save.isPending} disabled={draft.code.length < 3 || draft.discountValue <= 0}>
                  Save
                </Button>
              </Group>
            </Stack>
          </form>
        )}
      </Modal>
    </Stack>
  );
}
