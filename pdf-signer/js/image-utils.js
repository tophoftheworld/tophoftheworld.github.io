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
  const trimmed = pad.getTrimmedCanvas();
  return makeSignatureTransparent(trimmed.toDataURL('image/png'));
}

export async function processSignatureDataUrl(dataUrl) {
  return makeSignatureTransparent(dataUrl);
}
