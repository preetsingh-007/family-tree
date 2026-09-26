/**
 * Prepares a user-selected photo for storage inside the encrypted tree.
 *
 * The image is decoded and re-encoded through a canvas. This bounds its size
 * and also discards embedded metadata such as EXIF GPS coordinates, camera
 * serial numbers, and timestamps.
 */
import { bytesToBase64 } from '../crypto/base64';
import { newId } from '../model/ids';
import type { MediaItem } from '../model/types';

export const MAX_IMAGE_DIMENSION = 1600;
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic'];

export class ImageError extends Error {}

export async function prepareImage(file: File): Promise<MediaItem> {
  if (!file.type.startsWith('image/') || (file.type && !ACCEPTED_TYPES.includes(file.type))) {
    throw new ImageError('Please choose a JPEG, PNG, WebP, GIF, or AVIF image.');
  }
  if (file.size > MAX_SOURCE_BYTES) throw new ImageError('This image is too large (over 40 MB).');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageError('This image could not be read. It may be damaged or in an unsupported format.');
  }
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ImageError('Your browser could not process this image.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new ImageError('Your browser could not process this image.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { id: newId(), mimeType: 'image/jpeg', data: bytesToBase64(bytes), width, height };
}

export function mediaDataUrl(media: MediaItem): string {
  return `data:${media.mimeType};base64,${media.data}`;
}
