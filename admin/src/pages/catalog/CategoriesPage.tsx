import {
  Alert,
  Badge,
  Button,
  Group,
  Image,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { Category } from '../../api/types';
import { ImageUpload } from '../../components/ImageUpload';
import { useAction } from '../../lib/mutations';

type Draft = { id?: string; name: string; slug: string; parentId: string | null; sortOrder: number; isActive: boolean; imageKey?: string; imageUrl: string | null };
const EMPTY: Draft = { name: '', slug: '', parentId: null, sortOrder: 0, isActive: true, imageUrl: null };

/** Two levels: top-level categories, each with sub-categories. */
export function CategoriesPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ items: Category[] }>('/v1/admin/categories'),
  });
  const all = data?.items ?? [];
  const tops = all.filter((c) => !c.parentId);
  const childrenOf = (id: string) => all.filter((c) => c.parentId === id);

  const save = useAction({
    run: (d: Draft) => {
      const body = {
        name: d.name.trim(),
        ...(d.slug.trim() ? { slug: d.slug.trim() } : {}),
        parentId: d.parentId,
        sortOrder: d.sortOrder,
        isActive: d.isActive,
        ...(d.imageKey ? { imageKey: d.imageKey } : {}),
      };
      return d.id ? api.patch<Category>(`/v1/admin/categories/${d.id}`, body) : api.post<Category>('/v1/admin/categories', body);
    },
    success: (c: Category) => `Saved “${c.name}”`,
    invalidate: [['categories']],
    onDone: () => setDraft(null),
  });

  const row = (c: Category, child = false) => (
    <Table.Tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setDraft({ ...c, imageUrl: c.imageUrl, imageKey: undefined })}>
      <Table.Td pl={child ? 36 : undefined}>
        <Group gap="sm">
          {c.imageUrl ? <Image src={c.imageUrl} w={28} h={28} radius="sm" alt="" /> : <div style={{ width: 28 }} />}
          <Text size="sm" fw={child ? 400 : 600}>
            {c.name}
          </Text>
        </Group>
      </Table.Td>
      <Table.Td c="dimmed">{c.slug}</Table.Td>
      <Table.Td>{c.sortOrder}</Table.Td>
      <Table.Td>{c.isActive ? <Badge variant="light" color="green">Active</Badge> : <Badge variant="light" color="gray">Hidden</Badge>}</Table.Td>
    </Table.Tr>
  );

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Categories</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setDraft({ ...EMPTY })}>
          New category
        </Button>
      </Group>
      {error && <Alert color="red">{errorMessage(error)}</Alert>}
      {isLoading ? (
        <Loader />
      ) : tops.length === 0 ? (
        <Text c="dimmed">No categories yet. Create the first one.</Text>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Slug</Table.Th>
              <Table.Th>Order</Table.Th>
              <Table.Th>Visibility</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>{tops.flatMap((t) => [row(t), ...childrenOf(t.id).map((c) => row(c, true))])}</Table.Tbody>
        </Table>
      )}

      <Modal opened={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit category' : 'New category'}>
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
                description="Used in links. Leave empty to generate from the name."
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.currentTarget.value })}
              />
              <Select
                label="Parent"
                description="Leave empty for a top-level category."
                clearable
                value={draft.parentId}
                onChange={(v) => setDraft({ ...draft, parentId: v })}
                data={tops.filter((t) => t.id !== draft.id).map((t) => ({ value: t.id, label: t.name }))}
                disabled={!!draft.id && childrenOf(draft.id).length > 0}
              />
              <NumberInput label="Sort order" min={0} max={10000} value={draft.sortOrder} onChange={(v) => setDraft({ ...draft, sortOrder: Number(v) || 0 })} />
              <Switch
                label="Visible to buyers"
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.currentTarget.checked })}
              />
              <ImageUpload kind="categories" url={draft.imageUrl} onUploaded={(key, url) => setDraft({ ...draft, imageKey: key, imageUrl: url })} />
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
