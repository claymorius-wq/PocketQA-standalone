// Fails (exit 1) if any generated preview secret value occurs in the given directory tree:
// gate password, demo passwords, gate hash/salt/cookie key, from every preview state dir
// present (.preview/, .preview-test/*/). Prints counts only, never a value.
//   node assert-no-secrets.mjs <dir>     scan a directory tree (e.g. a web bundle)
//   node assert-no-secrets.mjs --repo    scan every committable repo file (part of pnpm verify)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '../..');
const target = process.argv[2];
const states = [join(REPO, '.preview')];
const test = join(REPO, '.preview-test');
if (existsSync(test)) for (const d of readdirSync(test)) states.push(join(test, d));

const values = new Set();
for (const dir of states) {
  const access = join(dir, 'access.txt');
  if (existsSync(access)) for (const m of readFileSync(access, 'utf8').matchAll(/(?:Gate password: |\/ {2})(\S{8,})/g)) values.add(m[1]);
  const secret = join(dir, 'gate-secret.json');
  if (existsSync(secret)) for (const k of ['hash', 'salt', 'cookieKey']) values.add(JSON.parse(readFileSync(secret, 'utf8'))[k]);
  const conv = join(dir, 'convenience.json');
  if (existsSync(conv)) {
    const c = JSON.parse(readFileSync(conv, 'utf8'));
    if (c.gatePrefill) values.add(c.gatePrefill);
    for (const a of c.demoAccounts ?? []) values.add(a.password);
  }
}
const files = [];
if (target === '--repo') {
  const listed = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: REPO, encoding: 'utf8' });
  for (const f of listed.split('\0').filter(Boolean)) if (existsSync(join(REPO, f))) files.push(join(REPO, f));
} else {
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  })(target);
}
let hits = 0;
for (const f of files) {
  const t = readFileSync(f, 'latin1');
  for (const v of values) if (v && t.includes(v)) hits += 1;
}
console.log(`secret check: ${values.size} values, ${files.length} files, ${hits} occurrences`);
process.exit(hits ? 1 : 0);
