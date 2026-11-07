'use client';

/**
 * Photo uploads straight to Vercel Blob. The API only issues a short-lived
 * token (see server/src/modules/uploads); the file never passes through it.
 */
import { upload } from '@vercel/blob/client';
import { API_URL, tokenStore } from './api/client';

/** Crops to the event cover shape (1200×630, centred) and re-encodes as JPEG, so uploads are small and consistent. */
export async function cropToCover(file: File, width = 1200, height = 630): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image'))), 'image/jpeg', 0.85)
  );
}

/** Uploads a cover photo and returns its public URL. */
export async function uploadCover(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP image');
  const cropped = await cropToCover(file);
  const token = tokenStore.get();
  const result = await upload(`covers/${Date.now()}.jpg`, cropped, {
    access: 'public',
    contentType: 'image/jpeg',
    handleUploadUrl: `${API_URL}/api/uploads`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return result.url;
}
