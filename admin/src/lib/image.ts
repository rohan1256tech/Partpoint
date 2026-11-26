/**
 * Images are uploaded straight to storage as WebP ≤ 1 MB (the API refuses anything else).
 * Converting in the browser also strips EXIF metadata such as GPS location.
 */
export const MAX_UPLOAD_BYTES = 1024 * 1024;
export const MAX_DIMENSION = 1600;

/** Scales (w, h) to fit inside `max` × `max`, keeping the aspect ratio. Never upscales. */
export function fitWithin(w: number, h: number, max = MAX_DIMENSION): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export async function toWebp(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file');
  const bitmap = await createImageBitmap(file);
  let { width, height } = fitWithin(bitmap.width, bitmap.height);
  try {
    // Lower quality, then size, until it fits.
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image conversion is not supported in this browser');
      ctx.drawImage(bitmap, 0, 0, width, height);
      const quality = Math.max(0.5, 0.85 - attempt * 0.1);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
      if (blob.type !== 'image/webp') throw new Error('This browser cannot create WebP images');
      if (blob.size <= MAX_UPLOAD_BYTES) return blob;
      if (attempt >= 2) ({ width, height } = fitWithin(width, height, Math.round(Math.max(width, height) * 0.75)));
    }
    throw new Error('Could not make this image small enough; try a smaller one');
  } finally {
    bitmap.close();
  }
}
