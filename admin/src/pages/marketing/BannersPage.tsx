import { Alert, Badge, Button, Card, Group, Image, Loader, Modal, NumberInput, Select, SimpleGrid, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { Banner, BannerLink, Brand, Category } from '../../api/types';
import { ImageUpload } from '../../components/ImageUpload';
import { date } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { rowLink } from '../../lib/rowLink';
import { IconPhoto } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';

type Draft = Omit<Banner, 'id' | 'imageKey' | 'startsAt' | 'endsAt'> & {
  id?: string;
  imageKey: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
};
const EMPTY: Draft = { title: '', imageKey: null, imageUrl: '', linkType: 'none', linkValue: null, sortOrder: 0, isActive: true, startsAt: null, endsAt: null };

/** Home-screen banners in the Partpoint app, in display order. */
export function BannersPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const banners = useQuery({ queryKey: ['banners'], queryFn: () => api.get<{ items: Banner[] }>('/v1/admin/banners') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ items: Category[] }>('/v1/admin/categories') });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get<{ items: Brand[] }>('/v1/admin/brands') });

  const save = useAction({
    run: (d: Draft) => {
      const body = {
        title: d.title.trim(),
        ...(d.imageKey ? { imageKey: d.imageKey } : {}),
        linkType: d.linkType,
        linkValue: d.linkType === 'none' ? null : d.linkValue,
        sortOrder: d.sortOrder,
        isActive: d.isActive,
        startsAt: d.startsAt?.toISOString() ?? null,
        endsAt: d.endsAt?.toISOString() ?? null,
      };
      return d.id ? api.patch<Banner>(`/v1/admin/banners/${d.id}`, body) : api.post<Banner>('/v1/admin/banners', body);
    },
    success: 'Banner saved',
    invalidate: [['banners']],
    onDone: () => setDraft(null),
  });
  const remove = useAction({
    run: (id: string) => api.del(`/v1/admin/banners/${id}`),
    success: 'Banner deleted',
    invalidate: [['banners']],
    onDone: () => setDraft(null),
  });

  const linkOptions =
    draft?.linkType === 'category'
      ? (categories.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))
      : draft?.linkType === 'brand'
        ? (brands.data?.items ?? []).map((b) => ({ value: b.id, label: b.name }))
        : [];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Banners</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setDraft({ ...EMPTY })}>
          New banner
        </Button>
      </Group>
      {banners.error && <Alert color="red">{errorMessage(banners.error)}</Alert>}
      {banners.isLoading ? (
        <Loader />
      ) : (banners.data?.items ?? []).length === 0 ? (
        <EmptyState icon={IconPhoto} title="No banners yet">Banners appear at the top of the Partpoint home screen. Use them for offers or new brands.</EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {(banners.data?.items ?? []).map((b) => (
            <Card
              key={b.id}
              withBorder
              padding="sm"
              {...rowLink(() =>
                setDraft({ ...b, startsAt: b.startsAt ? new Date(b.startsAt) : null, endsAt: b.endsAt ? new Date(b.endsAt) : null }),
              )}
            >
              <Card.Section>
                <Image src={b.imageUrl} h={120} fit="cover" alt="" fallbackSrc="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
              </Card.Section>
              <Group justify="space-between" mt="xs">
                <Text fw={600} size="sm">
                  {b.title}
                </Text>
                <Badge variant="light" color={b.isActive ? 'green' : 'gray'}>
                  {b.isActive ? 'Active' : 'Off'}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                Order {b.sortOrder} · {b.linkType === 'none' ? 'no link' : `links to a ${b.linkType}`}
                {b.endsAt ? ` · ends ${date(b.endsAt)}` : ''}
              </Text>
            </Card>
          ))}
        </SimpleGrid>
      )}

      <Modal opened={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit banner' : 'New banner'} size="lg">
        {draft && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(draft);
            }}
          >
            <Stack>
              <TextInput label="Title" description="Shown to screen-reader users and in the admin list." required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })} maxLength={100} />
              <ImageUpload kind="banners" url={draft.imageUrl || null} onUploaded={(key, url) => setDraft({ ...draft, imageKey: key, imageUrl: url })} />
              <Group grow>
                <Select
                  label="Tapping the banner opens"
                  value={draft.linkType}
                  onChange={(v) => setDraft({ ...draft, linkType: (v ?? 'none') as BannerLink, linkValue: null })}
                  data={[
                    { value: 'none', label: 'Nothing' },
                    { value: 'category', label: 'A category' },
                    { value: 'brand', label: 'A brand' },
                    { value: 'product', label: 'A product (paste its ID)' },
                  ]}
                  allowDeselect={false}
                />
                {draft.linkType === 'product' ? (
                  <TextInput label="Product ID" value={draft.linkValue ?? ''} onChange={(e) => setDraft({ ...draft, linkValue: e.currentTarget.value.trim() || null })} />
                ) : draft.linkType !== 'none' ? (
                  <Select label="Which one" searchable value={draft.linkValue} onChange={(v) => setDraft({ ...draft, linkValue: v })} data={linkOptions} />
                ) : null}
              </Group>
              <Group grow>
                <NumberInput label="Display order" min={0} max={10000} value={draft.sortOrder} onChange={(v) => setDraft({ ...draft, sortOrder: Number(v) || 0 })} />
                <DateTimePicker label="Show from" clearable value={draft.startsAt} onChange={(v) => setDraft({ ...draft, startsAt: v ? new Date(v) : null })} placeholder="Immediately" />
                <DateTimePicker label="Show until" clearable value={draft.endsAt} onChange={(v) => setDraft({ ...draft, endsAt: v ? new Date(v) : null })} placeholder="No end date" />
              </Group>
              <Switch label="Active" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.currentTarget.checked })} />
              <Group justify="space-between">
                {draft.id ? (
                  <Button color="red" variant="subtle" onClick={() => draft.id && remove.mutate(draft.id)} loading={remove.isPending}>
                    Delete
                  </Button>
                ) : (
                  <span />
                )}
                <Group>
                  <Button variant="default" onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    loading={save.isPending}
                    disabled={!draft.title.trim() || (!draft.id && !draft.imageKey) || (draft.linkType !== 'none' && !draft.linkValue)}
                  >
                    Save
                  </Button>
                </Group>
              </Group>
            </Stack>
          </form>
        )}
      </Modal>
    </Stack>
  );
}
