import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, isForbiddenPath } from './check-secrets.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-secrets.mjs');
// Fixtures are assembled at runtime so this file itself never contains a match.
const rep = (c, n) => c.repeat(n);
const fx = {
  github: 'ghp' + '_' + rep('a', 36),
  npm: 'npm' + '_' + rep('b', 36),
  aws: 'AKIA' + rep('Q', 16),
  slack: 'xox' + 'b-' + rep('1', 12),
  google: 'AIza' + rep('x', 35),
  sk: 'sk-' + 'ant-' + rep('k', 40),
  jwt: 'eyJ' + rep('h', 12) + '.eyJ' + rep('p', 12) + '.' + rep('s', 12),
  bearer: 'Bear' + 'er ' + rep('t', 30),
  pk: '-----BEGIN ' + 'PRIVATE KEY-----',
  base58: rep('5', 44) + rep('K', 44),
  keypair: '[' + Array.from({ length: 64 }, (_, i) => i).join(',') + ']',
  keypairPretty: '[\n' + Array.from({ length: 64 }, (_, i) => `  ${i}`).join(',\n') + '\n]',
};
const v = 'realpassw' + 'ord123';

test('flags known token shapes', () => {
  const cases = [
    [`t=${fx.github}`, 'github-token'],
    [`//r/:x ${fx.npm}`, 'npm-token'],
    [fx.aws, 'aws-access-key'],
    [fx.slack, 'slack-token'],
    [fx.google, 'google-api-key'],
    [fx.sk, 'anthropic-or-openai-key'],
    [fx.jwt, 'jwt'],
    [`h: "${fx.bearer}"`, 'bearer-literal'],
    [fx.pk, 'private-key-block'],
    [fx.base58, 'base58-secret-key'],
    [fx.keypair, 'solana-keypair-array'],
    [fx.keypairPretty, 'solana-keypair-array'],
  ];
  for (const [text, rule] of cases) assert.ok(scanText(text).some((h) => h.rule === rule), rule);
});

test('flags credential-named identifiers regardless of prefix or case', () => {
  for (const line of [
    `const dbPass` + `word = "${v}";`,
    `DB_PASS` + `WORD="${v}"`,
    `POCKETQA_AI_API_` + `KEY=${v}`,
    `export SOLANA_PRIVATE_` + `KEY=${v}`,
    `{"pass` + `word": "${v}"}`,
  ]) {
    assert.ok(scanText(line).length > 0, line);
  }
});

test('ignores ordinary code, empty env values and spaced passphrases', () => {
  assert.deepEqual(scanText('const password = req.body.password;'), []);
  assert.deepEqual(scanText('POCKETQA_AI_PROVIDER='), []);
  assert.deepEqual(scanText(`password: 'correct horse battery staple'`), []);
  assert.deepEqual(scanText('headers.authorization = `Bearer ${token}`'), []);
});

test('allow marker covers only its own line', () => {
  assert.deepEqual(scanText(`pass` + `word = "${v}" // check-secrets: allow`), []);
  const mixed = `// check-secrets: allow\n${fx.keypairPretty}`;
  assert.ok(scanText(mixed).some((h) => h.rule === 'solana-keypair-array'));
});

test('forbidden paths', () => {
  for (const p of ['.envrc', '.env.local', 'apps/api/.env_prod', 'x/my-keypair.json', 'a.sqlite', 'b.db-wal', 'apps/api/.data/m.mp4', 'k.p12', 'credentials.json', '.preview/access.txt', '.preview/gate-secret.json', 'preview-data/media/x.png', 'preview-data/.seeded', '.preview-test/state/convenience.json', '.cloud-local/firebase-web.json', '.cloud-local/service-account.json']) {
    assert.ok(isForbiddenPath(p), p);
  }
  assert.ok(!isForbiddenPath('.env.example'));
});

function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'pqa-secrets-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

test('CLI exits 1 on a planted secret and on a force-added sqlite file, 0 on a clean repo', () => {
  const bad = repoWith({ 'src/a.ts': `export const t = "${fx.github}";\n` });
  const db = repoWith({ 'data.sqlite': Buffer.from([0, 1, 2, 3]) });
  const clean = repoWith({ 'src/a.ts': 'export const ok = 1;\n' });
  try {
    const r1 = spawnSync(process.execPath, [SCRIPT], { cwd: bad, encoding: 'utf8' });
    assert.equal(r1.status, 1);
    assert.match(r1.stderr, /src\/a\.ts:1: github-token/);
    assert.ok(!r1.stderr.includes(fx.github), 'must not print the secret');
    const r2 = spawnSync(process.execPath, [SCRIPT], { cwd: db, encoding: 'utf8' });
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /data\.sqlite: forbidden-path/);
    const r3 = spawnSync(process.execPath, [SCRIPT], { cwd: clean, encoding: 'utf8' });
    assert.equal(r3.status, 0, r3.stderr);
  } finally {
    for (const d of [bad, db, clean]) rmSync(d, { recursive: true, force: true });
  }
});

test('CLI still runs when invoked through a symlink', () => {
  const bad = repoWith({ 'a.txt': fx.pk + '\n' });
  const link = join(bad, 'link-to-scanner.mjs');
  symlinkSync(SCRIPT, link);
  try {
    const r = spawnSync(process.execPath, [link], { cwd: bad, encoding: 'utf8' });
    assert.equal(r.status, 1, 'symlinked invocation must not silently pass');
  } finally {
    rmSync(bad, { recursive: true, force: true });
  }
});
