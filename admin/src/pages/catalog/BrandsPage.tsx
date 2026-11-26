import { Alert, Badge, Button, Group, Image, Loader, Modal, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { Brand } from '../../api/types';
import { ImageUpload } from '../../components/ImageUpload';
import { useAction } from '../../lib/mutations';

type Draft = { id?: string; name: string; slug: string; isActive: boolean; logoKey?: string; logoUrl: string | null };

export function BrandsPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<{ items: Brand[] }>('/v1/admin/brands'),
  });
  const brands = (data?.items ?? []).filter((b) => b.name.toLowerCase().includes(search.trim().toLowerCase()));

  const save = useAction({
    run: (d: Draft) => {
      const body = {
        name: d.name.trim(),
        ...(d.slug.trim() ? { slug: d.slug.trim() } : {}),
        isActive: d.isActive,
        ...(d.logoKey ? { logoKey: d.logoKey } : {}),
      };
      return d.id ? api.patch<Brand>(`/v1/admin/brands/${d.id}`, body) : api.post<Brand>('/v1/admin/brands', body);
    },
    success: (b: Brand) => `Saved “${b.name}”`,
    invalidate: [['brands']],
    onDone: () => setDraft(null),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Brands</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setDraft({ name: '', slug: '', isActive: true, logoUrl: null })}>
          New brand
        </Button>
      </Group>
      <TextInput placeholder="Search brands" value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={280} aria-label="Search brands" />
      {error && <Alert color="red">{errorMessage(error)}</Alert>}
      {isLoading ? (
        <Loader />
      ) : brands.length === 0 ? (
        <Text c="dimmed">No brands found.</Text>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Brand</Table.Th>
              <Table.Th>Slug</Table.Th>
              <Table.Th>Visibility</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {brands.map((b) => (
              <Table.Tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => setDraft({ ...b, logoKey: undefined })}>
                <Table.Td>
                  <Group gap="sm">
                    {b.logoUrl ? <Image src={b.logoUrl} w={28} h={28} radius="sm" alt="" /> : <div style={{ width: 28 }} />}
                    <Text size="sm" fw={600}>
                      {b.name}
                    </Text>
                  </Group>
                </Table.Td>
                <Table.Td c="dimmed">{b.slug}</Table.Td>
                <Table.Td>{b.isActive ? <Badge variant="light" color="green">Active</Badge> : <Badge variant="light" color="gray">Hidden</Badge>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit brand' : 'New brand'}>
        {draft && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(draft);
            }}
          >
            <Stack>
              <TextInput label="Name" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} />
              <TextInput
                label="Slug"
                description="Leave empty to generate from the name."
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.currentTarget.value })}
              />
              <Switch label="Visible to buyers" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.currentTarget.checked })} />
              <ImageUpload kind="brands" url={draft.logoUrl} onUploaded={(key, url) => setDraft({ ...draft, logoKey: key, logoUrl: url })} />
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button type="submit" loading={save.isPending} disabled={!draft.name.trim()}>
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
