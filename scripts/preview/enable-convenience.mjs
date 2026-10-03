// Shared public demo convenience (Hamza, 2026-10-03; ADR 0004 addendum). Writes the 0600,
// git-ignored convenience file the gate reads at start: the gate password to prefill and
// the synthetic demo sign-ins to serve (only behind the gate) for one-click role sign-in.
//   printf '%s' "<gate password>" | node scripts/preview/enable-convenience.mjs
//   node scripts/preview/enable-convenience.mjs --off       # remove it (back to a real gate)
// The gate password comes from stdin and must match the stored hash. Nothing is printed.
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './paths.mjs';
import { loadSecret, verifyPassword } from './gate-server.mjs';

const REPO = join(import.meta.dirname, '../..');
const STATE = stateDir();
const FILE = join(STATE, 'convenience.json');

if (process.argv.includes('--off')) {
  rmSync(FILE, { force: true });
  console.log('Convenience file removed; restart the preview for a password-only gate.');
  process.exit(0);
}

const gatePrefill = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (!(await verifyPassword(gatePrefill, loadSecret(join(STATE, 'gate-secret.json'))))) {
  console.error('That is not the current gate password (compare with access.txt); nothing written.');
  process.exit(2);
}
const access = readFileSync(join(STATE, 'access.txt'), 'utf8');
const demoAccounts = [];
for (const [label, role] of [['Tester', 'tester'], ['Builder', 'builder'], ['Admin', 'admin']]) {
  const m = access.match(new RegExp(`^${label}:\\s+(\\S+)\\s+/\\s+(\\S+)$`, 'm'));
  if (!m || m[1] !== `demo-${role}@pocketqa.example`) {
    console.error(`access.txt has no seeded synthetic ${role} account; run seed-demo first. Nothing written.`);
    process.exit(2);
  }
  demoAccounts.push({ role, email: m[1], password: m[2] });
}
if (!existsSync(STATE)) process.exit(2);
writeFileSync(FILE, `${JSON.stringify({ gatePrefill, demoAccounts }, null, 2)}\n`, { mode: 0o600 });
chmodSync(FILE, 0o600);
console.log(`Convenience file written (${FILE.slice(REPO.length + 1)}, mode 0600): gate prefill + ${demoAccounts.length} synthetic demo sign-ins. Restart the preview to apply.`);
