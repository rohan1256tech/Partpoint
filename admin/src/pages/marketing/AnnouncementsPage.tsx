import { Alert, Badge, Button, Group, Loader, Modal, Paper, SegmentedControl, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconSpeakerphone } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { EmptyState } from '../../components/EmptyState';
import { count, dateTime } from '../../lib/format';
import { useAction } from '../../lib/mutations';

type Audience = 'retailer' | 'wholesaler' | 'delivery' | 'all';
interface Announcement {
  id: string;
  audience: Audience;
  title: string;
  body: string;
  recipients: number;
  devices: number;
  sentAt: string;
}

const AUDIENCE_LABEL: Record<Audience, string> = {
  retailer: 'Retailers',
  wholesaler: 'Wholesalers',
  delivery: 'Delivery partners',
  all: 'Everyone',
};

/** Push announcements to approved users. A push cannot be recalled, so sending asks for confirmation. */
export function AnnouncementsPage() {
  const [audience, setAudience] = useState<Audience>('retailer');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirming, setConfirming] = useState(false);
  const history = useQuery({ queryKey: ['announcements'], queryFn: () => api.get<{ items: Announcement[] }>('/v1/admin/announcements') });

  const send = useAction({
    run: () => api.post<Announcement>('/v1/admin/announcements', { audience, title: title.trim(), body: body.trim() }),
    success: (a: Announcement) =>
      a.devices > 0 ? `Sent to ${count(a.recipients)} account(s) on ${count(a.devices)} device(s)` : `Recorded, but none of the ${count(a.recipients)} account(s) has notifications set up yet`,
    invalidate: [['announcements']],
    onDone: () => {
      setTitle('');
      setBody('');
      setConfirming(false);
    },
  });

  const valid = title.trim().length >= 3 && body.trim().length >= 3;

  return (
    <Stack>
      <Title order={2}>Announcements</Title>
      <Text size="sm" c="dimmed" maw={640}>
        Send a push notification to approved users, for example a festival offer, new brands, or a service notice. Keep it short and useful: people
        turn off notifications that feel like spam.
      </Text>

      <Group align="flex-start" gap="xl" wrap="wrap">
        <Paper withBorder p="md" radius="md" w={460} maw="100%">
          <Stack>
            <SegmentedControl
              value={audience}
              onChange={(v) => setAudience(v as Audience)}
              data={(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }))}
              fullWidth
            />
            <TextInput
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value.slice(0, 60))}
              description={`${title.length}/60`}
              placeholder="Diwali offer on chargers"
            />
            <Textarea
              label="Message"
              value={body}
              onChange={(e) => setBody(e.currentTarget.value.slice(0, 200))}
              description={`${body.length}/200`}
              placeholder="10% off all chargers and cables until Sunday. Use code DIWALI10."
              autosize
              minRows={3}
            />
            <Group justify="flex-end">
              <Button leftSection={<IconSpeakerphone size={16} />} disabled={!valid} onClick={() => setConfirming(true)}>
                Send…
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Stack gap={6} w={320} maw="100%">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Preview
          </Text>
          <Paper radius="lg" p="sm" shadow="sm" withBorder>
            <Group gap={6} mb={4}>
              <Badge size="xs" variant="filled" radius="sm">
                P
              </Badge>
              <Text size="xs" c="dimmed">
                {audience === 'delivery' ? 'Partpoint Delivery' : 'Partpoint'} · now
              </Text>
            </Group>
            <Text size="sm" fw={600} lineClamp={1}>
              {title || 'Title'}
            </Text>
            <Text size="sm" c="dimmed" lineClamp={4}>
              {body || 'Your message appears here.'}
            </Text>
          </Paper>
        </Stack>
      </Group>

      <Title order={4} mt="md">
        Sent
      </Title>
      {history.error && <Alert color="red">{errorMessage(history.error)}</Alert>}
      {history.isLoading ? (
        <Loader />
      ) : (history.data?.items ?? []).length === 0 ? (
        <EmptyState icon={IconSpeakerphone} title="No announcements yet">
          Announcements you send are listed here with how many people they reached.
        </EmptyState>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Sent</Table.Th>
              <Table.Th>To</Table.Th>
              <Table.Th>Message</Table.Th>
              <Table.Th ta="right">Accounts</Table.Th>
              <Table.Th ta="right">Devices</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(history.data?.items ?? []).map((a) => (
              <Table.Tr key={a.id}>
                <Table.Td>{dateTime(a.sentAt)}</Table.Td>
                <Table.Td>{AUDIENCE_LABEL[a.audience]}</Table.Td>
                <Table.Td>
                  <Text size="sm" fw={600}>
                    {a.title}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {a.body}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">{count(a.recipients)}</Table.Td>
                <Table.Td ta="right">{count(a.devices)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={confirming} onClose={() => setConfirming(false)} title="Send this announcement?">
        <Stack>
          <Text size="sm">
            It goes to <b>{AUDIENCE_LABEL[audience].toLowerCase()}</b> straight away and can't be recalled.
          </Text>
          <Paper withBorder p="sm" radius="md">
            <Text size="sm" fw={600}>
              {title}
            </Text>
            <Text size="sm" c="dimmed">
              {body}
            </Text>
          </Paper>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => send.mutate(undefined)} loading={send.isPending}>
              Send now
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
