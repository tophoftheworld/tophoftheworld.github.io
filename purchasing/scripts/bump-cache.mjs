import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const jsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');
const V = process.argv[2] || '23';

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.js')) {
      const src = fs.readFileSync(p, 'utf8');
      const next = src.replace(
        /from '((?:\.\.\/|\.\/)[^']+\.js)(?:\?v=\d+)?'/g,
        `from '$1?v=${V}'`
      );
      if (next !== src) {
        fs.writeFileSync(p, next);
        console.log('updated', path.relative(jsRoot, p));
      }
    }
  }
}

walk(jsRoot);
console.log(`cache bust v=${V}`);
