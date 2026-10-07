// Shared receipt image helpers; ingestion runs in discordExpensePoll.js.
const convertHeic = require('heic-convert');
function isHeicAttachment(att) {
  if (!att) return false;
  const ct = String(att.contentType || '').toLowerCase();
  if (ct.includes('heic') || ct.includes('heif')) return true;
  const name = String(att.name || '').toLowerCase();
  return /\.(heic|heif)$/i.test(name);
}

function isHeicBuffer(contentType, buffer) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('heic') || ct.includes('heif')) return true;
  if (!buffer || buffer.length < 12) return false;
  const brand = buffer.slice(8, 12).toString('ascii');
  return /^(heic|heix|hevc|hevx|mif1|msf1)$/i.test(brand);
}

function isImageAttachment(att) {
  if (!att) return false;
  const ct = String(att.contentType || '').toLowerCase();
  if (ct.startsWith('image/')) return true;
  const name = String(att.name || '').toLowerCase();
  return /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(name);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${Math.round(ms / 1000)}s`);
      err.staffFacing = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Run work with AbortSignal; abort on timeout so Gemini fetch stops.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} factory
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
async function withTimeoutAndAbort(factory, ms, label) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await new Promise((resolve, reject) => {
      const onAbort = () => {
        const err = new Error(`${label} timed out after ${Math.round(ms / 1000)}s`);
        err.staffFacing = true;
        reject(err);
      };
      if (ac.signal.aborted) {
        onAbort();
        return;
      }
      ac.signal.addEventListener('abort', onAbort, { once: true });
      factory(ac.signal).then(
        (v) => {
          ac.signal.removeEventListener('abort', onAbort);
          resolve(v);
        },
        (err) => {
          ac.signal.removeEventListener('abort', onAbort);
          if (ac.signal.aborted) {
            onAbort();
            return;
          }
          reject(err);
        }
      );
    });
  } finally {
    clearTimeout(timer);
  }
}

async function convertHeicToJpeg(buffer) {
  const out = await convertHeic({
    buffer,
    format: 'JPEG',
    quality: 0.9
  });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

function pickFirstImage(message) {
  const att = message?.attachments;
  if (!att) return null;
  let list = [];
  if (typeof att.map === 'function') {
    list = att.map((a) => a);
  } else if (typeof att.values === 'function') {
    list = [...att.values()];
  } else if (Array.isArray(att)) {
    list = att;
  }
  return list.find(isImageAttachment) || null;
}

async function downloadAttachment(url, signal) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(parsed.hostname)) {
    throw new Error('Unexpected receipt attachment host');
  }
  const timeout = AbortSignal.timeout(30_000);
  const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error' });
  if (!res.ok) {
    throw new Error(`Failed to download attachment (${res.status})`);
  }
  const maxBytes = 20 * 1024 * 1024;
  if (Number(res.headers.get('content-length')) > maxBytes) {
    await res.body?.cancel();
    throw Object.assign(new Error('Receipt photo is too large; please use an image under 20 MB.'), { needsReview: true });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Receipt photo exceeds 20 MB.'), { needsReview: true });
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { buffer: buf, contentType };
}

function formatPeso(n) {
  const v = Number(n) || 0;
  return `₱${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ackContent(defaults, queuePos) {
  const label = defaults.label || 'General';
  if (queuePos > 1) {
    return `Queued #${queuePos} for **${label}** — will start after the current receipt`;
  }
  return `Got it — processing for **${label}**…`;
}


module.exports = { isImageAttachment, isHeicAttachment, isHeicBuffer, convertHeicToJpeg, pickFirstImage, downloadAttachment, formatPeso, withTimeout, withTimeoutAndAbort, ackContent };

