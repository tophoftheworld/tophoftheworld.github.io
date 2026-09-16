'use strict';

const { randomUUID } = require('crypto');
const sharp = require('sharp');
const admin = require('firebase-admin');

const THUMB_MAX_EDGE = 200;
const THUMB_WEBP_QUALITY = 72;
const THUMB_VERSION = 'v4';
const STORAGE_BUCKET = 'manila-matcha-fest.firebasestorage.app';

function isImageFile(file) {
  if (!file || typeof file !== 'object') return false;
  const haystack = `${file.type || ''} ${file.contentType || ''} ${file.name || ''} ${file.path || ''} ${file.url || ''}`.toLowerCase();
  if (/image\/svg|\.svg(?:$|[?#])/.test(haystack)) return false;
  return /image\//.test(haystack) || /\.(png|jpe?g|gif|webp|bmp)(?:$|[?#])/i.test(haystack);
}

function previewBgForPath(path = '') {
  const hay = String(path).toLowerCase();
  if (/\/logosquaredark\/|\/logowidedark\//.test(hay)) return 'dark';
  return 'light';
}

function thumbPathFor(originalPath, bg = 'light') {
  const parts = String(originalPath || '').split('/');
  const filename = parts.pop() || 'image';
  const base = filename.replace(/\.[^.]+$/, '') || 'image';
  return [...parts, 'thumbs', THUMB_VERSION, `${bg}-${base}.webp`].join('/');
}

function needsThumb(file) {
  if (!file?.path || !isImageFile(file)) return false;
  if (!file.thumbUrl || !file.thumbPath) return true;
  return !String(file.thumbPath).includes(`/thumbs/${THUMB_VERSION}/`);
}

function downloadUrlFor(bucketName, objectPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

async function createThumbForFile(bucket, file) {
  if (!needsThumb(file)) return file;

  const bg = previewBgForPath(file.path);
  const [buffer] = await bucket.file(file.path).download();
  // Keep alpha so admin CSS can show light/dark preview backgrounds behind PNGs.
  const thumbBuffer = await sharp(buffer)
    .rotate()
    .ensureAlpha()
    .resize({
      width: THUMB_MAX_EDGE,
      height: THUMB_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: THUMB_WEBP_QUALITY, alphaQuality: 90 })
    .toBuffer();

  const thumbPath = thumbPathFor(file.path, bg);
  const token = randomUUID();
  await bucket.file(thumbPath).save(thumbBuffer, {
    contentType: 'image/webp',
    metadata: {
      cacheControl: 'public,max-age=31536000',
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  return {
    ...file,
    thumbUrl: downloadUrlFor(bucket.name, thumbPath, token),
    thumbPath,
    thumbBg: bg,
  };
}

async function mapFilesDeep(files, mapper) {
  if (!files || typeof files !== 'object') {
    return { files, changed: false };
  }

  let changed = false;
  const next = { ...files };

  for (const [key, value] of Object.entries(files)) {
    if (Array.isArray(value)) {
      const mapped = [];
      for (const item of value) {
        const result = await mapper(item);
        if (result !== item) changed = true;
        mapped.push(result);
      }
      next[key] = mapped;
    } else if (value && typeof value === 'object') {
      const result = await mapper(value);
      if (result !== value) changed = true;
      next[key] = result;
    } else {
      next[key] = value;
    }
  }

  return { files: next, changed };
}

/**
 * Generate missing image thumbnails for a requirements document.
 * @returns {Promise<boolean>} whether the doc was updated
 */
async function ensureRequirementImageThumbs(docId, data, db, collectionName) {
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  const { files, changed } = await mapFilesDeep(data?.files, async (file) => {
    try {
      return await createThumbForFile(bucket, file);
    } catch (err) {
      console.error('[MMF Thumbs] failed for', file?.path || file?.name, err?.message || err);
      return file;
    }
  });

  if (!changed) return false;

  await db.collection(collectionName).doc(docId).update({ files });
  return true;
}

module.exports = {
  THUMB_MAX_EDGE,
  THUMB_VERSION,
  ensureRequirementImageThumbs,
  isImageFile,
  thumbPathFor,
  previewBgForPath,
  needsThumb,
};
