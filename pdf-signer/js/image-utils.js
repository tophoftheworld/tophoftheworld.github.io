/** Strip light backgrounds so only ink strokes remain. */
export function makeSignatureTransparent(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data } = imageData;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a === 0) continue;

        const lightness = (r + g + b) / 3;
        if (lightness >= 235) {
          data[i + 3] = 0;
        } else if (lightness >= 200) {
          data[i + 3] = Math.round(a * (1 - (lightness - 200) / 35));
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(trimTransparentCanvas(canvas));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function trimTransparentCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  let top = height;
  let left = width;
  let right = 0;
  let bottom = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (right < left || bottom < top) return canvas.toDataURL('image/png');

  const pad = 8;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);

  const w = right - left + 1;
  const h = bottom - top + 1;
  const trimmed = document.createElement('canvas');
  trimmed.width = w;
  trimmed.height = h;
  trimmed.getContext('2d').drawImage(canvas, left, top, w, h, 0, 0, w, h);
  return trimmed.toDataURL('image/png');
}

export async function exportDrawnSignature(pad) {
  pad.backgroundColor = 'rgba(0, 0, 0, 0)';
  // SignaturePad v4 removed getTrimmedCanvas(); trim via makeSignatureTransparent.
  return makeSignatureTransparent(pad.toDataURL('image/png'));
}

export async function processSignatureDataUrl(dataUrl) {
  return makeSignatureTransparent(dataUrl);
}

const IMAGE_DOC_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

const IMAGE_DOC_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;

/** True for photo/image files that can be turned into a PDF page. */
export function isImageDocument(file) {
  if (!file) return false;
  if (file.type && IMAGE_DOC_TYPES.has(file.type.toLowerCase())) return true;
  return IMAGE_DOC_EXT.test(file.name || '');
}

export function isPdfDocument(file) {
  if (!file) return false;
  if (file.type === 'application/pdf') return true;
  return /\.pdf$/i.test(file.name || '');
}

/**
 * Convert a photo/image into a single-page PDF (US Letter max, aspect preserved).
 * Uses canvas so EXIF orientation and formats like WebP are handled.
 */
export async function imageFileToPdfBytes(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }

  try {
    // Cap pixel size for embed (~200 DPI on letter) to keep exports lean
    const maxPx = 2000;
    const srcScale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    const pxW = Math.max(1, Math.round(bitmap.width * srcScale));
    const pxH = Math.max(1, Math.round(bitmap.height * srcScale));

    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pxW, pxH);
    ctx.drawImage(bitmap, 0, 0, pxW, pxH);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode image'))),
        'image/jpeg',
        0.92
      );
    });

    const jpgBytes = new Uint8Array(await blob.arrayBuffer());
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.create();
    const image = await pdfDoc.embedJpg(jpgBytes);

    const maxW = 612;
    const maxH = 792;
    const scale = Math.min(maxW / image.width, maxH / image.height);
    const width = image.width * scale;
    const height = image.height * scale;

    const page = pdfDoc.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });

    return pdfDoc.save();
  } finally {
    bitmap.close();
  }
}
