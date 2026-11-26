import { Alert, Badge, Button, Group, Loader, Modal, SegmentedControl, Stack, Table, Text, Textarea, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { DeletionRequest } from '../../api/types';
import { dateTime, humanize } from '../../lib/format';
import { useAction } from '../../lib/mutations';

type Status = 'requested' | 'completed' | 'rejected';
const COLOR: Record<Status, string> = { requested: 'yellow', completed: 'green', rejected: 'gray' };

/**
 * Requests from the public "delete your account" web page (Play policy). In-app deletions are
 * processed immediately and appear here as completed.
 */
export function DeletionRequestsPage() {
  const [status, setStatus] = useState<Status>('requested');
  const [open, setOpen] = useState<DeletionRequest | null>(null);
  const [note, setNote] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['deletion-requests', status],
    queryFn: () => api.get<{ items: DeletionRequest[] }>('/v1/admin/account-deletion-requests', { status }),
  });
  const decide = useAction({
    run: ({ id, decision }: { id: string; decision: 'complete' | 'reject' }) =>
      api.post(`/v1/admin/account-deletion-requests/${id}/${decision}`, note.trim() ? { note: note.trim() } : {}),
    success: (_r, { decision }) => (decision === 'complete' ? 'Account deleted' : 'Request rejected'),
    invalidate: [['deletion-requests'], ['users']],
    onDone: () => {
      setOpen(null);
      setNote('');
    },
  });
  const items = data?.items ?? [];

  return (
    <Stack>
      <Title order={2}>Account deletion requests</Title>
      <SegmentedControl
        w="fit-content"
        value={status}
        onChange={(v) => setStatus(v as Status)}
        data={[
          { value: 'requested', label: 'To process' },
          { value: 'completed', label: 'Completed' },
          { value: 'rejected', label: 'Rejected' },
        ]}
      />
      {error && <Alert color="red">{errorMessage(error)}</Alert>}
      {isLoading ? (
        <Loader />
      ) : items.length === 0 ? (
        <Text c="dimmed">{status === 'requested' ? 'No requests waiting.' : 'Nothing here.'}</Text>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Contact</Table.Th>
              <Table.Th>Account</Table.Th>
              <Table.Th>Source</Table.Th>
              <Table.Th>Reason</Table.Th>
              <Table.Th>Received</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((r) => (
              <Table.Tr key={r.id} style={{ cursor: r.status === 'requested' ? 'pointer' : undefined }} onClick={() => r.status === 'requested' && setOpen(r)}>
                <Table.Td>{r.contact}</Table.Td>
                <Table.Td>{r.userId ? 'Found' : <Text c="dimmed" size="sm">No account</Text>}</Table.Td>
                <Table.Td>{r.source === 'app' ? 'In app' : 'Web form'}</Table.Td>
                <Table.Td>{r.reason ?? '—'}</Table.Td>
                <Table.Td>{dateTime(r.createdAt)}</Table.Td>
                <Table.Td>
                  <Badge variant="light" color={COLOR[r.status]}>
                    {humanize(r.status)}
                  </Badge>
                  {r.note && (
                    <Text size="xs" c="dimmed">
                      {r.note}
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={!!open} onClose={() => setOpen(null)} title="Process deletion request">
        {open && (
          <Stack>
            <Text size="sm">
              <b>{open.contact}</b> asked to delete their account{open.reason ? `: “${open.reason}”` : '.'}
            </Text>
            <Alert color="yellow">
              Confirm the request with the person first (call the number or reply to the email): the web form does not prove who sent it.
              Deleting erases their personal data and cannot be undone; order records are kept for GST.
            </Alert>
            {!open.userId && <Text size="sm" c="dimmed">No account matches this contact. Completing just closes the request.</Text>}
            <Textarea label="Note" description="Required when rejecting." value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={500} />
            <Group justify="flex-end">
              <Button variant="default" disabled={!note.trim()} onClick={() => decide.mutate({ id: open.id, decision: 'reject' })} loading={decide.isPending}>
                Reject
              </Button>
              <Button color="red" onClick={() => decide.mutate({ id: open.id, decision: 'complete' })} loading={decide.isPending}>
                {open.userId ? 'Delete account' : 'Close request'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
