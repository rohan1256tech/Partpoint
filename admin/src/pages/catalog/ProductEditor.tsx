import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  CloseButton,
  Divider,
  Drawer,
  FileButton,
  Group,
  Image,
  Loader,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { IconEdit, IconPhotoUp, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { Brand, Category, PresignedUpload, ProductDetail, Variant } from '../../api/types';
import { RupeeInput } from '../../components/MoneyInput';
import { count, dateTime, rupees } from '../../lib/format';
import { toWebp } from '../../lib/image';
import { useAction } from '../../lib/mutations';
import { ProductStatusBadge } from './ProductsPage';

const GST_RATES = [0, 500, 1200, 1800, 2800, 4000];

interface DetailsForm {
  name: string;
  categoryId: string | null;
  brandId: string | null;
  partNumber: string;
  hsnCode: string;
  gstRateBps: number;
  description: string;
}

interface VariantForm {
  name: string;
  sku: string;
  mrpPaise: number | null;
  pricePaise: number | null;
  minOrderQty: number;
  isActive: boolean;
  slabs: { minQty: number | null; pricePaise: number | null }[];
}

const emptyVariant = (): VariantForm => ({ name: '', sku: '', mrpPaise: null, pricePaise: null, minOrderQty: 1, isActive: true, slabs: [] });

/** Problems that stop a variant being saved; the server checks the same rules. */
function variantProblems(v: VariantForm): string[] {
  const out: string[] = [];
  if (!v.name.trim()) out.push('Give the variant a name, e.g. “Black” or “With frame”');
  if (!v.mrpPaise) out.push('Enter the MRP');
  if (!v.pricePaise) out.push('Enter the price retailers pay');
  if (v.mrpPaise && v.pricePaise && v.pricePaise > v.mrpPaise) out.push('Price cannot be higher than MRP');
  let prevQty = v.minOrderQty;
  let prevPrice = v.pricePaise ?? Infinity;
  for (const s of [...v.slabs].sort((a, b) => (a.minQty ?? 0) - (b.minQty ?? 0))) {
    if (!s.minQty || !s.pricePaise) {
      out.push('Fill in or remove the empty bulk price row');
      break;
    }
    if (s.minQty <= prevQty) out.push(`Bulk quantity ${s.minQty} must be above ${prevQty}`);
    else if (s.pricePaise >= prevPrice) out.push(`Bulk price for ${s.minQty}+ must be lower than the price before it`);
    prevQty = s.minQty;
    prevPrice = s.pricePaise;
  }
  return out;
}

const variantBody = (v: VariantForm) => ({
  name: v.name.trim(),
  ...(v.sku.trim() ? { sku: v.sku.trim() } : {}),
  mrpPaise: v.mrpPaise,
  pricePaise: v.pricePaise,
  minOrderQty: v.minOrderQty,
  slabs: v.slabs.map((s) => ({ minQty: s.minQty, pricePaise: s.pricePaise })),
});

const detailsBody = (d: DetailsForm, editing: boolean) => ({
  name: d.name.trim(),
  categoryId: d.categoryId,
  brandId: d.brandId,
  gstRateBps: d.gstRateBps,
  ...(editing
    ? { partNumber: d.partNumber.trim() || null, hsnCode: d.hsnCode.trim() || null, description: d.description.trim() || null }
    : {
        ...(d.partNumber.trim() ? { partNumber: d.partNumber.trim() } : {}),
        ...(d.hsnCode.trim() ? { hsnCode: d.hsnCode.trim() } : {}),
        ...(d.description.trim() ? { description: d.description.trim() } : {}),
      }),
});

export function ProductEditor({
  productId,
  onOpen,
  onClose,
}: {
  productId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const isNew = productId === 'new';
  const detail = useQuery({
    queryKey: ['product', productId],
    queryFn: () => api.get<ProductDetail>(`/v1/admin/products/${productId}`),
    enabled: !!productId && !isNew,
  });
  const p = detail.data;
  return (
    <Drawer opened={!!productId} onClose={onClose} position="right" size="xl" title={isNew ? 'New product' : (p?.name ?? 'Product')}>
      {isNew ? (
        <NewProduct onCreated={onOpen} />
      ) : detail.error ? (
        <Alert color="red">{errorMessage(detail.error)}</Alert>
      ) : !p ? (
        <Loader />
      ) : (
        <EditProduct key={p.id} p={p} />
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------------------------- new

function NewProduct({ onCreated }: { onCreated: (id: string) => void }) {
  const [details, setDetails] = useState<DetailsForm>({
    name: '',
    categoryId: null,
    brandId: null,
    partNumber: '',
    hsnCode: '',
    gstRateBps: 1800,
    description: '',
  });
  const [variants, setVariants] = useState<VariantForm[]>([emptyVariant()]);
  const [tried, setTried] = useState(false);
  const problems = [
    ...(details.name.trim() ? [] : ['Enter the product name']),
    ...(details.categoryId ? [] : ['Choose a category']),
    ...variants.flatMap((v, i) => variantProblems(v).map((m) => (variants.length > 1 ? `Variant ${i + 1}: ${m}` : m))),
  ];
  const create = useAction({
    run: () => api.post<ProductDetail>('/v1/admin/products', { ...detailsBody(details, false), variants: variants.map(variantBody) }),
    success: 'Product saved as a draft. Add photos, then publish it.',
    invalidate: [['products']],
    onDone: (p: ProductDetail) => onCreated(p.id),
  });

  return (
    <Stack>
      <DetailsFields value={details} onChange={setDetails} />
      <Divider label="Variants" labelPosition="left" />
      <Text size="sm" c="dimmed">
        One row per option the retailer can choose: colour, quality, with or without frame, pack size. Price is what retailers pay Sakshay Connect, GST
        included.
      </Text>
      {variants.map((v, i) => (
        <Paper key={i} withBorder p="sm" radius="md">
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={600}>
              Variant {i + 1}
            </Text>
            {variants.length > 1 && <CloseButton aria-label="Remove variant" onClick={() => setVariants(variants.filter((_, j) => j !== i))} />}
          </Group>
          <VariantFields value={v} onChange={(nv) => setVariants(variants.map((x, j) => (j === i ? nv : x)))} />
        </Paper>
      ))}
      <Button variant="light" leftSection={<IconPlus size={16} />} w="fit-content" onClick={() => setVariants([...variants, emptyVariant()])}>
        Add another variant
      </Button>
      {tried && problems.length > 0 && (
        <Alert color="red" title="Before saving">
          {problems.map((m) => (
            <Text key={m} size="sm">
              • {m}
            </Text>
          ))}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button
          loading={create.isPending}
          onClick={() => {
            setTried(true);
            if (problems.length === 0) create.mutate(undefined);
          }}
        >
          Save draft
        </Button>
      </Group>
    </Stack>
  );
}

// ------------------------------------------------------------------------------------- edit

function EditProduct({ p }: { p: ProductDetail }) {
  const invalidate = [['products'], ['product', p.id]];
  const [details, setDetails] = useState<DetailsForm>({
    name: p.name,
    categoryId: p.category.id,
    brandId: p.brand?.id ?? null,
    partNumber: p.partNumber ?? '',
    hsnCode: p.hsnCode ?? '',
    gstRateBps: p.gstRateBps,
    description: p.description ?? '',
  });
  const [hideReason, setHideReason] = useState('');
  const save = useAction({
    run: () => api.patch<ProductDetail>(`/v1/admin/products/${p.id}`, detailsBody(details, true)),
    success: 'Product details saved',
    invalidate,
  });
  const visibility = useAction({
    run: (to: 'publish' | 'hide') => api.post<ProductDetail>(`/v1/admin/products/${p.id}/${to}`, to === 'hide' && hideReason.trim() ? { reason: hideReason.trim() } : {}),
    success: (_r: ProductDetail, to) => (to === 'publish' ? 'Live: retailers can see and order it' : 'Hidden from retailers'),
    invalidate,
    onDone: () => setHideReason(''),
  });
  const totalStock = p.variants.filter((v) => v.isActive).reduce((s, v) => s + v.stockQty, 0);

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="xs">
          <ProductStatusBadge status={p.status} />
          <Badge variant="light" color={totalStock > 0 ? 'teal' : 'red'}>
            {totalStock > 0 ? `${count(totalStock)} in stock` : 'Out of stock'}
          </Badge>
          <Text size="xs" c="dimmed">
            Updated {dateTime(p.updatedAt)}
          </Text>
        </Group>
        {p.status === 'active' ? (
          <Group gap="xs">
            <TextInput size="xs" placeholder="Reason (optional)" value={hideReason} onChange={(e) => setHideReason(e.currentTarget.value)} w={180} />
            <Button size="xs" color="yellow" variant="light" onClick={() => visibility.mutate('hide')} loading={visibility.isPending}>
              Hide
            </Button>
          </Group>
        ) : (
          <Button size="xs" onClick={() => visibility.mutate('publish')} loading={visibility.isPending}>
            Publish
          </Button>
        )}
      </Group>
      {p.statusReason && p.status !== 'active' && <Alert color="yellow">{p.statusReason}</Alert>}

      <ImagesSection p={p} />

      <Divider label="Details" labelPosition="left" />
      <DetailsFields value={details} onChange={setDetails} />
      <Group justify="flex-end">
        <Button variant="default" onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!details.name.trim() || !details.categoryId}>
          Save details
        </Button>
      </Group>

      <Divider label="Variants, prices and stock" labelPosition="left" />
      <VariantsSection p={p} />
    </Stack>
  );
}

function ImagesSection({ p }: { p: ProductDetail }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['product', p.id] });
    void qc.invalidateQueries({ queryKey: ['products'] });
  };
  const remove = useAction({
    run: (imageId: string) => api.del<ProductDetail>(`/v1/admin/products/${p.id}/images/${imageId}`),
    success: 'Photo removed',
    invalidate: [['product', p.id], ['products']],
  });

  async function add(files: File[]) {
    setBusy(true);
    setError(null);
    try {
      for (const file of files) {
        const webp = await toWebp(file);
        const { objectKey, upload } = await api.post<PresignedUpload>(`/v1/admin/products/${p.id}/images/upload-url`, {
          contentType: 'image/webp',
          sizeBytes: webp.size,
        });
        const { 'content-length': _len, ...headers } = upload.headers;
        const put = await fetch(upload.url, { method: 'PUT', headers, body: webp });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        await api.post(`/v1/admin/products/${p.id}/images`, { objectKey });
      }
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={600}>Photos</Text>
        <FileButton onChange={(f) => void add(f)} accept="image/png,image/jpeg,image/webp" multiple>
          {(props) => (
            <Button {...props} size="xs" variant="default" leftSection={<IconPhotoUp size={16} />} loading={busy} disabled={p.images.length >= 8}>
              Add photos
            </Button>
          )}
        </FileButton>
      </Group>
      {p.images.length === 0 ? (
        <Text size="sm" c="dimmed">
          No photos yet. Clear photos on a white background sell best; the first photo is the thumbnail.
        </Text>
      ) : (
        <SimpleGrid cols={5} spacing="xs">
          {p.images.map((img) => (
            <div key={img.id} style={{ position: 'relative' }}>
              <Image src={img.url} radius="sm" h={88} fit="cover" alt="" />
              <ActionIcon
                size="sm"
                color="red"
                variant="filled"
                style={{ position: 'absolute', top: 4, right: 4 }}
                aria-label="Remove photo"
                onClick={() => remove.mutate(img.id)}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </div>
          ))}
        </SimpleGrid>
      )}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}

function VariantsSection({ p }: { p: ProductDetail }) {
  const [editing, setEditing] = useState<string | null>(null); // variant id or 'new'
  return (
    <Stack>
      {p.variants.map((v) =>
        editing === v.id ? (
          <VariantEditor key={v.id} productId={p.id} variant={v} onDone={() => setEditing(null)} />
        ) : (
          <VariantCard key={v.id} v={v} onEdit={() => setEditing(v.id)} />
        ),
      )}
      {editing === 'new' ? (
        <VariantEditor productId={p.id} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="light" leftSection={<IconPlus size={16} />} w="fit-content" onClick={() => setEditing('new')} disabled={p.variants.length >= 20}>
          Add variant
        </Button>
      )}
    </Stack>
  );
}

function VariantCard({ v, onEdit }: { v: Variant; onEdit: () => void }) {
  const offers = v.offers ?? [];
  return (
    <Paper withBorder p="sm" radius="md" style={{ opacity: v.isActive ? 1 : 0.6 }}>
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="xs">
            <Text fw={600}>{v.name}</Text>
            {!v.isActive && <Badge size="xs" color="gray">Inactive</Badge>}
            {v.sku && (
              <Text size="xs" c="dimmed">
                SKU {v.sku}
              </Text>
            )}
          </Group>
          <Text size="sm">
            {rupees(v.pricePaise)}{' '}
            <Text span size="xs" c="dimmed" td="line-through">
              {rupees(v.mrpPaise)}
            </Text>
            {v.minOrderQty > 1 && (
              <Text span size="xs" c="dimmed">
                {' '}
                · min {v.minOrderQty}
              </Text>
            )}
          </Text>
          {v.slabs.length > 0 && (
            <Text size="xs" c="dimmed">
              Bulk: {v.slabs.map((s) => `${s.minQty}+ at ${rupees(s.pricePaise)}`).join(', ')}
            </Text>
          )}
        </div>
        <Button size="xs" variant="subtle" leftSection={<IconEdit size={14} />} onClick={onEdit}>
          Edit
        </Button>
      </Group>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt="sm" mb={4}>
        Wholesaler stock · {count(v.stockQty)} available
      </Text>
      {offers.length === 0 ? (
        <Text size="sm" c="dimmed">
          No wholesaler stocks this yet. Wholesalers add stock from the Sakshay Connect app.
        </Text>
      ) : (
        <Table fz="sm" verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Wholesaler</Table.Th>
              <Table.Th ta="right">Supply price</Table.Th>
              <Table.Th ta="right">Margin</Table.Th>
              <Table.Th ta="right">Stock</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {offers.map((o) => {
              const margin = v.pricePaise - o.supplyPricePaise;
              const off = !o.isActive || !o.usable;
              return (
                <Table.Tr key={o.wholesalerId} c={off ? 'dimmed' : undefined}>
                  <Table.Td>
                    {o.businessName}
                    <Text span size="xs" c="dimmed">
                      {' '}
                      · {o.city}
                      {!o.isActive ? ' · paused' : !o.usable ? ' · account not active' : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">{rupees(o.supplyPricePaise)}</Table.Td>
                  <Table.Td ta="right" c={margin < 0 ? 'red' : undefined}>
                    {rupees(margin)} ({((margin / v.pricePaise) * 100).toFixed(1)}%)
                  </Table.Td>
                  <Table.Td ta="right">{count(o.stockQty)}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Paper>
  );
}

function VariantEditor({ productId, variant, onDone }: { productId: string; variant?: Variant; onDone: () => void }) {
  const [v, setV] = useState<VariantForm>(
    variant
      ? {
          name: variant.name,
          sku: variant.sku ?? '',
          mrpPaise: variant.mrpPaise,
          pricePaise: variant.pricePaise,
          minOrderQty: variant.minOrderQty,
          isActive: variant.isActive,
          slabs: variant.slabs,
        }
      : emptyVariant(),
  );
  const [tried, setTried] = useState(false);
  const problems = variantProblems(v);
  const save = useAction({
    run: () =>
      variant
        ? api.patch<ProductDetail>(`/v1/admin/products/variants/${variant.id}`, {
            ...variantBody(v),
            sku: v.sku.trim() || null,
            isActive: v.isActive,
          })
        : api.post<ProductDetail>(`/v1/admin/products/${productId}/variants`, variantBody(v)),
    success: variant ? 'Variant saved' : 'Variant added',
    invalidate: [['product', productId], ['products']],
    onDone,
  });
  return (
    <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-default-hover)">
      <VariantFields value={v} onChange={setV} withActive={!!variant} />
      {tried && problems.length > 0 && (
        <Alert color="red" mt="sm" p="xs">
          {problems.map((m) => (
            <Text key={m} size="sm">
              • {m}
            </Text>
          ))}
        </Alert>
      )}
      <Group justify="flex-end" mt="sm">
        <Button variant="default" size="xs" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="xs"
          loading={save.isPending}
          onClick={() => {
            setTried(true);
            if (problems.length === 0) save.mutate(undefined);
          }}
        >
          Save variant
        </Button>
      </Group>
    </Paper>
  );
}

// ------------------------------------------------------------------------------------- fields

function DetailsFields({ value: d, onChange }: { value: DetailsForm; onChange: (d: DetailsForm) => void }) {
  const categories = useQuery({ queryKey: ['admin-categories'], queryFn: () => api.get<{ items: Category[] }>('/v1/admin/categories') });
  const brands = useQuery({ queryKey: ['admin-brands'], queryFn: () => api.get<{ items: Brand[] }>('/v1/admin/brands') });
  const cats = categories.data?.items ?? [];
  const label = (c: Category) => {
    const parent = cats.find((x) => x.id === c.parentId);
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };
  return (
    <Stack gap="sm">
      <TextInput
        label="Product name"
        description="Say what it is and which phones it fits, e.g. “Display combo for Aero A15”."
        required
        value={d.name}
        maxLength={150}
        onChange={(e) => onChange({ ...d, name: e.currentTarget.value })}
      />
      <SimpleGrid cols={2}>
        <Select
          label="Category"
          required
          searchable
          value={d.categoryId}
          onChange={(v) => onChange({ ...d, categoryId: v })}
          data={cats.filter((c) => c.isActive || c.id === d.categoryId).map((c) => ({ value: c.id, label: label(c) }))}
        />
        <Select
          label="Brand"
          clearable
          searchable
          value={d.brandId}
          onChange={(v) => onChange({ ...d, brandId: v })}
          data={(brands.data?.items ?? []).filter((b) => b.isActive || b.id === d.brandId).map((b) => ({ value: b.id, label: b.name }))}
        />
        <TextInput label="Part number" value={d.partNumber} maxLength={60} onChange={(e) => onChange({ ...d, partNumber: e.currentTarget.value })} />
        <Group grow gap="xs">
          <TextInput
            label="HSN code"
            placeholder="85177900"
            value={d.hsnCode}
            error={d.hsnCode && !/^(\d{4}|\d{6}|\d{8})$/.test(d.hsnCode) ? '4, 6 or 8 digits' : undefined}
            onChange={(e) => onChange({ ...d, hsnCode: e.currentTarget.value.replace(/\D/g, '').slice(0, 8) })}
          />
          <Select
            label="GST"
            value={String(d.gstRateBps)}
            onChange={(v) => onChange({ ...d, gstRateBps: Number(v ?? 1800) })}
            data={GST_RATES.map((r) => ({ value: String(r), label: `${r / 100}%` }))}
            allowDeselect={false}
          />
        </Group>
      </SimpleGrid>
      <Textarea
        label="Description"
        description="Compatible models, quality grade, warranty. Retailers see this on the product page."
        autosize
        minRows={2}
        maxRows={8}
        maxLength={5000}
        value={d.description}
        onChange={(e) => onChange({ ...d, description: e.currentTarget.value })}
      />
    </Stack>
  );
}

function VariantFields({ value: v, onChange, withActive }: { value: VariantForm; onChange: (v: VariantForm) => void; withActive?: boolean }) {
  return (
    <Stack gap="xs">
      <SimpleGrid cols={2}>
        <TextInput label="Variant" placeholder="Black, With frame, Pack of 10…" value={v.name} maxLength={80} onChange={(e) => onChange({ ...v, name: e.currentTarget.value })} />
        <TextInput label="SKU (optional)" value={v.sku} maxLength={60} onChange={(e) => onChange({ ...v, sku: e.currentTarget.value })} />
      </SimpleGrid>
      <SimpleGrid cols={3}>
        <RupeeInput label="MRP" paise={v.mrpPaise} onPaise={(mrpPaise) => onChange({ ...v, mrpPaise })} />
        <RupeeInput
          label="Retailer price"
          paise={v.pricePaise}
          onPaise={(pricePaise) => onChange({ ...v, pricePaise })}
          error={v.mrpPaise && v.pricePaise && v.pricePaise > v.mrpPaise ? 'Above MRP' : undefined}
        />
        <NumberInput label="Minimum order" min={1} allowDecimal={false} value={v.minOrderQty} onChange={(n) => onChange({ ...v, minOrderQty: Math.max(1, Number(n) || 1) })} />
      </SimpleGrid>
      <Text size="xs" fw={600} c="dimmed">
        Bulk prices (optional)
      </Text>
      {v.slabs.map((s, i) => (
        <Group key={i} gap="xs" align="flex-end">
          <NumberInput
            size="xs"
            label={i === 0 ? 'From quantity' : undefined}
            min={2}
            allowDecimal={false}
            value={s.minQty ?? ''}
            onChange={(n) => onChange({ ...v, slabs: v.slabs.map((x, j) => (j === i ? { ...x, minQty: n === '' ? null : Number(n) } : x)) })}
            w={120}
          />
          <RupeeInput
            size="xs"
            label={i === 0 ? 'Price each' : undefined}
            paise={s.pricePaise}
            onPaise={(pricePaise) => onChange({ ...v, slabs: v.slabs.map((x, j) => (j === i ? { ...x, pricePaise } : x)) })}
            w={140}
          />
          <CloseButton aria-label="Remove bulk price" onClick={() => onChange({ ...v, slabs: v.slabs.filter((_, j) => j !== i) })} />
        </Group>
      ))}
      <Group justify="space-between">
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconPlus size={12} />}
          disabled={v.slabs.length >= 5}
          onClick={() => onChange({ ...v, slabs: [...v.slabs, { minQty: null, pricePaise: null }] })}
        >
          Add bulk price
        </Button>
        {withActive && <Switch label="Available to order" checked={v.isActive} onChange={(e) => onChange({ ...v, isActive: e.currentTarget.checked })} />}
      </Group>
    </Stack>
  );
}
