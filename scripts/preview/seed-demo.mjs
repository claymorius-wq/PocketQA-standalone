// Seeds the isolated preview database with synthetic demo data through the real preview
// API (never the dev or test databases), and appends the demo sign-ins to the 0600
// .preview/access.txt. It never prints a password.
//   PREVIEW_API_PORT=<port> node scripts/preview/seed-demo.mjs
// The admin is created with the API's own admin:create CLI (admins can't self-register).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '../..');
const ACCESS = join(REPO, '.preview', 'access.txt');
const MARKER = join(REPO, 'preview-data', '.seeded');
const DATA_DIR = join(REPO, 'preview-data');
const port = Number(process.env.PREVIEW_API_PORT);
if (!port) {
  console.error('Set PREVIEW_API_PORT to the preview API port.');
  process.exit(2);
}
if (!existsSync(ACCESS)) {
  console.error('Run scripts/preview/init-preview.mjs first.');
  process.exit(2);
}
if (existsSync(MARKER)) {
  console.log('Preview data is already seeded (preview-data/.seeded). Nothing to do.');
  process.exit(0);
}
const API = `http://127.0.0.1:${port}`;
const pw = () => `${randomBytes(18).toString('base64url')}`;

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.code ?? ''}`);
  return data;
}

const health = await call('GET', '/health');
if (!health.ok) throw new Error('preview API not healthy');

const accounts = {
  builder: { email: 'demo-builder@pocketqa.example', password: pw(), name: 'Demo Builder' },
  tester: { email: 'demo-tester@pocketqa.example', password: pw(), name: 'Demo Tester' },
  admin: { email: 'demo-admin@pocketqa.example', password: pw() },
};

const b = await call('POST', '/auth/register', null, { email: accounts.builder.email, password: accounts.builder.password, displayName: accounts.builder.name, role: 'builder' });
const t = await call('POST', '/auth/register', null, { email: accounts.tester.email, password: accounts.tester.password, displayName: accounts.tester.name, role: 'tester' });
await call('POST', '/me/credits/test-topup', b.token, { amount: 1000 });

const consentText = 'I agree to record my screen only while doing these tasks, and to review clips before upload.';
const checkout = await call('POST', '/studies', b.token, {
  title: 'Demo: checkout flow',
  objective: 'See whether new users can find the checkout button and reach the receipt screen.',
  tasks: [{ instruction: 'Add any item to the cart and open checkout' }, { instruction: 'Reach the receipt screen and note anything confusing' }],
  deviceCriteria: { platforms: ['android', 'web'], minAndroidApi: null, languages: [] },
  rewardCredits: 50,
  slots: 5,
  consentText,
});
await call('POST', `/studies/${checkout.id}/publish`, b.token);
const onboarding = await call('POST', '/studies', b.token, {
  title: 'Demo: onboarding screens',
  objective: 'Find where first-time users hesitate during sign-up.',
  tasks: [{ instruction: 'Create an account and reach the home screen' }],
  deviceCriteria: { platforms: ['android', 'web'], minAndroidApi: null, languages: [] },
  rewardCredits: 30,
  slots: 5,
  consentText,
});
await call('POST', `/studies/${onboarding.id}/publish`, b.token);

// One submitted session so the builder has something to review.
await call('PUT', '/me/device', t.token, { platform: 'web', osVersion: 'preview', androidApiLevel: null, model: 'Browser', languages: ['en'] });
const p = await call('POST', `/studies/${checkout.id}/consent`, t.token, { consentVersion: checkout.consentVersion, accepted: true });
await call('POST', `/participations/${p.id}/start`, t.token);
await call('PUT', `/participations/${p.id}/tasks/${checkout.tasks[0].id}/note`, t.token, { note: 'The checkout button was below the fold on a small screen.' });
await call('PUT', `/participations/${p.id}/tasks/${checkout.tasks[1].id}/note`, t.token, { note: 'The receipt screen did not say whether an email was sent.' });
await call('POST', `/participations/${p.id}/submit`, t.token);

execFileSync('pnpm', ['--filter', '@pocket-qa/api', 'admin:create', accounts.admin.email], {
  cwd: REPO,
  input: `${accounts.admin.password}\n`,
  env: { ...process.env, POCKETQA_DATA_DIR: DATA_DIR },
  stdio: ['pipe', 'ignore', 'inherit'],
});

appendFileSync(
  ACCESS,
  `
Demo accounts (synthetic preview data; test credits and devnet only, nothing has real value)
Tester:  ${accounts.tester.email}  /  ${accounts.tester.password}
Builder: ${accounts.builder.email}  /  ${accounts.builder.password}
Admin:   ${accounts.admin.email}  /  ${accounts.admin.password}
These demo accounts are shared: anything typed while signed in (study text, notes, reasons) is visible to other preview viewers.
`,
);
chmodSync(ACCESS, 0o600);
writeFileSync(MARKER, new Date().toISOString());
console.log('Seeded: 2 published demo studies, 1 submitted session, tester/builder/admin demo accounts. Sign-ins written to .preview/access.txt (0600); not shown here.');
