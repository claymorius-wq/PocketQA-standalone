import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { buildSiwsMessage, type SiwsInput } from '@pocket-qa/contracts';
import { installDevnetWallet } from './devnetWallet';
import { BACKEND, call, CRON, landed, ORIGIN, ORIGIN_HOST, routeLocalDevnet, walletSend } from './localDevnet';
import { encodeV0, systemTransferIx } from '../test-support/devnetTx';

// The devnet pilot journey in a browser, LOCAL (see localDevnet.ts): the builder funds the escrow
// with the test wallet, votes on the tester's reward, then on the refund at close. Setup steps
// (accounts, wallet links, the tester's work, the settle jobs) go through the API; the three
// wallet signatures and their review cards go through the UI. Needs the emulators and a web export:
//   PQA_WEB_DIR=<export dir> firebase emulators:exec --only firestore,auth --project demo-pocketqa \
//     --config firebase.emu-be1.json 'pnpm --filter @pocket-qa/mobile exec playwright test -c playwright.devnet.config.ts journey'
const WEB_DIR = process.env.PQA_WEB_DIR ?? '';
const EVIDENCE = process.env.PQA_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'devnet-journey');
const BUILDER_EMAIL = 'devnet-journey-builder@example.test';
const TESTER_EMAIL = 'devnet-journey-tester@example.test';
const PASSWORD = 'correct horse battery staple'; // emulator-only synthetic account
const REWARD = 1_000_000;

test.skip(!process.env.FIRESTORE_EMULATOR_HOST || !WEB_DIR, 'LOCAL journey: run under firebase emulators:exec with PQA_WEB_DIR set');
test.describe.configure({ mode: 'serial' });

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '';
const builderSk = ed25519.utils.randomSecretKey();
const testerSk = ed25519.utils.randomSecretKey();
const addr = (sk: Uint8Array) => base58.encode(ed25519.getPublicKey(sk));
const tokens: Record<'builder' | 'tester', string> = { builder: '', tester: '' };
let studyId = '';
let participationId = '';

async function rest(path: string, body: unknown, admin = false) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/${path}?key=emulator-key`, { method: 'POST', headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer owner' } : {}) }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as Record<string, string>;
}
async function account(email: string, role: 'builder' | 'tester', sk: Uint8Array) {
  const up = await rest('accounts:signUp', { email, password: PASSWORD, returnSecureToken: true });
  // The Auth emulator's admin path (`Bearer owner`, emulator-only) marks the email verified.
  await rest('projects/demo-pocketqa/accounts:update', { localId: up.localId, emailVerified: true }, true);
  const token = (await rest('accounts:signInWithPassword', { email, password: PASSWORD, returnSecureToken: true })).idToken!;
  expect((await call('POST', '/auth/identity/session', token, { newAccount: { role, displayName: `Devnet journey ${role}` } })).status).toBe(200);
  const { input } = (await call('POST', '/wallet/nonce', token, { address: addr(sk) })).body as { input: SiwsInput };
  const bytes = new TextEncoder().encode(buildSiwsMessage(input));
  const linked = await call('POST', '/wallet/link', token, { address: input.address, nonce: input.nonce, signedMessage: Buffer.from(bytes).toString('base64'), signature: Buffer.from(ed25519.sign(bytes, sk)).toString('base64') });
  expect(linked.status, JSON.stringify(linked.body)).toBe(200);
  return token;
}
async function settleUntil(done: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 20; i++) {
    if (await done()) return;
    await call('GET', '/jobs/settle', CRON);
  }
  throw new Error(`not reached: ${what}`);
}
async function reviewUntil(page: Page, id: string, judged: () => Promise<boolean>) {
  for (let i = 0; i < 15; i++) {
    if (await page.getByTestId(`${id}-review`).isVisible()) await page.getByTestId(`${id}-review`).click();
    await page.waitForTimeout(700);
    if (await judged()) return;
    await call('GET', '/jobs/settle', CRON);
  }
  throw new Error(`${id}: the plan was never judged`);
}
const shot = (page: Page, name: string) => page.screenshot({ path: join(EVIDENCE, `${name}.png`), fullPage: true });
/** The signing card itself (the app scrolls inside a container, so a page shot can cut it off). */
async function shotCard(page: Page, id: string, name: string) {
  const card = page.getByTestId(id);
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: join(EVIDENCE, `${name}.png`) });
}

async function builderPage(page: Page, blocked: string[]) {
  const wallet = await installDevnetWallet(page, { secretKey: builderSk, originHost: ORIGIN_HOST, send: walletSend });
  await routeLocalDevnet(page, WEB_DIR, AUTH, blocked);
  await page.addInitScript(() => localStorage.setItem('pocketqa.introSeen', '1'));
  await page.goto(`${ORIGIN}/sign-in`);
  await page.getByTestId('sign-in-email').fill(BUILDER_EMAIL);
  await page.getByTestId('sign-in-password').fill(PASSWORD);
  await page.getByTestId('sign-in-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 45_000 });
  return wallet;
}

test.beforeAll(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  expect((await fetch(`${BACKEND}/__harness/health`)).ok).toBe(true);
  tokens.builder = await account(BUILDER_EMAIL, 'builder', builderSk);
  tokens.tester = await account(TESTER_EMAIL, 'tester', testerSk);
  const s = await call('POST', '/studies', tokens.builder, {
    title: 'Devnet journey study',
    objective: 'Check the devnet pilot end to end with test USDC (no value).',
    tasks: [{ instruction: 'Open the app and reach the home screen' }, { instruction: 'Change the theme to dark' }],
    deviceCriteria: { platforms: ['android', 'web'], minAndroidApi: 29, languages: ['en'] },
    slots: 2,
    consentText: 'I agree to record my screen only while doing these tasks, and to review clips before upload.',
    payment: { mode: 'escrow', rewardUnits: REWARD },
  });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  studyId = s.body!.id;
});

test('1 · funding: a tampered plan is refused in the browser; the real transfer is reviewed, signed in the wallet and verified', async ({ page }) => {
  const blocked: string[] = [];
  const wallet = await builderPage(page, blocked);
  await page.goto(`${ORIGIN}/builder/study/${studyId}`);
  await page.getByTestId('escrow-fund').click();
  await expect(page.getByTestId('escrow-pilot-request')).toBeVisible();

  // Negative first: the server's plan swapped for a System transfer (QA P2-CS1 repro) → refused, nothing signed.
  await page.route(`${ORIGIN}/api/escrow/fundings/*/transaction`, async (route) => {
    const real = await fetch(`${BACKEND}${new URL(route.request().url()).pathname.slice(4)}`, { headers: { authorization: route.request().headers().authorization ?? '' } });
    if (real.status !== 200) return route.fulfill({ status: real.status, body: Buffer.from(await real.arrayBuffer()), headers: { 'content-type': 'application/json' } });
    const plan = (await real.json()) as Record<string, unknown>;
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...plan, transactionB64: encodeV0([systemTransferIx()], addr(builderSk)) }) });
  });
  // The vault may still be being created ("Try again in a few seconds"): retry until the plan is judged.
  await reviewUntil(page, 'escrow-wallet', async () => /Nothing was signed/.test((await page.getByTestId('escrow-wallet-error').textContent().catch(() => null)) ?? ''));
  await expect(page.getByTestId('escrow-wallet-error')).toContainText('Nothing was signed');
  await expect(page.getByTestId('escrow-wallet-sign')).toHaveCount(0);
  await shotCard(page, 'escrow-pilot-request', '01-funding-tampered-refused');
  expect(wallet.log.filter((l) => l.kind === 'signAndSendTransaction')).toEqual([]);
  await page.unroute(`${ORIGIN}/api/escrow/fundings/*/transaction`);

  // The real plan: every row checked in the bytes, then the wallet signs and sends; the server verifies.
  await reviewUntil(page, 'escrow-wallet', () => page.getByTestId('escrow-wallet-plan').isVisible());
  const plan = page.getByTestId('escrow-wallet-plan');
  await expect(plan).toContainText('devnet test USDC');
  await expect(plan).toContainText(await page.getByTestId('escrow-pilot-vault').innerText());
  await expect(plan).toContainText(await page.getByTestId('escrow-pilot-reference').innerText());
  await expect(page.getByTestId('escrow-wallet-copy')).toContainText('Devnet test USDC, no value');
  await shotCard(page, 'escrow-pilot-request', '02-funding-plan-checked');
  await page.getByTestId('escrow-wallet-sign').click();
  for (let i = 0; i < 10 && !(await page.getByTestId('escrow-funded').isVisible()); i++) {
    if (await page.getByTestId('escrow-check').isVisible()) await page.getByTestId('escrow-check').click();
    await page.waitForTimeout(500);
  }
  await expect(page.getByTestId('escrow-funded')).toContainText('Funded on devnet');
  await shot(page, '03-funded');
  expect(wallet.log.filter((l) => l.kind === 'signAndSendTransaction').map((l) => l.programs)).toEqual([['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA']]);
  expect((await landed()).filter((l) => l === 'funding')).toHaveLength(1);
  expect(blocked.filter((u) => !u.startsWith('data:'))).toEqual([]);
});

test('2 · reward vote: the payment is read on devnet and checked; the builder signs; the platform completes the 2-of-3', async ({ page }) => {
  expect((await call('POST', `/studies/${studyId}/publish`, tokens.builder)).status).toBe(200);
  await call('PUT', '/me/device', tokens.tester, { platform: 'web', osVersion: 'Chromium', androidApiLevel: null, model: 'Desktop browser', languages: ['en-US'] });
  const p = await call('POST', `/studies/${studyId}/consent`, tokens.tester, { consentVersion: 1, accepted: true, payoutAddress: addr(testerSk) });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  participationId = p.body!.id;
  expect((await call('POST', `/participations/${participationId}/start`, tokens.tester)).status).toBe(200);
  expect((await call('POST', `/participations/${participationId}/submit`, tokens.tester)).status).toBe(200);
  expect((await call('POST', `/participations/${participationId}/approve`, tokens.builder, { note: 'Clear and complete.' })).status).toBe(200);
  const payout = async () => (await call('GET', `/participations/${participationId}`, tokens.builder)).body!.payout as { status: string } | null;
  await settleUntil(async () => (await payout())?.status === 'awaiting_approval', 'payout awaiting the builder');

  const blocked: string[] = [];
  const wallet = await builderPage(page, blocked);
  await page.goto(`${ORIGIN}/builder/review/${participationId}`);
  await page.getByTestId('reward-approval-review').click();
  const plan = page.getByTestId('reward-approval-plan');
  // CS3: the vault transaction read on (fake) devnet matches → amount, recipient and op id are CHECKED.
  await expect(plan).toContainText('1.00 devnet test USDC');
  await expect(plan).toContainText(addr(testerSk));
  await expect(page.getByTestId('reward-approval-described')).toHaveCount(0);
  await shotCard(page, 'reward-approval', '04-reward-vote-checked');
  await page.getByTestId('reward-approval-sign').click();
  await expect(page.getByTestId('reward-approval-review')).toHaveCount(0, { timeout: 20_000 });
  await settleUntil(async () => (await payout())?.status === 'confirmed', 'payout confirmed');
  await page.reload();
  await shot(page, '05-reward-confirmed');
  expect(wallet.log.filter((l) => l.kind === 'signAndSendTransaction').map((l) => l.programs)).toEqual([['SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf']]);
  expect(await landed()).toEqual(expect.arrayContaining(['cosigner_approve', 'approve_platform', 'execute']));
  expect(blocked.filter((u) => !u.startsWith('data:'))).toEqual([]);
});

test('3 · refund vote at close: reviewed against the study’s refund, signed, completed', async ({ page }) => {
  expect((await call('POST', `/studies/${studyId}/close`, tokens.builder)).status).toBe(200);
  const refund = async () => ((await call('GET', `/studies/${studyId}`, tokens.builder)).body!.payment as { refund: { status: string } | null }).refund;
  await settleUntil(async () => (await refund())?.status === 'awaiting_approval', 'refund awaiting the builder');

  const blocked: string[] = [];
  const wallet = await builderPage(page, blocked);
  await page.goto(`${ORIGIN}/builder/study/${studyId}`);
  await page.getByTestId('escrow-refund-approval-review').click();
  await expect(page.getByText(/Refund to the funding wallet · checked in this transaction/)).toBeVisible();
  await expect(page.getByTestId('escrow-refund-approval-plan')).toContainText(addr(builderSk));
  await shotCard(page, 'escrow-refund-approval', '06-refund-vote-checked');
  await page.getByTestId('escrow-refund-approval-sign').click();
  await expect(page.getByTestId('escrow-refund-approval-review')).toHaveCount(0, { timeout: 20_000 });
  await settleUntil(async () => (await refund())?.status === 'confirmed', 'refund confirmed');
  await page.reload();
  await expect(page.getByTestId('escrow-refund')).toContainText('finalized on devnet, no value');
  await shot(page, '07-refund-confirmed');
  expect(wallet.log.filter((l) => l.kind === 'signAndSendTransaction')).toHaveLength(1);
  expect(blocked.filter((u) => !u.startsWith('data:'))).toEqual([]);
});
