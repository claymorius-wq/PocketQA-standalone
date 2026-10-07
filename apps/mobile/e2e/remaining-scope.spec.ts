import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { buildSiwsMessage } from '@pocket-qa/contracts';
import { API } from './api';

// Remaining local scope: devnet transfer screen states, builder dispute view, admin
// stuck-submission resolution. Setup goes through the real local API; assertions are made
// in the browser UI. The chain is the loopback test double e2e/fake-devnet-rpc.mjs.
const RPC = 'http://127.0.0.1:8899';
const SHOTS = join(__dirname, '../../../docs/reviews/remaining-scope');
mkdirSync(SHOTS, { recursive: true });
const pw = 'correct horse battery staple';
let n = 0;
const run = Date.now().toString(36);

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function account(role: 'tester' | 'builder', name: string) {
  n += 1;
  const email = `${name.toLowerCase()}-${run}-${n}@example.test`;
  const r = await call('POST', '/auth/register', undefined, { email, password: pw, displayName: name, role });
  return { token: r.token as string, id: r.user.id as string, email };
}

async function linkWallet(token: string) {
  const sk = ed25519.utils.randomSecretKey();
  const address = base58.encode(ed25519.getPublicKey(sk));
  const { input } = await call('POST', '/wallet/nonce', token, { address });
  const bytes = new TextEncoder().encode(buildSiwsMessage(input));
  await call('POST', '/wallet/link', token, {
    address,
    nonce: input.nonce,
    signedMessage: Buffer.from(bytes).toString('base64'),
    signature: Buffer.from(ed25519.sign(bytes, sk)).toString('base64'),
  });
  return address;
}

/** Builder with a published study and one tester whose work is submitted. */
async function submittedWork(label: string) {
  const builder = await account('builder', `Builder${label}`);
  const tester = await account('tester', `Tester${label}`);
  await call('POST', '/me/credits/test-topup', builder.token, { amount: 1000 });
  const study = await call('POST', '/studies', builder.token, {
    title: `Study ${label} ${run}`,
    objective: 'See whether new users can finish the checkout flow.',
    tasks: [{ instruction: 'Buy the $5 item and reach the receipt screen' }],
    deviceCriteria: { platforms: ['web'], minAndroidApi: null, languages: [] },
    rewardCredits: 50,
    slots: 3,
    consentText: 'I agree to record my screen only while doing these tasks, and to review clips first.',
  });
  await call('POST', `/studies/${study.id}/publish`, builder.token);
  await call('PUT', '/me/device', tester.token, { platform: 'web', osVersion: 'x', androidApiLevel: null, model: 'Browser', languages: ['en'] });
  const p = await call('POST', `/studies/${study.id}/consent`, tester.token, { consentVersion: study.consentVersion, accepted: true });
  await call('POST', `/participations/${p.id}/start`, tester.token);
  await call('PUT', `/participations/${p.id}/tasks/${study.tasks[0].id}/note`, tester.token, { note: 'Checkout button was below the fold.' });
  await call('POST', `/participations/${p.id}/submit`, tester.token);
  return { builder, tester, study, participationId: p.id as string };
}

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(pw);
  await page.getByTestId('sign-in-submit').click();
}

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};

function chainTx(signature: string, sender: string, recipient: string, lamports: number) {
  return {
    slot: 1,
    blockTime: Math.floor(Date.now() / 1000),
    meta: { err: null },
    transaction: { signatures: [signature], message: { instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: sender, destination: recipient, lamports } } }] } },
  };
}
const setChainTx = (signature: string, tx: unknown) =>
  fetch(`${RPC}/__set`, { method: 'POST', body: JSON.stringify({ signature, tx }) });
const fakeSignature = () => base58.encode(ed25519.utils.randomSecretKey().slice(0, 32)).padEnd(64, '1') + base58.encode(ed25519.utils.randomSecretKey()).slice(0, 20);

test('devnet demo transfer: awaiting → pending → confirmed, and a mismatched transaction shows failed', async ({ browser }) => {
  const w = await submittedWork('T');
  await call('POST', `/participations/${w.participationId}/approve`, w.builder.token, {});
  const sender = await linkWallet(w.builder.token);
  const recipient = await linkWallet(w.tester.token);

  const b = await (await browser.newContext()).newPage();
  await signIn(b, w.builder.email);
  await expect(b.getByTestId('studies-screen')).toBeVisible();
  await b.goto(`/builder/review/${w.participationId}`);
  await expect(b.getByTestId('transfer-card')).toContainText('not a reward');
  await b.getByTestId('transfer-create').click();
  await expect(b.getByTestId('transfer-awaiting_signature')).toContainText('Awaiting signature'.toUpperCase());
  await expect(b.getByTestId('transfer-sign-unavailable')).toContainText('Android app');
  await shot(b, 'transfer-awaiting-signature-web');

  // The test plays the wallet: it reports a signature the (fake) chain doesn't know yet.
  const [intent] = (await call('GET', `/participations/${w.participationId}/devnet-transfers`, w.builder.token)).items;
  const sig = fakeSignature();
  await call('POST', `/devnet/transfers/${intent.id}/signature`, w.builder.token, { signature: sig });
  await expect(b.getByTestId('transfer-pending')).toContainText('not confirmed yet', { timeout: 15_000 });
  await expect(b.getByText('Confirmed on devnet')).toHaveCount(0);
  await shot(b, 'transfer-pending');

  // Now the chain shows exactly the expected transfer; the UI polls and flips to confirmed.
  await setChainTx(sig, chainTx(sig, sender, recipient, intent.lamports));
  await expect(b.getByTestId('transfer-confirmed')).toContainText('CONFIRMED ON DEVNET', { timeout: 15_000 });
  await expect(b.getByTestId('transfer-explorer')).toBeVisible();
  await shot(b, 'transfer-confirmed-builder');

  const t = await (await browser.newContext({ colorScheme: 'dark' })).newPage();
  await signIn(t, w.tester.email);
  await expect(t.getByTestId('discover-screen')).toBeVisible();
  await t.goto(`/participation/${w.participationId}`);
  await expect(t.getByTestId('transfer-confirmed')).toContainText('to your linked wallet');
  await expect(t.getByTestId('transfer-sign')).toHaveCount(0);
  await shot(t, 'transfer-confirmed-tester-dark');

  // A second approved participation whose reported transaction has the wrong amount.
  const w2 = await submittedWork('F');
  await call('POST', `/participations/${w2.participationId}/approve`, w2.builder.token, {});
  const s2 = await linkWallet(w2.builder.token);
  const r2 = await linkWallet(w2.tester.token);
  const i2 = await call('POST', '/devnet/transfers', w2.builder.token, { participationId: w2.participationId });
  const sig2 = fakeSignature();
  await setChainTx(sig2, chainTx(sig2, s2, r2, 5));
  await call('POST', `/devnet/transfers/${i2.id}/signature`, w2.builder.token, { signature: sig2 });
  const b2 = await (await browser.newContext()).newPage();
  await signIn(b2, w2.builder.email);
  await expect(b2.getByTestId('studies-screen')).toBeVisible();
  await b2.goto(`/builder/review/${w2.participationId}`);
  await expect(b2.getByTestId('transfer-failed')).toContainText('FAILED');
  await expect(b2.getByTestId('transfer-reason')).toContainText('expected sender, recipient and amount');
  await expect(b2.getByTestId('transfer-create')).toBeVisible(); // a failed intent can be retried
  await shot(b2, 'transfer-failed');
});

test('builder sees disputes on their own study, on the study page and the review page', async ({ browser }) => {
  const w = await submittedWork('D');
  await call('POST', `/participations/${w.participationId}/reject`, w.builder.token, { reason: 'The receipt screen was never reached.' });
  await call('POST', '/disputes', w.tester.token, { participationId: w.participationId, reason: 'My note explains the checkout button problem.' });
  const b = await (await browser.newContext()).newPage();
  await signIn(b, w.builder.email);
  await expect(b.getByTestId('studies-screen')).toBeVisible();
  await b.goto(`/builder/study/${w.study.id}`);
  await expect(b.getByTestId('study-dispute-open')).toContainText('checkout button problem');
  await shot(b, 'builder-study-disputes');
  await b.getByTestId('study-dispute-open').click();
  await expect(b.getByTestId('review-dispute')).toContainText('An admin will resolve it.');
  await shot(b, 'builder-review-dispute');
});

test('admin resolves a stuck submission (builder suspended) with an audited reason', async ({ browser }) => {
  const w = await submittedWork('S');
  const adminEmail = `admin-${run}@example.test`;
  execFileSync('pnpm', ['--filter', '@pocket-qa/api', 'admin:create', adminEmail], {
    input: `${pw}\n`,
    env: { ...process.env, POCKETQA_DATA_DIR: process.env.POCKETQA_E2E_DATA_DIR },
    cwd: join(__dirname, '../../..'),
  });
  const a = await (await browser.newContext()).newPage();
  await signIn(a, adminEmail);
  await expect(a.getByTestId('disputes-screen')).toBeVisible();
  const { token: adminToken } = await call('POST', '/auth/login', undefined, { email: adminEmail, password: pw });
  await call('POST', `/admin/moderation/users/${w.builder.id}`, adminToken, { action: 'suspend', reason: 'Builder stopped responding to testers' });

  await a.getByTestId('tab-stuck').click();
  const item = a.getByTestId('stuck-builder_inactive').filter({ hasText: `Study S ${run}` });
  await expect(item).toContainText('BUILDER SUSPENDED');
  await shot(a, 'admin-stuck-list');
  // Review r1 P3: the admin reads what was asked and the tester's notes before deciding.
  await item.getByTestId('stuck-review').click();
  await expect(item.getByTestId('stuck-work')).toContainText('Buy the $5 item and reach the receipt screen');
  await expect(item.getByTestId('stuck-note-0')).toContainText('Checkout button was below the fold.');
  await expect(item.getByTestId('stuck-no-evidence')).toBeVisible();
  await shot(a, 'admin-stuck-review-work');
  await item.getByTestId('stuck-approve').click();
  await a.getByTestId('stuck-reason').fill('ok');
  await expect(a.getByTestId('confirm-ok')).toBeDisabled();
  await a.getByTestId('stuck-reason').fill('Payout of $50 sent to you');
  await a.getByTestId('confirm-ok').click();
  await expect(a.getByTestId('stuck-error')).toContainText('promises earnings or payment');
  await a.getByTestId('stuck-reason').fill('Notes cover the task; the builder is suspended.');
  await a.getByTestId('confirm-ok').click();
  await expect(a.getByTestId('stuck-builder_inactive').filter({ hasText: `Study S ${run}` })).toHaveCount(0);
  await a.getByTestId('tab-audit').click();
  await expect(a.getByTestId('audit-entry').first()).toContainText('participation.approve');
  await expect(a.getByTestId('audit-entry').first()).toContainText('stuck: builder_inactive');
  await shot(a, 'admin-stuck-audit');

  const credits = await call('GET', '/me/credits', w.tester.token);
  expect(credits.balance).toBe(50);
});
