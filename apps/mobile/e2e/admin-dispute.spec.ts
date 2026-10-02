import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Reject → tester disputes → admin overturns → tester credited once; audit + moderation.
const SHOTS = join(__dirname, '../../../docs/reviews/gate-a');
mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const pw = 'correct horse battery staple';
const shot = async (p: Page, n: string) => {
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(SHOTS, `${n}.png`), fullPage: true });
};

async function signUp(page: Page, role: 'tester' | 'builder', name: string) {
  await page.goto('/sign-up');
  await page.getByTestId(`role-${role}`).click();
  await page.getByTestId('sign-up-name').fill(name);
  await page.getByTestId('sign-up-email').fill(`${name.toLowerCase()}-${run}@example.test`);
  await page.getByTestId('sign-up-password').fill(pw);
  await page.getByTestId('sign-up-submit').click();
  await expect(page.getByTestId(role === 'tester' ? 'discover-screen' : 'studies-screen')).toBeVisible();
}

test('dispute overturned by admin credits the tester; moderation is audited', async ({ browser }) => {
  // Admin accounts only come from the local CLI (password via piped stdin, never argv).
  const adminEmail = `admin-${run}@example.test`;
  execFileSync('pnpm', ['--filter', '@pocket-qa/api', 'admin:create', adminEmail], {
    input: `${pw}\n`,
    env: { ...process.env, POCKETQA_DATA_DIR: process.env.POCKETQA_E2E_DATA_DIR },
    cwd: join(__dirname, '../../..'),
  });

  const b = await (await browser.newContext()).newPage();
  const t = await (await browser.newContext({ colorScheme: 'dark' })).newPage();
  const a = await (await browser.newContext()).newPage();

  await signUp(b, 'builder', 'Dora');
  await b.getByTestId('tab-budget').click();
  await b.getByTestId('topup-submit').click();
  await expect(b.getByTestId('credit-balance')).toHaveText('1,000 test credits');
  await b.goto('/builder/new-study');
  await b.getByTestId('study-title').fill(`Wallet onboarding ${run}`);
  await b.getByTestId('study-objective').fill('See whether new users understand the wallet connect step.');
  await b.getByTestId('study-task-0').fill('Connect a test wallet and return to the app');
  await b.getByTestId('crit-web').click();
  await b.getByTestId('study-save').click();
  await b.getByTestId('study-publish').click();
  await b.getByTestId('confirm-ok').click();
  await expect(b.getByTestId('study-status')).toContainText('PUBLISHED');
  const studyUrl = b.url();

  await signUp(t, 'tester', 'Ravi');
  await t.goto('/settings');
  await t.getByTestId('device-platform-web').click();
  await t.getByTestId('device-save').click();
  await expect(t.getByTestId('device-saved')).toBeVisible();
  await t.goto('/discover');
  await t.locator('[data-testid^="study-card-"]').filter({ hasText: run }).click();
  await t.getByTestId('consent-checkbox').click();
  await t.getByTestId('consent-submit').click();
  await t.getByTestId('session-start').click();
  await t.getByTestId('task-note-0').fill('Connected on the second try; the first deep link did nothing.');
  await t.getByTestId('task-note-save-0').click();
  await expect(t.getByTestId('task-note-save-0')).toContainText('Saved');
  await t.getByTestId('session-submit').click();
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('session-status')).toContainText('AWAITING REVIEW');
  const sessionUrl = t.url();

  // Builder rejects; a too-short reason can't be sent.
  await b.goto(studyUrl);
  await b.locator('[data-testid^="builder-participation-"]').click();
  await b.getByTestId('review-reject').click();
  await b.getByTestId('reject-reason').fill('short');
  await expect(b.getByTestId('confirm-ok')).toBeDisabled();
  await b.getByTestId('reject-reason').fill('No evidence attached for the wallet step.');
  await b.getByTestId('confirm-ok').click();
  await expect(b.getByTestId('review-decided')).toContainText('Rejected');

  // Builder cannot close during the dispute window.
  await b.goto(studyUrl);
  await b.getByTestId('study-close').click();
  await b.getByTestId('confirm-ok').click();
  await expect(b.getByTestId('study-action-sheet-error')).toContainText('dispute window');
  await b.getByTestId('confirm-cancel').click();

  // Tester disputes.
  await t.goto(sessionUrl);
  await expect(t.getByTestId('rejected-notice')).toContainText('No evidence attached');
  await t.getByTestId('dispute-open').click();
  await t.getByTestId('dispute-reason').fill('My note explains the wallet step in detail; please re-check.');
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('dispute-card')).toContainText('OPEN');
  await shot(t, 'tester-dispute-open-dark');

  // Admin overturns.
  await a.goto('/sign-in');
  await a.getByTestId('sign-in-email').fill(adminEmail);
  await a.getByTestId('sign-in-password').fill(pw);
  await a.getByTestId('sign-in-submit').click();
  await expect(a.getByTestId('disputes-screen')).toBeVisible();
  const open = a.getByTestId('dispute-open').filter({ hasText: 'wallet step in detail' });
  await expect(open).toContainText('No evidence attached for the wallet step.');
  await shot(a, 'admin-disputes-light');
  await open.getByTestId('dispute-resolve').click();
  await a.getByTestId('dispute-outcome-overturned').click();
  await a.getByTestId('dispute-note').fill('The note documents the wallet step.');
  await a.getByTestId('confirm-ok').click();
  await expect(a.getByTestId('dispute-resolved').first()).toContainText('Overturned');

  // Moderation with a reason is audited.
  await a.getByTestId('tab-moderation').click();
  await a.getByTestId('moderate-study').first().click();
  await a.getByTestId('moderation-reason').fill('Checking moderation audit trail');
  await a.getByTestId('confirm-ok').click();
  await a.getByTestId('tab-audit').click();
  await expect(a.getByTestId('audit-entry').first()).toContainText('study.suspend');
  await expect(a.getByTestId('audit-entry').nth(1)).toContainText('dispute.overturned');
  await shot(a, 'admin-audit-light');

  // Tester was credited exactly once.
  await t.goto('/credits');
  await expect(t.getByTestId('credit-balance')).toHaveText('50 test credits');
  await expect(t.getByTestId('ledger-dispute_credit')).toHaveCount(1);
  await shot(t, 'tester-credits-after-dispute-dark');
});
