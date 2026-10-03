// Generates the preview gate secret. Run once before the first start, or with --rotate to
// replace the password (this also signs out everyone, because the cookie key changes too).
//   node scripts/preview/init-preview.mjs [--rotate] [--password-stdin]
// --password-stdin takes the new gate password from stdin (never argv, never a committed
// file) instead of generating a random one. PREVIEW_STATE_DIR overrides `.preview/`.
// Writes, inside the repo but git-ignored:
//   .preview/                  (0700)
//   .preview/gate-secret.json  (0600) scrypt hash of the gate password + cookie HMAC key
//   .preview/access.txt        (0600) the gate password, for private delivery by the parent
// It never prints a secret.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './paths.mjs';
import { hashPassword } from './gate-server.mjs';

const REPO = join(import.meta.dirname, '../..');
const DIR = stateDir();
const SECRET = join(DIR, 'gate-secret.json');
const ACCESS = join(DIR, 'access.txt');
const host = process.env.PREVIEW_PUBLIC_HOST ?? 'pocketqa.optijara.ai';
const rotate = process.argv.includes('--rotate');

if (existsSync(SECRET) && !rotate) {
  console.log('Gate secret already exists. Use --rotate to replace it.');
  process.exit(0);
}

// Validate everything before creating or writing anything.
let phrase = randomBytes(24).toString('base64url');
if (process.argv.includes('--password-stdin')) {
  phrase = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  if (phrase.length < 8 || /\s/.test(phrase)) {
    console.error('The gate password from stdin must be at least 8 characters with no whitespace.');
    process.exit(2);
  }
}
mkdirSync(DIR, { recursive: true, mode: 0o700 });
chmodSync(DIR, 0o700);
const secret = { version: 1, ...hashPassword(phrase), cookieKey: randomBytes(32).toString('base64'), createdAt: new Date().toISOString() };
writeFileSync(SECRET, `${JSON.stringify(secret, null, 2)}\n`, { mode: 0o600 });
chmodSync(SECRET, 0o600);

const gateBlock = `Pocket QA protected preview
URL: https://${host}/
Gate password: ${phrase}
(The gate password unlocks the preview; then sign in with one of the demo accounts below.)
`;
let rest = '';
if (existsSync(ACCESS)) {
  const old = readFileSync(ACCESS, 'utf8');
  const i = old.indexOf('\nDemo accounts');
  rest = i >= 0 ? old.slice(i) : '';
}
writeFileSync(ACCESS, gateBlock + rest, { mode: 0o600 });
chmodSync(ACCESS, 0o600);
console.log(`Gate secret ${rotate ? 'rotated (all gate sessions invalidated)' : 'created'}. Password written to ${ACCESS.slice(REPO.length + 1)} (mode 0600); not shown here.`);
