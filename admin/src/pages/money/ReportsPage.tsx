import { Alert, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconDownload } from '@tabler/icons-react';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { istToday } from '../../lib/format';

const MAX_DAYS = 366;

function firstOfMonth(today: string): string {
  return `${today.slice(0, 8)}01`;
}

/** Order export for accounting. Dates are India calendar days; the file opens directly in Excel. */
export function ReportsPage() {
  const today = istToday();
  const [range, setRange] = useState<[string | null, string | null]>([firstOfMonth(today), today]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [from, to] = range;
  const days = from && to ? (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 : 0;
  const tooLong = days > MAX_DAYS;

  async function download() {
    if (!from || !to) return;
    setBusy(true);
    setError(null);
    try {
      await api.download('/v1/admin/reports/orders.csv', { from, to });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack>
      <Title order={2}>Reports</Title>
      <Paper withBorder p="md" radius="md" maw={560}>
        <Stack>
          <div>
            <Text fw={600}>Orders (CSV)</Text>
            <Text size="sm" c="dimmed">
              Every order placed in the period: retailer, wholesaler, amounts, commission, status and delivery date.
            </Text>
          </div>
          <DatePickerInput
            type="range"
            label="Period (India time)"
            value={range}
            onChange={(v) => setRange(v as [string | null, string | null])}
            maxDate={today}
            valueFormat="D MMM YYYY"
            allowSingleDateInRange
          />
          {tooLong && <Alert color="yellow">Choose at most {MAX_DAYS} days.</Alert>}
          {error && <Alert color="red">{error}</Alert>}
          <Group>
            <Button leftSection={<IconDownload size={16} />} onClick={() => void download()} loading={busy} disabled={!from || !to || tooLong}>
              Download CSV
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}
