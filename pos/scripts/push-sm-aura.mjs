import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = 'matchanese-attendance';
const API_KEY = 'AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE';
const EVENT_NAME = 'SM Aura';
const EVENT_KEY = 'popup-sm-aura-2026';
const ARCHIVE_KEY_PREFIXES = [
  'popup-souk-trinoma-matcha-ube'
];
const menu = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'sm_aura_menu.json'), 'utf8')
);

function toFirestore(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestore) } };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) fields[k] = toFirestore(v);
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported type ${typeof value}`);
}

function fromFirestore(value) {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestore);
  if ('mapValue' in value) {
    const out = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) out[k] = fromFirestore(v);
    return out;
  }
  return null;
}

function shouldArchive(fields) {
  const key = String(fields.key || '');
  if (key === EVENT_KEY) return false;
  return ARCHIVE_KEY_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix + '-'));
}

const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const listRes = await fetch(`${base}/branches?key=${API_KEY}&pageSize=300`);
if (!listRes.ok) throw new Error(`List failed: ${listRes.status} ${await listRes.text()}`);
const listData = await listRes.json();

let existing = null;
const archivedNames = [];

async function patchArchived(docName) {
  const mask = ['archived', 'status', 'lastModified']
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `https://firestore.googleapis.com/v1/${docName}?key=${API_KEY}&${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        archived: { booleanValue: true },
        status: { stringValue: 'archived' },
        lastModified: { stringValue: new Date().toISOString() }
      }
    })
  });
  if (!res.ok) throw new Error(`Archive failed for ${docName}: ${res.status} ${await res.text()}`);
}

for (const d of listData.documents || []) {
  const fields = {};
  for (const [k, v] of Object.entries(d.fields || {})) fields[k] = fromFirestore(v);
  if (fields.key === EVENT_KEY) {
    existing = { name: d.name, fields };
    continue;
  }
  if (shouldArchive(fields) && fields.archived !== true) {
    await patchArchived(d.name);
    archivedNames.push(fields.name || fields.key || d.name.split('/').pop());
  }
}

const payload = {
  key: EVENT_KEY,
  name: EVENT_NAME,
  type: 'popup',
  serviceType: 'popup',
  archived: false,
  status: 'active',
  customMenu: menu,
  createdBy: 'sm-aura-setup',
  createdAt: existing?.fields?.createdAt || new Date().toISOString(),
  lastModified: new Date().toISOString()
};

const fields = {};
for (const [k, v] of Object.entries(payload)) fields[k] = toFirestore(v);

if (existing) {
  const mask = [
    'name', 'type', 'serviceType', 'archived', 'status', 'customMenu', 'lastModified'
  ].map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const patchUrl = `https://firestore.googleapis.com/v1/${existing.name}?key=${API_KEY}&${mask}`;
  const res = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`);
  console.log('UPDATED', EVENT_KEY, existing.name);
} else {
  const createRes = await fetch(`${base}/branches?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!createRes.ok) throw new Error(`Create failed: ${createRes.status} ${await createRes.text()}`);
  const created = await createRes.json();
  console.log('CREATED', EVENT_KEY, created.name);
}

if (archivedNames.length) {
  console.log(`ARCHIVED ${archivedNames.length} event(s):`);
  for (const n of archivedNames) console.log(`  - ${n}`);
} else {
  console.log('No active Souk Trinoma events to archive.');
}

console.log(`Menu categories: ${menu.categories.length}, items: ${menu.items.length}`);
