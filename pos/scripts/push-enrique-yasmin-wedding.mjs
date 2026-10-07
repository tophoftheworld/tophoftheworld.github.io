import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = 'matchanese-attendance';
const API_KEY = 'AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE';
const EVENT_KEY = 'service-kyle-tan';
const EVENT_NAME = 'Enrique and Yasmin Wedding';
const menu = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'enrique_yasmin_wedding_menu.json'), 'utf8')
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

function docFields(d) {
  const fields = {};
  for (const [k, v] of Object.entries(d.fields || {})) fields[k] = fromFirestore(v);
  return fields;
}

function matchesWedding(fields) {
  const key = String(fields.key || '').toLowerCase();
  const name = String(fields.name || fields.title || '').toLowerCase();
  if (key === EVENT_KEY) return true;
  return name.includes('enrique') && name.includes('yasmin') && fields.archived !== true;
}

async function listAll(col) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  const docs = [];
  let pageToken = '';
  do {
    const url = `${base}/${col}?key=${API_KEY}&pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${col} list failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    for (const d of data.documents || []) {
      docs.push({ name: d.name, id: d.name.split('/').pop(), fields: docFields(d) });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

const [branches, events] = await Promise.all([listAll('branches'), listAll('opsEvents')]);
const existingBranch = branches.find(
  (d) => matchesWedding(d.fields) && d.fields.archived !== true
);
const existingEvent = events.find(
  (d) => matchesWedding(d.fields) && d.fields.status !== 'cancelled'
);

if (!existingBranch) {
  throw new Error(
    `Existing Enrique and Yasmin Wedding branch (${EVENT_KEY}) was not found. Refusing to create a duplicate.`
  );
}

const payload = {
  name: EVENT_NAME,
  serviceType: 'package',
  archived: false,
  status: 'active',
  customMenu: menu,
  lastModified: new Date().toISOString()
};
if (existingEvent && !existingBranch.fields.opsEventId) {
  payload.opsEventId = existingEvent.id;
}

const fields = {};
for (const [k, v] of Object.entries(payload)) fields[k] = toFirestore(v);

const mask = Object.keys(payload)
  .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
  .join('&');
const patchUrl = `https://firestore.googleapis.com/v1/${existingBranch.name}?key=${API_KEY}&${mask}`;
const res = await fetch(patchUrl, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields })
});
if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`);

console.log(
  'UPDATED',
  EVENT_NAME,
  existingBranch.fields.key || EVENT_KEY,
  existingBranch.name
);
if (existingEvent) {
  console.log(
    'LINKED opsEvent',
    existingEvent.fields.title || EVENT_NAME,
    existingEvent.id,
    existingEvent.fields.status || '',
    existingEvent.fields.venue || existingEvent.fields.location || ''
  );
} else {
  console.log('No matching opsEvents row found; POS branch menu was still updated.');
}
console.log(`Menu categories: ${menu.categories.length}, items: ${menu.items.length}`);
