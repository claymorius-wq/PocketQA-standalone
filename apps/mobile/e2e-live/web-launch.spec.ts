import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page, type Response } from '@playwright/test';

// LIVE web end-to-end (docs/production/web-launch.md): the real web build, a real browser, the
// real Firebase project (pocketqa-optijara) and the real R2 bucket (pocketqa-evidence), with an
// isolated NON-PRODUCTION API (synthetic data, R2 retention-only, deletion off; e2e-live/start-api.mjs).
//
// The browser loads the app as https://pocketqa.optijara.ai, the production origin, so Firebase's
// authorized domains and the bucket's exact-origin CORS rule are exercised for real. Every request
// to that host is answered by the local production front door (scripts/production/web-server.mjs,
// serving the production web build and proxying /api), so nothing reaches the deployed preview and
// the page runs under the real production CSP. Uploads go from the browser straight to R2.
// Creates synthetic users (pqa-weblive-*@example.test) and objects; deletes nothing.

const ORIGIN = 'https://pocketqa.optijara.ai';
const WEB = 'http://127.0.0.1:8091';
const API = 'http://127.0.0.1:8797';
const run = Date.now().toString(36);
const pw = 'correct horse battery staple';

// Firebase Admin (the operator's key) only marks the synthetic test addresses as verified, as a
// person would by opening the link; no real inbox exists for example.test.
const requireApi = createRequire(join(__dirname, '../../api/package.json'));
const { cert, initializeApp } = requireApi('firebase-admin/app') as typeof import('firebase-admin/app');
const { getAuth } = requireApi('firebase-admin/auth') as typeof import('firebase-admin/auth');
const admin = getAuth(initializeApp({ credential: cert(JSON.parse(readFileSync(join(homedir(), '.config/pocketqa/pocketqa-api.json'), 'utf8'))) }, 'web-live'));
const created: string[] = [];
const emailOutcomes: string[] = [];

// A real 3-second VP9 clip (synthetic test pattern), so the browser plays it and issues Range requests.
const clip = join(tmpdir(), `pqa-weblive-${run}.webm`);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=15', '-t', '3', '-c:v', 'libvpx-vp9', '-b:v', '200k', '-an', '-y', clip]);

/** Maps the production origin onto the local front door inside this browser context only. */
async function mapOrigin(ctx: BrowserContext, seen: { mapped: number; csp: string[] }) {
  // Every request to the production host is fulfilled here; route.fetch only ever targets loopback.
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    seen.mapped += 1;
    await route.fulfill({ response: await route.fetch({ url: `${WEB}${url.pathname}${url.search}` }) });
  });
  // Any CSP violation (a blocked Firebase or R2 call, an inline script) on any page, across
  // navigations, fails the run: Chromium reports each one on the console.
  ctx.on('console', (m) => {
    if (/Content Security Policy|Refused to/.test(m.text())) seen.csp.push(m.text().slice(0, 200));
  });
}

async function signUpVerifySignIn(page: Page, role: 'tester' | 'builder', name: string) {
  const email = `pqa-weblive-${name.toLowerCase()}-${run}@example.test`;
  await page.goto(`${ORIGIN}/sign-up`);
  await page.getByTestId(`role-${role}`).click();
  await page.getByTestId('sign-up-name').fill(name);
  await page.getByTestId('sign-up-email').fill(email);
  await page.getByTestId('sign-up-password').fill(pw);
  await page.getByTestId('sign-up-submit').click();
  // Firebase sometimes answers the verification send with 503 after creating the account; the app
  // then says so honestly (sign-up-verify-unsent). Either way the account exists and is unverified.
  const notice = page.getByTestId('sign-up-verify').or(page.getByTestId('sign-up-verify-unsent'));
  await expect(notice).toBeVisible();
  emailOutcomes.push((await notice.getAttribute('data-testid')) === 'sign-up-verify' ? 'sent' : 'unsent');
  const user = await admin.getUserByEmail(email);
  expect(user.emailVerified).toBe(false);
  created.push(user.uid);
  // Unverified: the API refuses the sign-in with an honest message.
  await page.goto(`${ORIGIN}/sign-in`);
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(pw);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('sign-in-error')).toContainText('Verify your email');
  await admin.updateUser(user.uid, { emailVerified: true });
  await page.goto(`${ORIGIN}/sign-in`);
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(pw);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('finish-account')).toBeVisible();
  await expect(page.getByTestId('finish-name')).toHaveValue(name);
  await page.getByTestId('finish-submit').click();
  await expect(page.getByTestId(role === 'builder' ? 'studies-screen' : 'discover-screen')).toBeVisible();
  return { email, uid: user.uid };
}

test.afterAll(() => {
  // Synthetic fixtures for the record (A5 cleanup list); nothing is deleted.
  console.log(`WEB_LIVE_FIREBASE_UIDS ${JSON.stringify(created)} VERIFICATION_EMAIL ${JSON.stringify(emailOutcomes)}`);
});

test('real Firebase + R2 from the production origin: sign-up → roles → upload → completion → ranged playback → approval; isolation holds', async ({ browser }) => {
  const seen = { mapped: 0, csp: [] as string[] };
  const config = await (await fetch(`${API}/config`)).json();
  // Non-production run against real providers (never the shared demo, never production).
  expect(config).toMatchObject({ authMode: 'firebase', storage: 'r2', firebase: { projectId: 'pocketqa-optijara' } });

  const builderCtx = await browser.newContext();
  await mapOrigin(builderCtx, seen);
  const builder = await builderCtx.newPage();
  await signUpVerifySignIn(builder, 'builder', 'Bea');

  // Non-production test credits (no value) fund the synthetic study; production has them off.
  await builder.getByTestId('tab-budget').click();
  await builder.getByTestId('topup-amount-1000').click();
  await builder.getByTestId('topup-submit').click();
  await expect(builder.getByTestId('credit-balance')).toHaveText('1,000 test credits');
  await builder.getByTestId('tab-studies').click();
  await builder.getByTestId('new-study').click();
  const title = `Web launch live ${run}`;
  await builder.getByTestId('study-title').fill(title);
  await builder.getByTestId('study-objective').fill('Check that a tester can record and upload evidence from the browser.');
  await builder.getByTestId('study-task-0').fill('Open the app and reach the home screen');
  await builder.getByTestId('crit-web').click();
  await builder.getByTestId('study-slots').fill('2');
  await builder.getByTestId('study-save').click();
  await expect(builder.getByTestId('builder-study-screen')).toBeVisible();
  await builder.getByTestId('study-publish').click();
  await builder.getByTestId('confirm-ok').click();
  await expect(builder.getByTestId('study-status')).toContainText('PUBLISHED');

  const testerCtx = await browser.newContext();
  await mapOrigin(testerCtx, seen);
  const tester = await testerCtx.newPage();
  await signUpVerifySignIn(tester, 'tester', 'Tara');
  await tester.getByTestId('tab-settings').click();
  await tester.getByTestId('device-platform-web').click();
  await tester.getByTestId('device-save').click();
  await expect(tester.getByTestId('device-saved')).toBeVisible();
  await tester.getByTestId('tab-discover').click();
  await tester.getByText(title).click();
  await tester.getByTestId('consent-checkbox').click();
  await tester.getByTestId('consent-submit').click();
  await expect(tester.getByTestId('participation-screen')).toBeVisible();
  const sessionUrl = tester.url();
  await tester.getByTestId('session-start').click();
  await expect(tester.getByTestId('session-status')).toContainText('IN PROGRESS');

  // Direct upload: intent → presigned PUT from the browser to R2 (real CORS) → verified completion.
  const r2Puts: Response[] = [];
  tester.on('response', (r) => {
    if (r.request().method() === 'PUT' && /\.r2\.cloudflarestorage\.com\//.test(r.url())) r2Puts.push(r);
  });
  const chooser = tester.waitForEvent('filechooser');
  await tester.getByTestId('attach-evidence').click();
  await (await chooser).setFiles(clip);
  await tester.getByTestId('segment-keep').click();
  await tester.getByTestId('upload-kept').click();
  await expect(tester.getByTestId('uploaded-evidence')).toContainText('Uploaded (1)');
  expect(r2Puts.map((r) => r.status())).toEqual([200]);
  // The browser sent the request from the production origin and R2 allowed it (CORS).
  expect(r2Puts[0]!.request().headers()['origin'] ?? (await r2Puts[0]!.request().allHeaders())['origin']).toBe(ORIGIN);
  await tester.getByTestId('session-submit').click();
  await tester.getByTestId('confirm-ok').click();
  await expect(tester.getByTestId('session-status')).toContainText('AWAITING REVIEW');

  // Role isolation: another real tester cannot open this session (the API answers 404).
  const otherCtx = await browser.newContext();
  await mapOrigin(otherCtx, seen);
  const other = await otherCtx.newPage();
  await signUpVerifySignIn(other, 'tester', 'Omar');
  const participationId = sessionUrl.split('/').pop()!;
  const foreign = other.waitForResponse((r) => r.url().includes(`/api/participations/${participationId}`) && r.request().method() === 'GET');
  await other.goto(sessionUrl);
  expect((await foreign).status()).toBe(404);
  // A tester cannot reach builder pages either.
  await other.goto(`${ORIGIN}/builder/new-study`);
  await expect(other.getByTestId('discover-screen')).toBeVisible();

  // Builder review: the clip plays from the API with HTTP range requests (206), then approval.
  const media: Response[] = [];
  builder.on('response', (r) => {
    if (r.url().startsWith(`${ORIGIN}/api/media/`)) media.push(r);
  });
  await builder.reload();
  const row = builder.locator('[data-testid^="builder-participation-"]');
  await expect(row).toContainText('AWAITING REVIEW');
  await row.click();
  await builder.getByTestId('evidence-view').click();
  // expo-video's web VideoView renders a plain <video> (its testID is not forwarded to the DOM).
  await expect(builder.locator('video')).toBeVisible();
  await expect.poll(() => media.filter((r) => r.status() === 206).length, { timeout: 30_000 }).toBeGreaterThan(0);
  const ranged = media.find((r) => r.status() === 206)!;
  expect(ranged.headers()['content-range']).toMatch(/^bytes \d+-\d+\/\d+$/);
  // The playback state is real: the video element decoded frames of the uploaded clip.
  await expect.poll(async () => builder.locator('video').evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await builder.getByTestId('review-approve').click();
  await builder.getByTestId('confirm-ok').click();
  await expect(builder.getByTestId('review-decided')).toContainText('Approved');
  await tester.reload();
  await expect(tester.getByTestId('approved-notice')).toBeVisible();

  expect(seen.mapped).toBeGreaterThan(0);
  // The production CSP was in force (served by the front door) and nothing was blocked.
  const doc = await builder.request.get(`${WEB}/`);
  expect(doc.headers()['content-security-policy']).toContain("connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://");
  expect(seen.csp).toEqual([]);
  writeFileSync(join(tmpdir(), `pqa-weblive-${run}.json`), JSON.stringify({ uids: created, participationId }));
  await Promise.all([builderCtx.close(), testerCtx.close(), otherCtx.close()]);
});
