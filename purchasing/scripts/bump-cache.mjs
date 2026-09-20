import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const purchasingRoot = path.join(scriptDir, '..');
const jsRoot = path.join(purchasingRoot, 'js');
const adminHtml = path.join(purchasingRoot, 'admin.html');
const V = process.argv[2] || '23';

/** Specifier resolves to a file under purchasing/js (not inventory/expenses). */
function isPurchasingInternal(fromFile, specifier) {
  const bare = specifier.replace(/\?v=\d+$/, '');
  if (!bare.startsWith('./') && !bare.startsWith('../')) return false;
  const resolved = path.normalize(path.join(path.dirname(fromFile), bare));
  const jsRootNorm = path.normalize(jsRoot) + path.sep;
  return resolved.startsWith(jsRootNorm) || path.normalize(resolved) === path.normalize(jsRoot);
}

function walkJs(dir, onFile) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walkJs(p, onFile);
    else if (name.endsWith('.js')) onFile(p);
  }
}

function bumpJsImports() {
  walkJs(jsRoot, (filePath) => {
    const src = fs.readFileSync(filePath, 'utf8');
    const next = src.replace(
      /from '((?:\.\.\/|\.\/)[^']+\.js)(?:\?v=\d+)?'/g,
      (match, specifier) => {
        if (!isPurchasingInternal(filePath, specifier)) return match;
        return `from '${specifier}?v=${V}'`;
      }
    );
    if (next !== src) {
      fs.writeFileSync(filePath, next);
      console.log('updated', path.relative(jsRoot, filePath));
    }
  });
}

function bumpAdminHtml() {
  if (!fs.existsSync(adminHtml)) {
    console.warn('admin.html not found, skipped');
    return;
  }
  const src = fs.readFileSync(adminHtml, 'utf8');
  const next = src
    .replace(/(css\/style\.css)(?:\?v=\d+)?/g, `$1?v=${V}`)
    .replace(/(js\/app\.js)(?:\?v=\d+)?/g, `$1?v=${V}`);
  if (next !== src) {
    fs.writeFileSync(adminHtml, next);
    console.log('updated admin.html');
  }
}

/** Fail if purchasing-internal imports still use more than one ?v=. */
function assertUniformVersions() {
  const versions = new Set();
  const offenders = [];

  walkJs(jsRoot, (filePath) => {
    const src = fs.readFileSync(filePath, 'utf8');
    const re = /from '((?:\.\.\/|\.\/)[^']+\.js)(?:\?v=(\d+))?'/g;
    let m;
    while ((m = re.exec(src))) {
      const specifier = m[1];
      if (!isPurchasingInternal(filePath, specifier)) continue;
      const ver = m[2];
      if (ver == null) {
        offenders.push(`${path.relative(jsRoot, filePath)}: missing ?v= on ${specifier}`);
        continue;
      }
      versions.add(ver);
      if (ver !== V) {
        offenders.push(`${path.relative(jsRoot, filePath)}: ${specifier}?v=${ver} (want ${V})`);
      }
    }
  });

  if (versions.size > 1 || offenders.length) {
    console.error('Mixed or missing purchasing-internal cache versions:');
    for (const line of offenders.slice(0, 40)) console.error('  ', line);
    if (offenders.length > 40) console.error(`  …and ${offenders.length - 40} more`);
    process.exit(1);
  }
}

bumpJsImports();
bumpAdminHtml();
assertUniformVersions();
console.log(`cache bust v=${V}`);
