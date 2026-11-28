import { Image, ThemeIcon } from '@mantine/core';
import { IconPhoto } from '@tabler/icons-react';

/** A small square image, or a neutral placeholder tile when there is none. */
export function Thumb({ src, size }: { src: string | null; size: number }) {
  return src ? (
    <Image src={src} w={size} h={size} radius="sm" fit="cover" alt="" />
  ) : (
    <ThemeIcon size={size} radius="sm" variant="light" color="gray" aria-hidden>
      <IconPhoto size={size * 0.55} stroke={1.5} />
    </ThemeIcon>
  );
}
