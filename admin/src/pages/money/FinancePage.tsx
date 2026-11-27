import { Alert, Button, Group, Loader, Modal, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { Payout, RiderBalance, WholesalerBalance } from '../../api/types';
import { RupeeInput } from '../../components/MoneyInput';
import { count, dateTime, rupees } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { rowLink } from '../../lib/rowLink';
import { IconCash } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';

/**
 * Payouts are settled manually by bank transfer in v1; this page records them.
 * A wholesaler is owed the supply price of the goods in their delivered orders: the goods value
 * minus Partpoint's margin.
 */
export function FinancePage() {
  return (
    <Stack>
      <Title order={2}>Finance</Title>
      <Tabs defaultValue="wholesalers">
        <Tabs.List>
          <Tabs.Tab value="wholesalers">Wholesaler payouts</Tabs.Tab>
          <Tabs.Tab value="riders">Rider earnings</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="wholesalers" pt="md">
          <Wholesalers />
        </Tabs.Panel>
        <Tabs.Panel value="riders" pt="md">
          <Riders />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function Wholesalers() {
  const [selected, setSelected] = useState<WholesalerBalance | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['finance', 'wholesalers'],
    queryFn: () => api.get<{ items: WholesalerBalance[] }>('/v1/admin/finance/wholesalers'),
  });
  const rows = data?.items ?? [];
  const totalDue = rows.reduce((s, r) => s + Math.max(0, r.balancePaise), 0);

  if (isLoading) return <Loader />;
  if (error) return <Alert color="red">{errorMessage(error)}</Alert>;
  return (
    <Stack>
      <Text size="sm">
        Outstanding across all wholesalers: <b>{rupees(totalDue)}</b>
      </Text>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Wholesaler</Table.Th>
            <Table.Th ta="right">Delivered orders</Table.Th>
            <Table.Th ta="right">Goods value</Table.Th>
            <Table.Th ta="right">Partpoint margin</Table.Th>
            <Table.Th ta="right">Paid</Table.Th>
            <Table.Th ta="right">Balance due</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.wholesalerId} {...rowLink(() => setSelected(r))}>
              <Table.Td fw={600}>{r.businessName}</Table.Td>
              <Table.Td ta="right">{count(r.deliveredOrders)}</Table.Td>
              <Table.Td ta="right">{rupees(r.goodsPaise)}</Table.Td>
              <Table.Td ta="right">{rupees(r.commissionPaise)}</Table.Td>
              <Table.Td ta="right">{rupees(r.paidPaise)}</Table.Td>
              <Table.Td ta="right" fw={r.balancePaise > 0 ? 700 : undefined}>
                {rupees(r.balancePaise)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {selected && <PayoutModal balance={selected} onClose={() => setSelected(null)} />}
    </Stack>
  );
}

function PayoutModal({ balance, onClose }: { balance: WholesalerBalance; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(balance.balancePaise > 0 ? balance.balancePaise : null);
  const [reference, setReference] = useState('');
  const [now] = useState(() => new Date());
  const [paidAt, setPaidAt] = useState<Date | null>(now);
  const history = useQuery({
    queryKey: ['finance', 'payouts', balance.wholesalerId],
    queryFn: () => api.get<{ items: Payout[] }>(`/v1/admin/finance/wholesalers/${balance.wholesalerId}/payouts`),
  });
  const record = useAction({
    run: () =>
      api.post(`/v1/admin/finance/wholesalers/${balance.wholesalerId}/payouts`, {
        amountPaise: amount,
        reference: reference.trim(),
        ...(paidAt ? { paidAt: paidAt.toISOString() } : {}),
      }),
    success: `Payout to ${balance.businessName} recorded`,
    invalidate: [['finance']],
    onDone: onClose,
  });
  const valid = !!amount && amount > 0 && amount <= balance.balancePaise && reference.trim().length >= 4;

  return (
    <Modal opened onClose={onClose} title={`Pay ${balance.businessName}`} size="lg">
      <Stack>
        <Text size="sm">
          Balance due: <b>{rupees(balance.balancePaise)}</b>
        </Text>
        {balance.balancePaise > 0 ? (
          <>
            <Text size="sm" c="dimmed">
              Make the bank transfer first, then record it here with the transaction reference (UTR).
            </Text>
            <Group grow>
              <RupeeInput label="Amount paid" required paise={amount} onPaise={setAmount} error={amount && amount > balance.balancePaise ? 'More than the balance' : undefined} />
              <TextInput label="Bank reference (UTR)" required value={reference} onChange={(e) => setReference(e.currentTarget.value)} maxLength={60} />
            </Group>
            <DateTimePicker label="Paid on" value={paidAt} onChange={(v) => setPaidAt(v ? new Date(v) : null)} maxDate={now} />
            <Group justify="flex-end">
              <Button onClick={() => record.mutate(undefined)} disabled={!valid} loading={record.isPending}>
                Record payout
              </Button>
            </Group>
          </>
        ) : (
          <Text size="sm" c="dimmed">
            Nothing is due right now.
          </Text>
        )}
        <Text fw={600} mt="sm">
          Previous payouts
        </Text>
        {history.isLoading ? (
          <Loader size="sm" />
        ) : (history.data?.items ?? []).length === 0 ? (
          <Text size="sm" c="dimmed">
            None yet.
          </Text>
        ) : (
          <Table fz="sm">
            <Table.Tbody>
              {(history.data?.items ?? []).map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>{dateTime(p.paidAt)}</Table.Td>
                  <Table.Td ff="monospace">{p.reference}</Table.Td>
                  <Table.Td ta="right">{rupees(p.amountPaise)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Modal>
  );
}

function Riders() {
  const [settling, setSettling] = useState<RiderBalance | null>(null);
  const [reference, setReference] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['finance', 'riders'],
    queryFn: () => api.get<{ items: RiderBalance[] }>('/v1/admin/finance/delivery'),
  });
  const settle = useAction({
    run: (r: RiderBalance) => api.post<{ amountPaise: number; deliveries: number }>(`/v1/admin/finance/delivery/${r.partnerId}/settle`, { reference: reference.trim() }),
    success: (res, r) => `Settled ${rupees(res.amountPaise)} for ${count(res.deliveries)} deliveries to ${r.name}`,
    invalidate: [['finance'], ['dashboard']],
    onDone: () => {
      setSettling(null);
      setReference('');
    },
  });

  if (isLoading) return <Loader />;
  if (error) return <Alert color="red">{errorMessage(error)}</Alert>;
  const rows = data?.items ?? [];
  return (
    <Stack>
      {rows.length === 0 ? (
        <EmptyState icon={IconCash} title="All rider earnings are paid">Earnings appear here after each delivered order.</EmptyState>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Rider</Table.Th>
              <Table.Th ta="right">Unpaid deliveries</Table.Th>
              <Table.Th ta="right">Unpaid earnings</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.partnerId}>
                <Table.Td fw={600}>{r.name}</Table.Td>
                <Table.Td ta="right">{count(r.unpaidDeliveries)}</Table.Td>
                <Table.Td ta="right">{rupees(r.unpaidPaise)}</Table.Td>
                <Table.Td ta="right">
                  <Button size="xs" variant="light" onClick={() => setSettling(r)}>
                    Settle
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Modal opened={!!settling} onClose={() => setSettling(null)} title={settling ? `Settle ${settling.name}` : ''}>
        {settling && (
          <Stack>
            <Text size="sm">
              Marks all {count(settling.unpaidDeliveries)} unpaid deliveries ({rupees(settling.unpaidPaise)}) as paid. Pay the rider first.
            </Text>
            <TextInput label="Transfer reference (UPI / UTR)" required value={reference} onChange={(e) => setReference(e.currentTarget.value)} maxLength={60} />
            <Group justify="flex-end">
              <Button onClick={() => settle.mutate(settling)} disabled={reference.trim().length < 4} loading={settle.isPending}>
                Mark as paid
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
