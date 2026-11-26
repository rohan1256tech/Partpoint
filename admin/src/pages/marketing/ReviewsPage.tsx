import { Alert, Badge, Button, Card, Group, Loader, Rating, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { AdminReview, Page } from '../../api/types';
import { dateTime } from '../../lib/format';
import { useAction } from '../../lib/mutations';

type Filter = 'reported' | 'visible' | 'hidden';

/** Play policy (user-generated content): reported reviews are reviewed here and hidden if needed. */
export function ReviewsPage() {
  const [filter, setFilter] = useState<Filter>('reported');
  const list = useInfiniteQuery({
    queryKey: ['reviews', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Page<AdminReview>>('/v1/admin/reviews', {
        ...(filter === 'reported' ? { reported: 'true' } : { status: filter }),
        cursor: pageParam,
        limit: 30,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const reviews = list.data?.pages.flatMap((p) => p.items) ?? [];

  const moderate = useAction({
    run: ({ id, action }: { id: string; action: 'hide' | 'unhide' | 'dismiss-reports' }) => api.post(`/v1/admin/reviews/${id}/${action}`),
    success: (_r, { action }) =>
      action === 'hide' ? 'Review hidden; rating updated' : action === 'unhide' ? 'Review visible again' : 'Reports dismissed',
    invalidate: [['reviews'], ['dashboard']],
  });

  return (
    <Stack>
      <Title order={2}>Reviews</Title>
      <SegmentedControl
        w="fit-content"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        data={[
          { value: 'reported', label: 'Reported' },
          { value: 'visible', label: 'Visible' },
          { value: 'hidden', label: 'Hidden' },
        ]}
      />
      {list.error && <Alert color="red">{errorMessage(list.error)}</Alert>}
      {list.isLoading ? (
        <Loader />
      ) : reviews.length === 0 ? (
        <Text c="dimmed">{filter === 'reported' ? 'Nothing to moderate.' : 'No reviews here.'}</Text>
      ) : (
        reviews.map((r) => (
          <Card key={r.id} withBorder padding="md">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text fw={600}>{r.productName}</Text>
                <Group gap="xs">
                  <Rating value={r.rating} readOnly size="sm" />
                  <Text size="xs" c="dimmed">
                    by {r.reviewer} · {dateTime(r.createdAt)}
                  </Text>
                </Group>
              </div>
              <Group gap="xs">
                {r.openReports > 0 && (
                  <Badge color="red" variant="light">
                    {r.openReports} report{r.openReports > 1 ? 's' : ''}
                  </Badge>
                )}
                <Badge color={r.status === 'visible' ? 'green' : 'gray'} variant="light">
                  {r.status === 'visible' ? 'Visible' : 'Hidden'}
                </Badge>
              </Group>
            </Group>
            {r.comment && (
              <Text size="sm" mt="xs" style={{ whiteSpace: 'pre-wrap' }}>
                {r.comment}
              </Text>
            )}
            {r.reportReasons.length > 0 && (
              <Text size="xs" c="dimmed" mt="xs">
                Reported for: {r.reportReasons.join(' · ')}
              </Text>
            )}
            <Group mt="sm" gap="xs">
              {r.status === 'visible' ? (
                <Button size="xs" color="red" variant="light" onClick={() => moderate.mutate({ id: r.id, action: 'hide' })} loading={moderate.isPending}>
                  Hide review
                </Button>
              ) : (
                <Button size="xs" variant="light" onClick={() => moderate.mutate({ id: r.id, action: 'unhide' })} loading={moderate.isPending}>
                  Show again
                </Button>
              )}
              {r.openReports > 0 && r.status === 'visible' && (
                <Button size="xs" variant="default" onClick={() => moderate.mutate({ id: r.id, action: 'dismiss-reports' })} loading={moderate.isPending}>
                  Keep it, dismiss reports
                </Button>
              )}
            </Group>
          </Card>
        ))
      )}
      {list.hasNextPage && (
        <Button variant="default" w="fit-content" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </Stack>
  );
}
