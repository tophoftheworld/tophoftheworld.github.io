/** Resize an image blob for feed thumbnails (~3-col grid on phone). */
export async function createThumbnail(blob, maxSize = 480, quality = 0.82) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (thumb) => (thumb ? resolve(thumb) : reject(new Error('Could not create thumbnail'))),
      'image/jpeg',
      quality
    );
  });
}
