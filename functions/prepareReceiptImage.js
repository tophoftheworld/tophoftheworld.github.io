/**
 * Downscale / recompress phone photos so Gemini OCR stays under the size cap.
 * Always returns JPEG for consistent OCR + Storage.
 */
const sharp = require('sharp');

/** Soft target after prepare (under extractExpenseReceipt ~4MB binary cap). */
const TARGET_BYTES = 2.5 * 1024 * 1024;
/** Only bother compressing when over this. */
const COMPRESS_IF_OVER = 1.5 * 1024 * 1024;
const MAX_EDGE_PX = 2000;

/**
 * @param {Buffer} buffer
 * @param {string} [mimeType]
 * @returns {Promise<{ buffer: Buffer, mimeType: string, didCompress: boolean }>}
 */
async function prepareReceiptImage(buffer, mimeType = 'image/jpeg') {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 32) {
    const err = new Error('Receipt image is missing or empty');
    err.staffFacing = true;
    throw err;
  }

  const needsWork =
    buffer.length > COMPRESS_IF_OVER ||
    !/^image\/jpe?g$/i.test(String(mimeType || ''));

  if (!needsWork) {
    return { buffer, mimeType: 'image/jpeg', didCompress: false };
  }

  let quality = 85;
  let out = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: MAX_EDGE_PX,
      height: MAX_EDGE_PX,
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  while (out.length > TARGET_BYTES && quality > 45) {
    quality -= 10;
    out = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({
        width: MAX_EDGE_PX,
        height: MAX_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  if (out.length > TARGET_BYTES * 1.5) {
    const err = new Error(
      'Receipt photo is still too large after compression — try a closer crop or lower-res photo.'
    );
    err.staffFacing = true;
    throw err;
  }

  return { buffer: out, mimeType: 'image/jpeg', didCompress: true };
}

module.exports = {
  prepareReceiptImage,
  TARGET_BYTES,
  COMPRESS_IF_OVER,
  MAX_EDGE_PX
};
