import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { DEVNET, installDevnetWallet, TEST_WALLET_NAME, type WalletLogEntry } from './devnetWallet';
import { devnetSend, loadFixtureSeed, recordEvidence, writeEvidence, type Evidence } from './hostedDevnet';

// The WEB devnet journey on the lead's loopback artifact (real Solana devnet, the Firestore devnet
// namespace, R2 devnet/). Everything a user does goes through the browser UI; the API is never
// called directly. The browser sees the deployment's public origin (= POCKETQA_PUBLIC_ORIGIN, so
// SIWS domains match), which Playwright routes to the loopback server. Firebase Auth, devnet RPC
// and R2 are the real services. Any mainnet request is aborted and the run fails on it.
// Wallet: "Pocket QA Test Wallet (devnet): injected by Playwright, not an extension": real ed25519
// signatures by the devnet fixtures, real devnet transactions. NOT a wallet-compatibility claim (the
// real extension / MWA stay a separate human/device row, QA G-W3). The Pixel 7 project is a
// "mobile viewport, NOT a physical-device wallet deep-link (MWA) test".
// Bounds (lead): ≤ 3 test USDC per run; the run stops on the first failure (inspect the chain before
// any retry). Starts only with PQA_HOSTED_GO=1 (the lead's GO: the settle job is global).
const ORIGIN = 'https://pocketqa-devnet.vercel.app';
const ORIGIN_HOST = 'pocketqa-devnet.vercel.app';
const LOOPBACK = process.env.PQA_ARTIFACT_URL ?? 'http://127.0.0.1:8697';
const RPC = 'https://api.devnet.solana.com';
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const REWARD = process.env.PQA_REWARD_USDC ?? '0.50';
const SLOTS = '2';
const EVIDENCE_ROOT = process.env.PQA_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'hosted-devnet');
/**
 * Lead decision B (2026-10-07): the synthetic tester is linked to a previous run's throwaway key
 * (`PQA_TESTER_PREVIOUS_LINK`). As the tester, through the product UI: Unlink it (the DELETE /wallet
 * status recorded; a refusal STOPS the run, never forced), then link the tester fixture via SIWS.
 */
const TESTER_PREVIOUS_LINK = process.env.PQA_TESTER_PREVIOUS_LINK ?? '';
/**
 * Resume mode (lead, 2026-10-07): segment 1 created and funded this study, then was stopped. Segment 2
 * starts from it: no study creation and NO new funding (the fund button is never pressed; it only
 * waits for "Funded on devnet"), and no link changes (a link other than the fixture stops the run).
 */
const RESUME_STUDY_ID = process.env.PQA_RESUME_STUDY_ID ?? '';
const RESUME_PREVIOUS_EVIDENCE = process.env.PQA_RESUME_PREVIOUS_EVIDENCE ?? '';
/** Resume the tester's existing participation (consented and started in an earlier segment): no second consent. */
const RESUME_PARTICIPATION_ID = process.env.PQA_RESUME_PARTICIPATION_ID ?? '';
/**
 * Option A (lead): another lane relinked the tester account. The run accepts exactly this address as
 * found (recorded verbatim, no change): the participation's reward address was frozen at consent and
 * the tester signs nothing in the remaining steps. Any other link still stops the run.
 */
const TESTER_ACCEPT_LINK = process.env.PQA_TESTER_ACCEPT_LINK ?? '';
if (RESUME_STUDY_ID && TESTER_PREVIOUS_LINK) throw new Error('resume mode never changes links: unset PQA_TESTER_PREVIOUS_LINK');
const SETTLE_WAIT_MS = Number(process.env.PQA_SETTLE_WAIT_MS ?? 15 * 60_000);

test.skip(process.env.PQA_HOSTED_GO !== '1', 'HOSTED devnet journey: only on the lead’s GO (PQA_HOSTED_GO=1)');
test.describe.configure({ mode: 'serial' });

/** E-28 synthetic accounts (0600 env files), read into this process only; never printed. */
function account(role: 'builder' | 'tester') {
  const raw = readFileSync(join(homedir(), '.config/pocketqa-e28', `${role}.env`), 'utf8');
  const get = (k: string) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]!.trim().replace(/^["']|["']$/g, '') ?? '';
  const prefix = role === 'builder' ? 'E28_BUILDER' : 'E28_TESTER';
  return { email: get(`${prefix}_EMAIL`), password: get(`${prefix}_PASSWORD`) };
}

/** Read-only devnet: SOL and test-USDC (pinned mint) of a wallet, finalized. */
async function balances(owner: string) {
  const rpc = async (method: string, params: unknown[]) => ((await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()) as { result: any }).result; // eslint-disable-line @typescript-eslint/no-explicit-any
  const sol = (await rpc('getBalance', [owner, { commitment: 'finalized' }]))?.value ?? 0;
  const t = await rpc('getTokenAccountsByOwner', [owner, { mint: MINT }, { encoding: 'jsonParsed', commitment: 'finalized' }]);
  const units = ((t?.value ?? []) as { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[]).reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.amount), 0);
  return { owner, lamports: sol as number, testUsdcUnits: units };
}

/** A synthetic PNG (a flat 64x64 swatch, no personal content) for the tester's evidence. */
function syntheticPng(file: string) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const w = 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: w }, () => Buffer.concat([Buffer.of(0), Buffer.alloc(w * 3, 0x5a)])));
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

type Party = { ctx: BrowserContext; page: Page; ev: Evidence; wallet: { address: string; log: WalletLogEntry[] }; rejectNext: Set<string> };
const run: { dir: string; label: string; title: string; steps: { step: string; at: string; shot: string; note?: string }[]; builder?: Party; tester?: Party; chain: Record<string, unknown>; blocked: string[]; studyUrl?: string; reviewUrl?: string } = { dir: '', label: '', title: '', steps: [], chain: {}, blocked: [] };

async function party(browser: Browser, info: TestInfo, role: 'builder' | 'tester'): Promise<Party> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = info.project.use;
  const ctx = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  const page = await ctx.newPage();
  const ev = recordEvidence(page);
  const fixture = loadFixtureSeed(role);
  const rejectNext = new Set<string>();
  const wallet = await installDevnetWallet(page, {
    secretKey: fixture.seed,
    originHost: ORIGIN_HOST,
    name: TEST_WALLET_NAME,
    send: devnetSend(RPC),
    // A planned "cancel in the wallet": the next request of that kind answers User rejected (4001).
    approve: (req) => !rejectNext.delete(req.kind),
  });
  // Any mainnet endpoint: aborted and recorded (the run fails on it).
  await page.route(/mainnet/i, (r) => {
    run.blocked.push(r.request().url().split('?')[0]!);
    return r.abort('blockedbyclient');
  });
  // The deployment's public origin → the loopback artifact (static app and /api alike).
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const headers = { ...req.headers() };
    delete headers['content-length'];
    const payload = req.postDataBuffer();
    const r = await fetch(`${LOOPBACK}${u.pathname}${u.search}`, { method: req.method(), headers, body: payload ? new Uint8Array(payload) : undefined, redirect: 'manual' });
    const out: Record<string, string> = {};
    r.headers.forEach((v, k) => {
      if (k !== 'content-length' && k !== 'transfer-encoding' && k !== 'content-encoding') out[k] = v;
    });
    return route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) });
  });
  await page.addInitScript(() => localStorage.setItem('pocketqa.introSeen', '1'));
  return { ctx, page, ev, wallet, rejectNext };
}

async function step(name: string, p: Page, note?: string) {
  const shot = join(run.dir, `${String(run.steps.length + 1).padStart(2, '0')}-${name}.png`);
  await p.screenshot({ path: shot, fullPage: true });
  run.steps.push({ step: name, at: new Date().toISOString(), shot, ...(note ? { note } : {}) });
}
async function shotOf(p: Page, testId: string, name: string, note?: string) {
  const el = p.getByTestId(testId).first();
  await el.scrollIntoViewIfNeeded();
  const shot = join(run.dir, `${String(run.steps.length + 1).padStart(2, '0')}-${name}.png`);
  await el.screenshot({ path: shot });
  run.steps.push({ step: name, at: new Date().toISOString(), shot, ...(note ? { note } : {}) });
}
/** Reloads until `ready()` (the settle job runs server-side; nothing here drives it). */
async function until(p: Page, what: string, ready: () => Promise<boolean>, ms = SETTLE_WAIT_MS) {
  const end = Date.now() + ms;
  for (;;) {
    // Poll for up to 10 s (the app needs time to restore the session and render after a load), then reload.
    for (let i = 0; i < 10; i++) {
      if (await ready().catch(() => false)) return;
      await p.waitForTimeout(1_000);
    }
    if (Date.now() > end) throw new Error(`stopped: ${what} not reached within ${Math.round(ms / 1000)} s`);
    await p.reload();
  }
}
async function signIn(p: Page, role: 'builder' | 'tester') {
  const a = account(role);
  await p.goto(`${ORIGIN}/sign-in`);
  await p.getByTestId('sign-in-email').fill(a.email);
  await p.getByTestId('sign-in-password').fill(a.password);
  await p.getByTestId('sign-in-submit').click();
  await p.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60_000 });
}
/** Links the fixture wallet in Settings; with cancelFirst, the wallet refuses once and the app must say so. */
async function linkWallet(pt: Party, settingsTab: string, cancelFirst: boolean, previousLink?: string, acceptLink?: string) {
  const p = pt.page;
  await p.getByTestId(settingsTab).click();
  await expect(p.getByTestId('wallet-section')).toBeVisible();
  if (await p.getByTestId('wallet-address').isVisible()) {
    const shown = await p.getByTestId('wallet-address').innerText();
    if (shown.includes(pt.wallet.address)) {
      await shotOf(p, 'wallet-section', `${settingsTab}-wallet-already-linked`, 'already linked to the fixture address before this run');
      return;
    }
    if (acceptLink && shown.includes(acceptLink)) {
      await shotOf(p, 'wallet-section', `${settingsTab}-wallet-linked-elsewhere-accepted`, `linked by another lane to ${acceptLink}; accepted as found, NO change (lead option A)`);
      return;
    }
    // Linked elsewhere: only the address the lead named may be unlinked, through the product's own action.
    if (!previousLink || !shown.includes(previousLink)) throw new Error(`stopped: linked to an unexpected wallet (${shown.trim()})`);
    await shotOf(p, 'wallet-section', `${settingsTab}-wallet-previous-link`, `previous link (verbatim): ${previousLink}`);
    const del = p.waitForResponse((r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname === '/api/wallet');
    await p.getByTestId('wallet-unlink').click();
    const status = (await del).status();
    run.steps.push({ step: `${settingsTab}-wallet-unlink-response`, at: new Date().toISOString(), shot: '', note: `DELETE /api/wallet → ${status}` });
    if (status !== 200) {
      await shotOf(p, 'wallet-section', `${settingsTab}-wallet-unlink-refused`, `DELETE /api/wallet → ${status}`);
      throw new Error(`stopped: unlinking ${previousLink} was refused (${status}); not forced`);
    }
    await expect(p.getByTestId('wallet-link')).toBeVisible();
    await shotOf(p, 'wallet-section', `${settingsTab}-wallet-unlinked`, `DELETE /api/wallet → ${status}`);
  }
  if (cancelFirst) {
    pt.rejectNext.add('signMessage');
    await p.getByTestId('wallet-link').click();
    await expect(p.getByTestId('wallet-error')).toBeVisible();
    await shotOf(p, 'wallet-section', `${settingsTab}-wallet-link-cancelled`, 'the wallet refused the signature (User rejected); nothing linked');
  }
  await p.getByTestId('wallet-link').click();
  await expect(p.getByTestId('wallet-address')).toContainText(pt.wallet.address);
  await shotOf(p, 'wallet-section', `${settingsTab}-wallet-linked`);
}

// eslint-disable-next-line no-empty-pattern -- Playwright needs the fixtures object before testInfo
test.beforeAll(async ({}, info) => {
  run.label = info.project.name;
  run.dir = join(EVIDENCE_ROOT, `${run.label}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  run.title = `Web devnet journey ${run.label} ${Date.now().toString(36)}`;
  if (RESUME_STUDY_ID) run.chain.segments = { segment: 2, resumesStudy: RESUME_STUDY_ID, segment1Evidence: RESUME_PREVIOUS_EVIDENCE, note: 'segment 1 created and funded the study, then was stopped by the lead; segment 2 resumes it (no creation, no new funding, no link changes)' };
  mkdirSync(run.dir, { recursive: true });
  run.chain.before = { builder: await balances(loadFixtureSeed('builder').address), tester: await balances(loadFixtureSeed('tester').address) };
});
test.afterAll(async () => {
  for (const r of ['builder', 'tester'] as const) {
    const pt = run[r];
    if (!pt) continue;
    writeEvidence(pt.ev, join(run.dir, `${r}-console-network.json`));
    writeFileSync(join(run.dir, `${r}-wallet-log.json`), JSON.stringify(pt.wallet.log, null, 1));
    await pt.ctx.close();
  }
  run.chain.after = { builder: await balances(loadFixtureSeed('builder').address), tester: await balances(loadFixtureSeed('tester').address) };
  writeFileSync(join(run.dir, 'run.json'), JSON.stringify({ label: run.label, viewportNote: run.label === 'pixel7' ? 'mobile viewport, NOT a physical-device wallet deep-link (MWA) test' : 'desktop 1280x900', wallet: TEST_WALLET_NAME, title: run.title, steps: run.steps, chain: run.chain, mainnetBlocked: run.blocked }, null, 1));
});

test('1 · auth: both roles sign in; wrong network: a mainnet-only wallet is not offered', async ({ browser }, info) => {
  run.builder = await party(browser, info, 'builder');
  run.tester = await party(browser, info, 'tester');
  await signIn(run.builder.page, 'builder');
  await expect(run.builder.page.getByTestId('studies-screen')).toBeVisible();
  await step('builder-signed-in', run.builder.page);
  await signIn(run.tester.page, 'tester');
  await expect(run.tester.page.getByTestId('discover-screen')).toBeVisible();
  await step('tester-signed-in', run.tester.page);

  // Wrong network: a context whose only wallet announces solana:mainnet (no key material: it can't sign anything).
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = info.project.use;
  const ctx = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  const p = await ctx.newPage();
  await installDevnetWallet(p, { secretKey: new Uint8Array(32).fill(7), originHost: ORIGIN_HOST, name: 'Mainnet-only test wallet (injected by Playwright)', chains: ['solana:mainnet'], send: async () => { throw new Error('never sends'); } });
  await p.route(`${ORIGIN}/**`, async (route) => {
    const u = new URL(route.request().url());
    const r = await fetch(`${LOOPBACK}${u.pathname}${u.search}`);
    const out: Record<string, string> = {};
    r.headers.forEach((v, k) => {
      if (k !== 'content-length' && k !== 'transfer-encoding' && k !== 'content-encoding') out[k] = v;
    });
    return route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) });
  });
  await p.addInitScript(() => localStorage.setItem('pocketqa.introSeen', '1'));
  await p.goto(`${ORIGIN}/sign-in`);
  await expect(p.getByText(/Continue with Mainnet-only/)).toHaveCount(0);
  await step('wrong-network-wallet-not-offered', p, 'only a solana:mainnet wallet is installed; the sign-in screen offers no wallet');
  await ctx.close();
});

test('2 · wallets: builder and tester link the fixture wallets (one cancel in the wallet first)', async () => {
  await linkWallet(run.builder!, 'tab-builder-settings', true);
  await linkWallet(run.tester!, 'tab-settings', true, TESTER_PREVIOUS_LINK || undefined, TESTER_ACCEPT_LINK || undefined);
  const t = run.tester!.page;
  await t.getByTestId('device-platform-web').click();
  await t.getByTestId('device-save').click();
  await expect(t.getByTestId('device-saved')).toBeVisible();
});

test('3 · builder: escrow study on the devnet pilot, fund it in the wallet (cancel once, then sign), publish', async () => {
  const b = run.builder!.page;
  if (RESUME_STUDY_ID) {
    // Segment 2: the study and its funding exist (segment 1). Never press fund here: only wait for the
    // server to confirm the existing funding, then publish.
    await b.goto(`${ORIGIN}/builder/study/${RESUME_STUDY_ID}`);
    await expect(b.getByTestId('escrow-panel')).toBeVisible({ timeout: 60_000 });
    run.studyUrl = b.url();
    // The tester finds it by the title segment 1 gave it (its run.json).
    run.title = (JSON.parse(readFileSync(join(RESUME_PREVIOUS_EVIDENCE, 'run.json'), 'utf8')) as { title: string }).title;
    await expect(b.getByText(run.title).first()).toBeVisible();
    await shotOf(b, 'escrow-panel', 'builder-resumed-study', `resumed study ${RESUME_STUDY_ID}`);
    await until(b, 'the existing funding confirmed (Funded on devnet)', () => b.getByTestId('escrow-funded').isVisible(), 5 * 60_000);
    await expect(b.getByTestId('escrow-funded')).toContainText('Funded on devnet');
    await shotOf(b, 'escrow-panel', 'builder-funded');
    // A resumed study may already be published (an earlier segment did it): never publish twice.
    if (!/PUBLISHED/.test(await b.getByTestId('study-status').innerText())) {
      await b.getByTestId('study-publish').click();
      await b.getByTestId('confirm-ok').click();
    }
    await expect(b.getByTestId('study-status')).toContainText('PUBLISHED');
    await step('builder-published', b);
    return;
  }
  await b.getByTestId('tab-studies').click();
  await b.getByTestId('new-study').click();
  await b.getByTestId('study-title').fill(run.title);
  await b.getByTestId('study-objective').fill('Check the devnet pilot end to end in the web app (devnet test USDC, no value).');
  await b.getByTestId('study-task-0').fill('Open the app and reach the home screen');
  await b.getByTestId('crit-web').click();
  await b.getByTestId('payment-mode-escrow').click();
  await expect(b.getByTestId('escrow-pilot-notice')).toBeVisible();
  await b.getByTestId('study-reward-usdc').fill(REWARD);
  await b.getByTestId('study-slots').fill(SLOTS);
  await step('builder-new-escrow-study', b);
  await b.getByTestId('study-save').click();
  await expect(b.getByTestId('escrow-panel')).toBeVisible();
  run.studyUrl = b.url();
  await shotOf(b, 'escrow-panel', 'builder-escrow-quote');
  const total = await b.getByTestId('escrow-total').innerText();
  expect(Number(total.replace(/[^0-9.]/g, ''))).toBeLessThanOrEqual(3);

  await b.getByTestId('escrow-fund').click();
  await expect(b.getByTestId('escrow-pilot-request')).toBeVisible();
  for (let i = 0; i < 12 && !(await b.getByTestId('escrow-wallet-plan').isVisible()); i++) {
    await b.getByTestId('escrow-wallet-review').click();
    await b.waitForTimeout(3_000);
  }
  await expect(b.getByTestId('escrow-wallet-plan')).toBeVisible();
  await shotOf(b, 'escrow-pilot-request', 'builder-funding-plan-checked');
  run.builder!.rejectNext.add('signAndSendTransaction');
  await b.getByTestId('escrow-wallet-sign').click();
  await expect(b.getByTestId('escrow-wallet-error')).toBeVisible();
  await shotOf(b, 'escrow-pilot-request', 'builder-funding-cancelled-in-wallet', 'the wallet refused (User rejected); nothing sent');
  await b.getByTestId('escrow-wallet-sign').click();
  await until(b, 'funding confirmed', async () => {
    if (await b.getByTestId('escrow-check').isVisible()) await b.getByTestId('escrow-check').click();
    return b.getByTestId('escrow-funded').isVisible();
  }, 5 * 60_000);
  await expect(b.getByTestId('escrow-funded')).toContainText('Funded on devnet');
  await shotOf(b, 'escrow-panel', 'builder-funded');
  await b.getByTestId('study-publish').click();
  await b.getByTestId('confirm-ok').click();
  await expect(b.getByTestId('study-status')).toContainText('PUBLISHED');
  await step('builder-published', b);
});

test('4 · tester: finds the study, consents with the linked wallet, attaches synthetic evidence, submits', async () => {
  const t = run.tester!.page;
  if (RESUME_PARTICIPATION_ID) {
    await t.goto(`${ORIGIN}/participation/${RESUME_PARTICIPATION_ID}`);
    await expect(t.getByTestId('participation-screen')).toBeVisible({ timeout: 60_000 });
    await step('tester-resumed-participation', t, `resumed participation ${RESUME_PARTICIPATION_ID}`);
    // Already submitted in an earlier segment: never upload or submit twice.
    if (/AWAITING REVIEW/.test((await t.getByTestId('session-status').innerText().catch(() => '')) ?? '')) {
      await step('tester-already-submitted', t, 'submitted in an earlier segment; no second upload or submit');
      return;
    }
    if (await t.getByTestId('session-start').isVisible()) await t.getByTestId('session-start').click();
  } else {
    await t.getByTestId('tab-discover').click();
    // The card shows the title more than once (a bare getByText is a strict-mode error, which the wait swallowed).
    await until(t, 'the study in Discover', () => t.getByText(run.title).first().isVisible(), 60_000);
    await t.getByText(run.title).first().click();
    await step('tester-study-detail', t);
    await t.getByTestId('consent-checkbox').click();
    await t.getByTestId('consent-reward-wallet').click();
    await t.getByTestId('consent-submit').click();
    await expect(t.getByTestId('participation-screen')).toBeVisible();
    await t.getByTestId('session-start').click();
  }
  const png = join(run.dir, 'synthetic-evidence.png');
  syntheticPng(png);
  const chooser = t.waitForEvent('filechooser');
  await t.getByTestId('attach-evidence').click();
  await (await chooser).setFiles(png);
  await t.getByTestId('segment-keep').click();
  await t.getByTestId('upload-kept').click();
  await expect(t.getByTestId('uploaded-evidence')).toContainText('Uploaded (1)', { timeout: 60_000 });
  await step('tester-evidence-uploaded', t, 'a generated 64x64 flat PNG (synthetic, no personal content)');
  await t.getByTestId('session-submit').click();
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('session-status')).toContainText('AWAITING REVIEW');
  await step('tester-submitted', t);
});

test('5 · builder: reviews and approves; votes on the reward in the wallet (cancel once, then sign); the payment settles on devnet', async () => {
  const b = run.builder!.page;
  await b.goto(run.studyUrl!);
  // This study has exactly one participation (the tester's): its row opens the review.
  await until(b, 'the submission on the study page', () => b.locator('[data-testid^="builder-participation-"]').first().isVisible(), 60_000);
  await expect(b.locator('[data-testid^="builder-participation-"]')).toHaveCount(1);
  await b.locator('[data-testid^="builder-participation-"]').first().click();
  await expect(b.getByTestId('review-approve')).toBeVisible();
  run.reviewUrl = b.url();
  await step('builder-review', b);
  await b.getByTestId('review-approve').click();
  await b.getByTestId('confirm-ok').click();
  await expect(b.getByTestId('review-decided')).toContainText('Approved');
  await until(b, 'reward awaiting the builder’s vote', () => b.getByTestId('reward-approval-review').isVisible());
  await b.getByTestId('reward-approval-review').click();
  await expect(b.getByTestId('reward-approval-plan')).toBeVisible({ timeout: 30_000 });
  // The reward goes to the address frozen at consent (the tester fixture), whatever the account is linked to now.
  const frozen = loadFixtureSeed('tester').address;
  await expect(b.getByTestId('reward-approval')).toContainText(frozen);
  if (TESTER_ACCEPT_LINK) await expect(b.getByTestId('reward-approval')).not.toContainText(TESTER_ACCEPT_LINK);
  const devnetChecked = (await b.getByTestId('reward-approval-described').count()) === 0;
  await shotOf(b, 'reward-approval', 'builder-reward-vote-card', devnetChecked ? 'amount/recipient/op id CHECKED on devnet (vault transaction read)' : `NOT checked on devnet: ${await b.getByTestId('reward-approval-described-note').innerText().catch(() => '(no note)')}`);
  run.builder!.rejectNext.add('signAndSendTransaction');
  await b.getByTestId('reward-approval-sign').click();
  await expect(b.getByTestId('reward-approval-error')).toBeVisible();
  await shotOf(b, 'reward-approval', 'builder-reward-vote-cancelled-in-wallet', 'the wallet refused (User rejected); nothing sent');
  await b.getByTestId('reward-approval-sign').click();
  await expect(b.getByTestId('reward-approval-review')).toHaveCount(0, { timeout: 60_000 });
  await until(b, 'reward settled on devnet', () => b.getByTestId('payment-state').getByText('Settled on devnet').isVisible());
  await step('builder-reward-settled', b);
  const t = run.tester!.page;
  await t.reload();
  await expect(t.getByTestId('payment-state')).toContainText('Settled on devnet');
  await step('tester-reward-settled', t);
});

test('6 · builder: closes the study; votes on the refund and the fee sweep; balances (UI and chain)', async () => {
  const b = run.builder!.page;
  await b.goto(run.studyUrl!);
  await b.getByTestId('study-close').click();
  await b.getByTestId('confirm-ok').click();
  await expect(b.getByTestId('study-status')).toContainText('CLOSED');
  for (const [id, what] of [['escrow-refund-approval', 'refund'], ['escrow-fee-approval', 'fee sweep']] as const) {
    await until(b, `${what} awaiting the builder’s vote`, () => b.getByTestId(`${id}-review`).isVisible());
    await b.getByTestId(`${id}-review`).click();
    await expect(b.getByTestId(`${id}-plan`)).toBeVisible({ timeout: 30_000 });
    const checked = (await b.getByTestId(`${id}-described`).count()) === 0;
    await shotOf(b, id, `builder-${what.replace(' ', '-')}-vote-card`, checked ? 'checked on devnet' : 'NOT checked on devnet (see the card note)');
    await b.getByTestId(`${id}-sign`).click();
    await expect(b.getByTestId(`${id}-review`)).toHaveCount(0, { timeout: 60_000 });
  }
  await until(b, 'refund and fee sweep finalized', async () => (await b.getByTestId('escrow-refund').innerText().catch(() => '')).includes('finalized on devnet') && (await b.getByTestId('escrow-fee-sweep').innerText().catch(() => '')).includes('finalized on devnet'));
  await shotOf(b, 'escrow-panel', 'builder-closed-books');
  const t = run.tester!.page;
  await t.goto(`${ORIGIN}/credits`);
  await step('tester-rewards', t);
  // Every signature the wallet made, and no mainnet request anywhere.
  for (const pt of [run.builder!, run.tester!]) for (const l of pt.wallet.log) if (l.chain) expect(l.chain === DEVNET || !l.approved).toBe(true);
  expect(run.blocked).toEqual([]);
});
