import { Button, FileButton, Group, Image, Stack, Text } from '@mantine/core';
import { IconPhotoUp } from '@tabler/icons-react';
import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import type { PresignedUpload } from '../api/types';
import { toWebp } from '../lib/image';

interface Props {
  kind: 'categories' | 'brands' | 'banners';
  /** Current image URL, if any. */
  url: string | null;
  /** Called with the new object key once the image is stored. */
  onUploaded: (objectKey: string, previewUrl: string) => void;
}

/** Converts to WebP in the browser, then uploads straight to storage with a short-lived signed URL. */
export function ImageUpload({ kind, url, onUploaded }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(url);

  async function pick(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const webp = await toWebp(file);
      const { objectKey, upload } = await api.post<PresignedUpload>('/v1/admin/uploads', {
        kind,
        contentType: 'image/webp',
        sizeBytes: webp.size,
      });
      // content-length is set by the browser from the body; it matches the signed size.
      const { 'content-length': _len, ...headers } = upload.headers;
      const put = await fetch(upload.url, { method: 'PUT', headers, body: webp });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      const local = URL.createObjectURL(webp);
      setPreview(local);
      onUploaded(objectKey, local);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap={6}>
      <Group>
        {preview && <Image src={preview} w={72} h={72} radius="sm" fit="cover" alt="" />}
        <FileButton onChange={(f) => void pick(f)} accept="image/png,image/jpeg,image/webp">
          {(props) => (
            <Button {...props} variant="default" leftSection={<IconPhotoUp size={16} />} loading={busy}>
              {preview ? 'Replace image' : 'Upload image'}
            </Button>
          )}
        </FileButton>
      </Group>
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}
