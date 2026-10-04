import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installWallet } from './testWallet';

// Wallet-funded escrow and reputation in the real web app against the real local API, which runs
// SIMULATED settlement (ADR 0007): no network, no keys, no asset. Every money state in the UI must
// say it is a simulation. Screenshots: docs/reviews/wallet-rewards/browser.
const SHOTS = join(__dirname, '../../../docs/reviews/wallet-rewards/browser');
mkdirSync(SHOTS, { recursive: true });
const API = 'http://127.0.0.1:8787';
const run = Date.now().toString(36);
const pw = 'correct horse battery staple';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(pw);
  await page.getByTestId('sign-in-submit').click();
}

test('builder funds a wallet escrow study (simulated); tester joins with a frozen wallet; approval settles once; reputation updates', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const builderEmail = `escrow-builder-${run}@example.test`;
  const testerEmail = `escrow-tester-${run}@example.test`;
  for (const [email, role, name] of [[builderEmail, 'builder', 'Bea Escrow'], [testerEmail, 'tester', 'Tara Escrow']] as const) {
    expect((await request.post(`${API}/auth/register`, { data: { email, password: pw, displayName: name, role } })).status()).toBe(200);
  }
  const builderCtx = await browser.newContext({ colorScheme: 'light' });
  const testerCtx = await browser.newContext({ colorScheme: 'dark' });
  const builder = await builderCtx.newPage();
  const tester = await testerCtx.newPage();

  // --- Builder: link the funding wallet (real SIWS link flow with a test wallet) ---
  const bw = await installWallet(builder, { signIn: true, allowSignMessage: true, name: 'Builder Wallet' });
  await signIn(builder, builderEmail);
  await expect(builder.getByTestId('studies-screen')).toBeVisible();
  await builder.getByTestId('tab-builder-settings').click();
  await builder.getByTestId('wallet-link').click();
  await expect(builder.getByTestId('wallet-address')).toContainText(bw.address);

  // --- Builder: a wallet escrow study, 1.5 simulated USDC × 2 slots ---
  await builder.getByTestId('tab-studies').click();
  await builder.getByTestId('new-study').click();
  await builder.getByTestId('study-title').fill(`Escrow onboarding ${run}`);
  await builder.getByTestId('study-objective').fill('Find where first-time users get stuck creating an account.');
  await builder.getByTestId('study-task-0').fill('Create an account and reach the home screen');
  await builder.getByTestId('crit-web').click();
  await builder.getByTestId('payment-mode-escrow').click();
  await expect(builder.getByTestId('escrow-sim-notice')).toContainText('no funds move');
  await builder.getByTestId('study-reward-usdc').fill('1.5');
  await builder.getByTestId('study-slots').fill('2');
  await expect(builder.getByTestId('study-pool')).toHaveText('3.00 simulated USDC');
  await shot(builder, 'builder-new-escrow-study-light');
  await builder.getByTestId('study-save').click();

  // --- Builder: the quote (10% illustrative fee), the trust model, simulated funding, publish ---
  await expect(builder.getByTestId('escrow-panel')).toBeVisible();
  const studyUrl = builder.url();
  await expect(builder.getByTestId('escrow-total')).toHaveText('3.30 simulated USDC');
  await expect(builder.getByTestId('escrow-trust')).toContainText('only to the tester’s saved wallet');
  await builder.getByTestId('study-publish').click();
  await builder.getByTestId('confirm-ok').click();
  await expect(builder.getByTestId('study-action-sheet-error')).toContainText('Fund this study');
  await builder.getByTestId('confirm-cancel').click();
  await shot(builder, 'builder-escrow-unfunded-light');
  await builder.getByTestId('escrow-fund').click();
  await expect(builder.getByTestId('escrow-funded')).toContainText('Funded (simulated)');
  await expect(builder.getByTestId('escrow-available')).toHaveText('3.30 simulated USDC');
  await builder.getByTestId('study-publish').click();
  await builder.getByTestId('confirm-ok').click();
  await expect(builder.getByTestId('study-status')).toContainText('PUBLISHED');
  await shot(builder, 'builder-escrow-funded-light');

  // --- Tester: device, wallet, then join with an explicit wallet confirmation ---
  const tw = await installWallet(tester, { signIn: true, allowSignMessage: true, name: 'Tester Wallet' });
  await signIn(tester, testerEmail);
  await expect(tester.getByTestId('discover-screen')).toBeVisible();
  await tester.getByTestId('tab-settings').click();
  await tester.getByTestId('device-platform-web').click();
  await tester.getByTestId('device-save').click();
  await expect(tester.getByTestId('device-saved')).toBeVisible();
  await tester.getByTestId('wallet-link').click();
  await expect(tester.getByTestId('wallet-address')).toContainText(tw.address);
  await tester.getByTestId('tab-discover').click();
  const card = tester.getByText(`Escrow onboarding ${run}`);
  await expect(card).toBeVisible();
  await card.click();
  await expect(tester.getByTestId('reward-disclaimer')).toContainText('Simulation in this build: no funds move');
  await tester.getByTestId('consent-checkbox').click();
  await expect(tester.getByTestId('consent-submit')).toBeDisabled();
  await tester.getByTestId('consent-reward-wallet').click();
  await shot(tester, 'tester-escrow-consent-dark');
  await tester.getByTestId('consent-submit').click();
  await expect(tester.getByTestId('participation-screen')).toBeVisible();
  const sessionUrl = tester.url();
  await tester.getByTestId('session-start').click();
  await tester.getByTestId('session-submit').click();
  await tester.getByTestId('confirm-ok').click();
  await expect(tester.getByTestId('session-status')).toContainText('AWAITING REVIEW');

  // --- Builder: approve with the helpful mark; the reward is pending, then settled (simulated) ---
  await builder.reload();
  const row = builder.locator('[data-testid^="builder-participation-"]');
  await expect(row).toContainText('AWAITING REVIEW');
  await row.click();
  await builder.getByTestId('review-approve').click();
  await builder.getByTestId('approve-helpful').click();
  await builder.getByTestId('confirm-ok').click();
  await expect(builder.getByTestId('review-decided')).toContainText('Approved');
  await expect(builder.getByTestId('payment-state')).toContainText(/simulation/);
  // The settlement worker runs every 15 s; reload until the transfer is finalized (simulated).
  await expect(async () => {
    await builder.reload();
    await expect(builder.getByTestId('payment-state')).toContainText('Settled · simulation, no funds moved', { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(builder.getByTestId('payment-state')).not.toContainText(/\bpaid\b/i);
  await shot(builder, 'builder-review-settled-light');

  // --- Tester: the payment state on the session and under Credits; points and a badge ---
  await tester.goto(sessionUrl);
  await expect(tester.getByTestId('approved-notice')).toContainText('released from the study escrow');
  await expect(tester.getByTestId('payment-state')).toContainText('Settled · simulation');
  await shot(tester, 'tester-session-settled-dark');
  await tester.goto('/credits');
  await expect(tester.getByTestId('tester-wallet-rewards')).toContainText('1.50 simulated USDC');
  await tester.getByTestId('open-reputation').click();
  await expect(tester.getByTestId('reputation-points')).toHaveText('15');
  await expect(tester.getByTestId('badge-first_accepted')).toBeVisible();
  await tester.getByTestId('leaderboard-optin').click();
  await tester.getByTestId('leaderboard-alias').fill(`Tara ${run.slice(-4)}`);
  await tester.getByTestId('leaderboard-save').click();
  await expect(tester.getByTestId('leaderboard-rank')).toContainText('Not ranked yet');
  await shot(tester, 'tester-reputation-dark');
  await tester.getByTestId('leaderboard-open').click();
  await expect(tester.getByTestId('leaderboard-screen')).toContainText('never by volume or money');
  await shot(tester, 'tester-leaderboard-dark');

  // --- The builder's books: settled, fees earned, the rest still available ---
  // Opened by URL: after reloads on the review page, browser history isn't a reliable way back.
  await builder.goto(studyUrl);
  await expect(builder.getByTestId('escrow-settled')).toHaveText('1.50 simulated USDC');
  await expect(builder.getByTestId('escrow-available')).toHaveText('1.65 simulated USDC');

  // --- Exports: each side gets its own money and reputation, exact string units, nothing of the other ---
  const exportJson = async (page: Page, settingsTab: string) => {
    await page.getByTestId(settingsTab).click();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-data').click();
    const path = await (await download).path();
    await expect(page.getByTestId('export-done')).toContainText('wallet escrow records (simulated)');
    return { json: JSON.parse(readFileSync(path!, 'utf8')), raw: readFileSync(path!, 'utf8') };
  };
  await tester.goto('/discover');
  const te = await exportJson(tester, 'tab-settings');
  expect(te.json.payments.received).toEqual([expect.objectContaining({ amountUnits: '1500000', destination: tw.address, settlement: 'simulated', status: 'confirmed' })]);
  expect(te.json.reputation).toMatchObject({ points: 15, noCashValue: true });
  expect(te.raw).not.toContain(bw.address);
  expect(te.raw).not.toContain(builderEmail);
  await builder.goto('/studies');
  const be = await exportJson(builder, 'tab-builder-settings');
  expect(be.json.payments.fundings).toEqual([expect.objectContaining({ amountUnits: '3300000', source: bw.address, status: 'confirmed' })]);
  expect(be.json.payments.studyPayments).toEqual([expect.objectContaining({ amountUnits: '1500000', feeUnits: '150000', status: 'confirmed' })]);
  expect(be.raw).not.toContain(tw.address);
  expect(be.raw).not.toContain(testerEmail);

  await builderCtx.close();
  await testerCtx.close();
});
