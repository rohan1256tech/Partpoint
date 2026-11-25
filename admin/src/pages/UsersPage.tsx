import {
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from '../api/client';
import type { Page, PublicUser, UserStatus, UserWithProfile } from '../api/types';
import { date, dateTime, humanize } from '../lib/format';

const STATUS_COLOR: Record<UserStatus, string> = { pending: 'yellow', approved: 'green', blocked: 'red' };

export function StatusBadge({ status }: { status: UserStatus }) {
  return (
    <Badge color={STATUS_COLOR[status]} variant="light">
      {humanize(status)}
    </Badge>
  );
}

export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? 'pending') as UserStatus | 'all';
  const role = params.get('role') ?? '';
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['users', status, role],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Page<PublicUser>>('/v1/admin/users', {
        status: status === 'all' ? undefined : status,
        role: role || undefined,
        cursor: pageParam,
        limit: 50,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const users = list.data?.pages.flatMap((p) => p.items) ?? [];

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <Stack>
      <Title order={2}>Users</Title>
      <Group>
        <SegmentedControl
          value={status}
          onChange={(v) => set('status', v)}
          data={[
            { value: 'pending', label: 'Pending' },
            { value: 'approved', label: 'Approved' },
            { value: 'blocked', label: 'Blocked' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Select
          placeholder="All roles"
          clearable
          value={role || null}
          onChange={(v) => set('role', v ?? '')}
          data={[
            { value: 'retailer', label: 'Retailers' },
            { value: 'wholesaler', label: 'Wholesalers' },
            { value: 'delivery', label: 'Delivery partners' },
          ]}
          w={190}
          aria-label="Role"
        />
      </Group>

      {list.error && <Alert color="red">{errorMessage(list.error)}</Alert>}
      {list.isLoading ? (
        <Loader />
      ) : users.length === 0 ? (
        <Text c="dimmed">No users here.</Text>
      ) : (
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Contact</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Joined</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((u) => (
              <Table.Tr key={u.id} onClick={() => setOpenId(u.id)} style={{ cursor: 'pointer' }}>
                <Table.Td>{u.name}</Table.Td>
                <Table.Td>{humanize(u.role)}</Table.Td>
                <Table.Td>{u.phone ?? u.email}</Table.Td>
                <Table.Td>
                  <StatusBadge status={u.status} />
                </Table.Td>
                <Table.Td>{date(u.createdAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {list.hasNextPage && (
        <Button variant="default" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage} w="fit-content">
          Load more
        </Button>
      )}

      <UserDrawer userId={openId} onClose={() => setOpenId(null)} />
    </Stack>
  );
}

function UserDrawer({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const detail = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.get<UserWithProfile>(`/v1/admin/users/${userId}`),
    enabled: !!userId,
  });

  const action = useMutation({
    mutationFn: ({ kind }: { kind: 'approve' | 'block' }) =>
      api.post<UserWithProfile>(`/v1/admin/users/${userId}/${kind}`, kind === 'block' ? { reason } : {}),
    onSuccess: (u, { kind }) => {
      notifications.show({ color: kind === 'block' ? 'red' : 'green', message: `${u.name} ${kind === 'block' ? 'blocked' : 'approved'}` });
      setReason('');
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.setQueryData(['user', userId], u);
    },
    onError: (err) => notifications.show({ color: 'red', message: errorMessage(err) }),
  });

  const u = detail.data;
  return (
    <Drawer opened={!!userId} onClose={onClose} position="right" size="md" title={u?.name ?? 'User'}>
      {detail.isLoading || !u ? (
        <Loader />
      ) : (
        <Stack>
          <Group>
            <StatusBadge status={u.status} />
            <Badge variant="outline" color="gray">
              {humanize(u.role)}
            </Badge>
          </Group>
          <Table fz="sm" verticalSpacing={4}>
            <Table.Tbody>
              <Row label="Phone" value={u.phone} />
              <Row label="Email" value={u.email ? `${u.email}${u.emailVerified ? '' : ' (not verified)'}` : null} />
              <Row label="Joined" value={dateTime(u.createdAt)} />
              {u.statusReason && <Row label="Status reason" value={u.statusReason} />}
              {Object.entries(u.profile ?? {}).map(([k, v]) => (
                <Row key={k} label={humanize(k.replace(/([A-Z])/g, '_$1').toLowerCase())} value={v === null ? null : String(v)} />
              ))}
            </Table.Tbody>
          </Table>

          {u.status !== 'approved' && (
            <Button color="green" onClick={() => action.mutate({ kind: 'approve' })} loading={action.isPending}>
              {u.status === 'blocked' ? 'Unblock' : 'Approve'}
            </Button>
          )}
          {u.status !== 'blocked' && (
            <Stack gap="xs">
              <Textarea
                label="Reason for blocking"
                description="Shown to the user. Blocking signs them out everywhere at once."
                value={reason}
                onChange={(e) => setReason(e.currentTarget.value)}
                maxLength={500}
              />
              <Button color="red" variant="light" disabled={!reason.trim()} onClick={() => action.mutate({ kind: 'block' })} loading={action.isPending}>
                Block
              </Button>
            </Stack>
          )}
        </Stack>
      )}
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <Table.Tr>
      <Table.Td c="dimmed" w={140}>
        {label}
      </Table.Td>
      <Table.Td>{value ?? '—'}</Table.Td>
    </Table.Tr>
  );
}
