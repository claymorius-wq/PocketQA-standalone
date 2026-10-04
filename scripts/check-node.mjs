// Fails fast when verify runs on a Node outside package.json `engines` (inc1 review P3-4):
// some fixtures are byte-exact per Node version, so a mismatch is an environment error.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const range = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).engines.node; // e.g. ">=24.3.0 <25"
const [maj, min, pat] = process.versions.node.split('.').map(Number);
const m = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(range);
if (!m) throw new Error(`unsupported engines.node format: ${range}`);
const [lo1, lo2, lo3, hi] = m.slice(1).map(Number);
const ok = maj < hi && (maj > lo1 || (maj === lo1 && (min > lo2 || (min === lo2 && pat >= lo3))));
if (!ok) {
  console.error(`Node ${process.versions.node} is outside engines.node "${range}". Use the pinned Node (e.g. nvm use 24) and rerun.`);
  process.exit(1);
}
