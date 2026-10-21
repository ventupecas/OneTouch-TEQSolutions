// Quick checks that need no data, no API key and no running containers.
//
//   npm run check
//
// 1. `node --check` on every tracked .mjs / .js file (syntax only, nothing runs)
// 2. `sh -n` on db/*.sh, and that they keep LF line endings
// 3. `docker compose config -q` with .env.example, if Docker is installed
//
// Exits non-zero if anything fails. Takes about a second.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const failures = [];
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') return null;
  if (r.status !== 0) failures.push(`${label}\n${(r.stderr || r.stdout).trim()}`);
  return r.status === 0;
}

const jsFiles = tracked.filter(f => /\.(mjs|js)$/.test(f));
for (const f of jsFiles) run(`node --check ${f}`, process.execPath, ['--check', f]);
console.log(`node --check: ${jsFiles.length} files`);

const shFiles = tracked.filter(f => /^db\/.*\.sh$/.test(f));
let shChecked = 0;
for (const f of shFiles) {
  if (readFileSync(f, 'utf8').includes('\r\n')) failures.push(`${f} has CRLF line endings (must be LF)`);
  if (run(`sh -n ${f}`, 'sh', ['-n', f]) !== null) shChecked++;
}
console.log(`shell scripts: ${shFiles.length} checked for LF, ${shChecked} for syntax${shChecked ? '' : ' (no sh found, skipped)'}`);

const compose = run('docker compose config', 'docker', ['compose', '--env-file', '.env.example', 'config', '-q']);
console.log(`docker compose config: ${compose === null ? 'skipped (no docker)' : compose ? 'ok' : 'failed'}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
