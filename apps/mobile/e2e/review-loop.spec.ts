import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// End-to-end builder review loop on the web preview against the real local API.
const SHOTS = join(__dirname, '../../../docs/reviews/gate-a');
mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const pw = 'correct horse battery staple';

// A real 24x24 PNG (solid indigo) so the preview and the server's magic-byte check see an image.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAH0lEQVR4nGNQNlpCFcQwatCoQaMGjRo0atCoQcPNIADPXyM9QJM8cAAAAABJRU5ErkJggg==';
const png = join(tmpdir(), `pqa-evidence-${run}.png`);
const png2 = join(tmpdir(), `pqa-private-${run}.png`);
writeFileSync(png, Buffer.from(PNG_B64, 'base64'));
writeFileSync(png2, Buffer.from(PNG_B64, 'base64'));

async function signUp(page: Page, role: 'tester' | 'builder', name: string) {
  await page.goto('/sign-up');
  await page.getByTestId(`role-${role}`).click();
  await page.getByTestId('sign-up-name').fill(name);
  await page.getByTestId('sign-up-email').fill(`${name.toLowerCase()}-${run}@example.test`);
  await page.getByTestId('sign-up-password').fill(pw);
  await page.getByTestId('sign-up-submit').click();
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// Lens screens are transparent over the Ground, which paints the theme's background (docs/decisions/0005-lens-visual-system.md).
async function screenBackground(page: Page, testID: string) {
  return page.getByTestId(testID).evaluate((el) => {
    // The first background on the way up that is not fully transparent: the colour painted behind the screen.
    for (let node: Element | null = el; node; node = node.parentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return 'transparent';
  });
}

test('builder creates and funds a study, tester submits consented evidence, builder reviews and approves', async ({ browser }) => {
  const builderCtx = await browser.newContext({ colorScheme: 'light' });
  const testerCtx = await browser.newContext({ colorScheme: 'dark' });
  const builder = await builderCtx.newPage();
  const tester = await testerCtx.newPage();

  // --- Builder: sign up, see empty state, fund, create, publish ---
  await signUp(builder, 'builder', 'Bea');
  await expect(builder.getByTestId('studies-screen')).toBeVisible();
  await expect(builder.getByTestId('empty-state')).toBeVisible();
  await shot(builder, 'builder-studies-empty-light');

  await builder.getByTestId('tab-budget').click();
  await expect(builder.getByTestId('credit-balance')).toHaveText('0 test credits');
  await builder.getByTestId('topup-amount-1000').click();
  await builder.getByTestId('topup-submit').click();
  await expect(builder.getByTestId('credit-balance')).toHaveText('1,000 test credits');
  await shot(builder, 'builder-budget-light');

  await builder.getByTestId('tab-studies').click();
  await builder.getByTestId('new-study').click();
  await builder.getByTestId('study-title').fill(`Onboarding friction ${run}`);
  await builder.getByTestId('study-objective').fill('Find where first-time users get stuck creating an account.');
  await builder.getByTestId('study-task-0').fill('Create an account and reach the home screen');
  await builder.getByTestId('crit-web').click();
  await builder.getByTestId('study-slots').fill('2');
  // Banned wording is blocked before it reaches the server.
  await builder.getByTestId('study-objective').fill('Earn money fast while testing our app');
  await expect(builder.getByTestId('copy-issue')).toBeVisible();
  await builder.getByTestId('study-objective').fill('Find where first-time users get stuck creating an account.');
  await expect(builder.getByTestId('copy-issue')).toHaveCount(0);
  await shot(builder, 'builder-new-study-light');
  await builder.getByTestId('study-save').click();

  await expect(builder.getByTestId('builder-study-screen')).toBeVisible();
  await expect(builder.getByTestId('study-status')).toContainText('DRAFT');
  await builder.getByTestId('study-publish').click();
  await builder.getByTestId('confirm-ok').click();
  await expect(builder.getByTestId('study-status')).toContainText('PUBLISHED');
  await expect(builder.getByTestId('budget-reserved')).toHaveText('100');
  await shot(builder, 'builder-study-published-light');

  // --- Tester: sign up, add device, discover, consent ---
  await signUp(tester, 'tester', 'Tom');
  await expect(tester.getByTestId('discover-screen')).toBeVisible();
  await expect(tester.getByTestId('device-missing')).toBeVisible();
  await shot(tester, 'tester-discover-no-device-dark');
  await tester.getByTestId('tab-settings').click();
  await tester.getByTestId('device-platform-web').click();
  await tester.getByTestId('device-save').click();
  await expect(tester.getByTestId('device-saved')).toBeVisible();
  await expect(tester.getByTestId('wallet-unavailable')).toBeVisible();
  await shot(tester, 'tester-settings-dark');

  await tester.getByTestId('tab-discover').click();
  const card = tester.locator('[data-testid^="study-card-"]').filter({ hasText: run });
  await expect(card).toBeVisible();
  await shot(tester, 'tester-discover-dark');
  await card.click();
  await expect(tester.getByTestId('reward-disclaimer')).toContainText('Not guaranteed');
  await expect(tester.getByTestId('recording-unavailable')).toBeVisible();
  await expect(tester.getByTestId('consent-submit')).toBeDisabled();
  await tester.getByTestId('consent-checkbox').click();
  await shot(tester, 'tester-consent-dark');
  await tester.getByTestId('consent-submit').click();

  await expect(tester.getByTestId('participation-screen')).toBeVisible();
  // A tester deep-linking to a builder screen is sent back to their own home.
  const sessionUrl = tester.url();
  await tester.goto('/builder/new-study');
  await expect(tester.getByTestId('discover-screen')).toBeVisible();
  await tester.goto(sessionUrl);

  // --- Tester: session, notes, evidence review, upload, submit ---
  await expect(tester.getByTestId('participation-screen')).toBeVisible();
  await tester.getByTestId('session-start').click();
  await expect(tester.getByTestId('session-status')).toContainText('IN PROGRESS');
  await tester.getByTestId('task-note-0').fill('The OTP screen gave no hint where the code was sent.');
  await tester.getByTestId('task-note-save-0').click();
  await expect(tester.getByTestId('task-note-save-0')).toContainText('Saved');

  // A private screenshot is attached and then removed: it must never be uploaded.
  let chooser = tester.waitForEvent('filechooser');
  await tester.getByTestId('attach-evidence').click();
  await (await chooser).setFiles(png2);
  await expect(tester.getByTestId('segment-recorded')).toHaveCount(1);
  await tester.getByTestId('segment-remove').click();
  await expect(tester.getByTestId('segment-recorded')).toHaveCount(0);

  chooser = tester.waitForEvent('filechooser');
  await tester.getByTestId('attach-evidence').click();
  await (await chooser).setFiles(png);
  await expect(tester.getByTestId('segment-recorded')).toHaveCount(1);
  await expect(tester.getByTestId('upload-kept')).toHaveCount(0); // nothing uploads until kept
  // Submitting is blocked while evidence is unreviewed or not yet uploaded.
  await expect(tester.getByTestId('pending-evidence')).toContainText('1 item');
  await expect(tester.getByTestId('session-submit')).toBeDisabled();
  await shot(tester, 'tester-segment-review-dark');
  await tester.getByTestId('segment-keep').click();
  await tester.getByTestId('upload-kept').click();
  await expect(tester.getByTestId('uploaded-evidence')).toContainText('Uploaded (1)');
  await expect(tester.getByTestId('pending-evidence')).toHaveCount(0);
  await shot(tester, 'tester-evidence-uploaded-dark');

  await tester.getByTestId('session-submit').click();
  await tester.getByTestId('confirm-ok').click();
  await expect(tester.getByTestId('session-status')).toContainText('AWAITING REVIEW');
  await expect(tester.getByTestId('awaiting-review')).toBeVisible();

  // --- Builder: review evidence, add a finding, approve ---
  await builder.reload();
  const row = builder.locator('[data-testid^="builder-participation-"]');
  await expect(row).toContainText('AWAITING REVIEW');
  await row.click();
  await expect(builder.getByTestId('review-note-0')).toContainText('OTP screen');
  await expect(builder.getByTestId('ai-unavailable')).toContainText('Analysis unavailable');
  await expect(builder.getByTestId('evidence-item')).toHaveCount(1); // the removed one never arrived
  await builder.getByTestId('evidence-view').click();
  await expect(builder.getByTestId('evidence-media')).toBeVisible();
  await builder.getByTestId('finding-title').fill('OTP destination unclear');
  await builder.getByTestId('finding-description').fill('Tester could not tell where the one-time code was sent.');
  await builder.getByTestId('finding-submit').click();
  await expect(builder.getByTestId('finding-item')).toContainText('OTP destination unclear');
  await shot(builder, 'builder-review-light');
  await builder.getByTestId('review-approve').click();
  await builder.getByTestId('confirm-ok').click();
  await expect(builder.getByTestId('review-decided')).toContainText('Approved');

  // --- Tester: sees approval, finding and credited test credits ---
  await tester.reload();
  await expect(tester.getByTestId('approved-notice')).toContainText('50 test credits');
  await expect(tester.getByText('OTP destination unclear')).toBeVisible();
  await shot(tester, 'tester-approved-dark');
  // The session screen is stacked over the tabs, so go to Credits directly.
  await tester.goto('/credits');
  await expect(tester.getByTestId('credit-balance')).toHaveText('50 test credits');
  await shot(tester, 'tester-credits-dark');

  // --- Builder: budget reflects the award ---
  await builder.goBack();
  await builder.reload();
  await expect(builder.getByTestId('budget-awarded')).toHaveText('50');

  await builderCtx.close();
  await testerCtx.close();
});

test('theme switch persists and unauthenticated users land on sign-in', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto('/studies');
  await expect(page.getByTestId('sign-in-screen')).toBeVisible();
  await signUp(page, 'builder', 'Theo');
  await page.getByTestId('tab-builder-settings').click();
  // The light system scheme first (tokens.ts light.background #F6F6F4), so the dark reading below is the override's.
  expect(await screenBackground(page, 'settings-screen')).toBe('rgb(246, 246, 244)');
  await page.getByTestId('theme-dark').click();
  // The dark Lens ground (tokens.ts dark.background #0B0A1F), now and after a reload.
  const bg = await screenBackground(page, 'settings-screen');
  expect(bg).toBe('rgb(11, 10, 31)');
  await shot(page, 'builder-settings-dark-override');
  await page.reload();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  const bg2 = await screenBackground(page, 'settings-screen');
  expect(bg2).toBe('rgb(11, 10, 31)');
  await ctx.close();
});

test('offline state when the API is unreachable', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signUp(page, 'tester', 'Olive');
  await expect(page.getByTestId('discover-screen')).toBeVisible();
  await ctx.route('http://127.0.0.1:8787/**', (r) => r.abort('internetdisconnected'));
  await page.getByTestId('tab-work').click();
  await expect(page.getByTestId('offline-state')).toBeVisible();
  await shot(page, 'tester-offline-light');
  await ctx.unroute('http://127.0.0.1:8787/**');
  await page.getByTestId('retry-button').click();
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await ctx.close();
});
