import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const orderedParts = [
  'components/data.jsx',
  'components/icons.jsx',
  'components/placeholder.jsx',
  'components/tabbar.jsx',
  'components/share-card.jsx',
  'components/screens-popups.jsx',
  'components/screens-map.jsx',
  'components/screens-brands.jsx',
  'components/screens-feed.jsx',
  'components/screens-lists.jsx',
  'components/screens-log.jsx',
  'components/screens-other.jsx',
  'components/screens-events.jsx',
  'components/screens-profile.jsx',
  'app-main.jsx',
];

const tmpSource = join(root, '.v2-app-source.jsx');
const outFile = join(root, 'app.bundle.js');

const combined = orderedParts
  .map((rel) => `\n// ---- ${rel} ----\n${readFileSync(join(root, rel), 'utf8')}\n`)
  .join('\n');

writeFileSync(tmpSource, combined, 'utf8');

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = [
  'esbuild',
  tmpSource,
  '--loader:.jsx=jsx',
  '--format=iife',
  '--target=es2018',
  '--minify',
  `--outfile=${outFile}`,
];

const result = spawnSync(npxCmd, args, {
  stdio: ['inherit', 'inherit', 'pipe'],
  cwd: root,
  shell: process.platform === 'win32',
});
if (result.stderr?.length) process.stderr.write(result.stderr);
rmSync(tmpSource, { force: true });

if (result.status !== 0) {
  if (result.error) console.error(result.error);
  process.exit(result.status || 1);
}

console.log('Built v2 app bundle:', outFile);
