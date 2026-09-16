/**
 * One-time export of inventory master items + suppliers into purchasing/data/catalog.json
 * Run: node purchasing/scripts/export-catalog.mjs
 */
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'data', 'catalog.json');

const projectId = 'matchanese-attendance';
const apiKey = 'AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE';

function fetchCollection(collectionPath) {
  const all = [];
  let pageToken = '';

  return new Promise((resolve, reject) => {
    function next(token) {
      let url =
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionPath}?pageSize=300&key=${apiKey}`;
      if (token) url += `&pageToken=${encodeURIComponent(token)}`;

      https.get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              reject(new Error(json.error.message || JSON.stringify(json.error)));
              return;
            }
            if (json.documents) all.push(...json.documents);
            if (json.nextPageToken) next(json.nextPageToken);
            else resolve(all);
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    }
    next(pageToken);
  });
}

function parseValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) {
    return (v.arrayValue.values || []).map(parseValue);
  }
  if ('mapValue' in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) {
      out[k] = parseValue(val);
    }
    return out;
  }
  return null;
}

function parseDoc(doc) {
  const out = { id: doc.name.split('/').pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) {
    out[k] = parseValue(v);
  }
  return out;
}

const BRANCH_LABELS = {
  'sm-north': 'SM North',
  podium: 'Podium',
  moa: 'MOA',
};

async function main() {
  console.log('Fetching inventory/_config/items…');
  const itemDocs = await fetchCollection('inventory/_config/items');
  console.log(`  ${itemDocs.length} items`);

  console.log('Fetching suppliers…');
  const supplierDocs = await fetchCollection('suppliers');
  console.log(`  ${supplierDocs.length} suppliers`);

  const items = itemDocs
    .map(parseDoc)
    .filter((i) => i.name)
    .map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description || i.subtitle || '',
      category: i.category || 'Other',
      unit: i.unit || 'pcs',
      restockAmount: i.restockAmount || i.defaultRestockLevel || 0,
      enabledBranches: Array.isArray(i.enabledBranches) ? i.enabledBranches : ['sm-north', 'podium', 'moa'],
      displayOrder: i.displayOrder ?? 0,
      categoryOrder: i.categoryOrder ?? 0,
    }))
    .sort((a, b) => {
      if (a.categoryOrder !== b.categoryOrder) return a.categoryOrder - b.categoryOrder;
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.displayOrder - b.displayOrder || a.name.localeCompare(b.name);
    });

  const suppliers = supplierDocs
    .map(parseDoc)
    .filter((s) => s.name)
    .map((s) => ({
      id: s.id,
      name: s.name,
      businessName: s.businessName || s.business || '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const catalog = {
    exportedAt: new Date().toISOString(),
    branches: [
      { key: 'sm-north', label: BRANCH_LABELS['sm-north'] },
      { key: 'podium', label: BRANCH_LABELS.podium },
      { key: 'moa', label: BRANCH_LABELS.moa },
    ],
    items,
    suppliers,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
