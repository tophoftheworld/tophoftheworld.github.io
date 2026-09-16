const PROJECT = 'matchanese-attendance';
const API_KEY = 'AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE';
const KEEP_KEY = 'popup-manila-matcha-fest-2026';
const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

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

async function patchArchived(docName, archived) {
  const mask = ['archived', 'lastModified']
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `https://firestore.googleapis.com/v1/${docName}?key=${API_KEY}&${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        archived: { booleanValue: archived },
        lastModified: { stringValue: new Date().toISOString() }
      }
    })
  });
  if (!res.ok) throw new Error(`Patch failed for ${docName}: ${res.status} ${await res.text()}`);
}

const listRes = await fetch(`${base}/branches?key=${API_KEY}&pageSize=300`);
if (!listRes.ok) throw new Error(`List failed: ${listRes.status} ${await listRes.text()}`);
const listData = await listRes.json();

let archivedCount = 0;
let kept = null;
const archivedNames = [];

for (const d of listData.documents || []) {
  const fields = {};
  for (const [k, v] of Object.entries(d.fields || {})) fields[k] = fromFirestore(v);
  const label = fields.name || fields.key || d.name.split('/').pop();

  if (fields.key === KEEP_KEY) {
    kept = label;
    if (fields.archived === true) await patchArchived(d.name, false);
    continue;
  }

  if (fields.archived === true) continue; // already archived, skip
  await patchArchived(d.name, true);
  archivedCount++;
  archivedNames.push(label);
}

console.log(`KEPT ACTIVE: ${kept || '(matcha fest event not found!)'}`);
console.log(`ARCHIVED ${archivedCount} event(s):`);
for (const n of archivedNames) console.log(`  - ${n}`);
