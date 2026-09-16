import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = 'matchanese-attendance';
const API_KEY = 'AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE';
const EVENT_NAME = 'Pasay - SEPT 5';
const EVENT_KEY = 'package-pasay-sept-5';
const menu = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'pasay_sept_5_menu.json'), 'utf8')
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

const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const listRes = await fetch(`${base}/branches?key=${API_KEY}&pageSize=300`);
if (!listRes.ok) throw new Error(`List failed: ${listRes.status} ${await listRes.text()}`);
const listData = await listRes.json();

let existing = null;
for (const d of listData.documents || []) {
  const fields = {};
  for (const [k, v] of Object.entries(d.fields || {})) fields[k] = fromFirestore(v);
  if (fields.key === EVENT_KEY) {
    existing = { name: d.name, fields };
    break;
  }
}

const payload = {
  key: EVENT_KEY,
  name: EVENT_NAME,
  type: 'popup',
  serviceType: 'package',
  archived: false,
  status: 'active',
  customMenu: menu,
  createdBy: 'pasay-sept-5-setup',
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

console.log(`Menu categories: ${menu.categories.length}, items: ${menu.items.length}`);
