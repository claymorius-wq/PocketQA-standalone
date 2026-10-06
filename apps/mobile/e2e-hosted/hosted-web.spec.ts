import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_CSP, securityHeaders } from '../../../scripts/production/security-headers.mjs';
import { hostedAppCsp } from '../../../scripts/vercel/config.mjs';

// The real hosted web build, served under the hosted headers (playwright.hosted.config.ts): it must
// load with zero CSP violations and no console errors, show sign-in, reach /api same-origin, and
// complete a Firebase (emulator) sign-up → verify → sign-in → tester account → tester home.
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const PROJECT = 'demo-pocketqa';
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const pw = 'correct horse battery staple';
const OUTPUT = process.env.PQA_HOSTED_OUTPUT ?? join(__dirname, '../../../.vercel/output');
const built = JSON.parse(readFileSync(join(OUTPUT, 'config.json'), 'utf8'));

type Violation = { directive: string; blocked: string; source: string; line: number; sample: string };

/** Records every CSP violation (from the first byte of every document) and every console error. */
async function watch(page: Page) {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  // Which request a "Failed to load resource" console error belongs to.
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: unknown[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push({ directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber, sample: e.sample });
    });
  });
  return {
    consoleErrors,
    failed,
    violations: () => page.evaluate(() => (window as unknown as { __csp: Violation[] }).__csp),
  };
}

async function verifyEmail(email: string) {
  const codes = (await (await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json()) as { oobCodes: { email: string; requestType: string; oobLink: string }[] };
  const code = codes.oobCodes.filter((c) => c.email === email && c.requestType === 'VERIFY_EMAIL').pop();
  if (!code) throw new Error('no verification email recorded');
  expect((await fetch(code.oobLink)).ok).toBe(true);
}

test('hosted headers on / and /api/config match the shared definitions', async ({ request }) => {
  const page = await request.get('/');
  expect(page.status()).toBe(200);
  const api = await request.get('/api/config');
  expect(api.status()).toBe(200);
  for (const [k, v] of Object.entries(securityHeaders() as Record<string, string>)) {
    expect(page.headers()[k], `/ ${k}`).toBe(v);
    expect(api.headers()[k], `/api/config ${k}`).toBe(v);
  }
  // The app CSP is the deployment's, exactly, plus only the emulator origin (test hook).
  expect(built.routes[0].headers['content-security-policy']).toBe(hostedAppCsp(ACCOUNT, 'pqa-test'));
  expect(page.headers()['content-security-policy']).toBe(hostedAppCsp(ACCOUNT, 'pqa-test').replace(/(connect-src [^;]*)/, `$1 ${AUTH}`));
  expect(api.headers()['content-security-policy']).toBe(API_CSP);
  expect(api.headers()['cache-control']).toBe('no-store');
  const cfg = await api.json();
  expect(cfg).toMatchObject({ authMode: 'firebase', storage: 'r2' });
});

test('the built app loads with zero CSP violations; sign-up → verify → sign-in → tester home', async ({ page }) => {
  const seen = await watch(page);
  await page.goto('/');
  await expect(page.getByTestId('sign-in-email')).toBeVisible();
  await expect(page.getByText('Sign-in is managed by Firebase', { exact: false })).toBeVisible();

  const email = `hosted-${Date.now()}@example.test`;
  await page.goto('/sign-up');
  await page.getByTestId('sign-up-name').fill('Hosted Tester');
  await page.getByTestId('sign-up-email').fill(email);
  await page.getByTestId('sign-up-password').fill(pw);
  await page.getByTestId('sign-up-submit').click();
  await expect(page.getByTestId('sign-up-verify')).toContainText('Check your email');
  await verifyEmail(email);

  await page.goto('/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(pw);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('finish-account')).toContainText('Finish your account');
  await page.getByTestId('finish-role').getByText('I test apps').click();
  await page.getByTestId('finish-submit').click();
  await expect(page.getByTestId('discover-screen')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('discover-screen')).toBeVisible();

  const violations = await seen.violations();
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  // The one expected failed request: before "Finish your account", the API answers the session
  // lookup with 404 (no Pocket QA account uses this sign-in yet), which the browser logs itself.
  expect(seen.failed).toEqual(['404 POST /api/auth/identity/session']);
  expect(seen.consoleErrors).toEqual(['Failed to load resource: the server responded with a status of 404 (Not Found)']);
});
