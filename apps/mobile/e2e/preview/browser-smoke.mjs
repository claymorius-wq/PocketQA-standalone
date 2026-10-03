// Browser smoke for the protected preview (Chromium). Prints results only, never a secret.
//   PREVIEW_URL=http://localhost:<gate port> node e2e/preview/browser-smoke.mjs
// Reads the gate password and demo sign-ins from .preview/access.txt. Screenshots are taken
// only when no secret is on screen (password fields are masked anyway).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.PREVIEW_URL;
const origin = new URL(BASE).origin;
const repo = join(import.meta.dirname, '../../../..');
const SHOTS = join(repo, process.env.PREVIEW_SHOTS_DIR ?? 'docs/reviews/preview');
mkdirSync(SHOTS, { recursive: true });
const access = readFileSync(join(repo, process.env.PREVIEW_STATE_DIR ?? '.preview', 'access.txt'), 'utf8');
// PREVIEW_EXPECT_CONVENIENCE=1: every role must be reachable with clicks only (no typing).
const CONVENIENCE = process.env.PREVIEW_EXPECT_CONVENIENCE === '1';
const gatePassword = access.match(/^Gate password: (\S+)$/m)[1];
const acct = (role) => access.match(new RegExp(`^${role}:\\s+(\\S+)\\s+/\\s+(\\S+)$`, 'm')).slice(1, 3);

console.log(`started ${new Date().toISOString()} against ${process.env.PREVIEW_URL}`);
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
};

const browser = await chromium.launch();
const foreign = [];
const cspErrors = [];

async function gatedPage(colorScheme = 'light') {
  const ctx = await browser.newContext({ colorScheme, viewport: { width: 412, height: 860 } });
  const page = await ctx.newPage();
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== origin && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) foreign.push(r.url());
  });
  page.on('console', (m) => /Content Security Policy|Refused to/i.test(m.text()) && cspErrors.push(m.text()));
  await page.goto(BASE + '/');
  await page.waitForURL('**/__gate/login');
  if (!CONVENIENCE) await page.fill('#pw', gatePassword);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/__gate'));
  return { ctx, page };
}

// Lists load after the screen mounts, so wait for the text rather than counting at once.
const shows = (page, text) => page.getByText(text).first().waitFor({ timeout: 10_000 }).then(() => true, () => false);

async function appSignIn(page, [email, password], role) {
  if (CONVENIENCE) {
    // Clicks only: pick the role, check the fields were filled for us, press Sign in.
    await page.getByTestId('demo-accounts').waitFor();
    await page.getByTestId(`demo-role-${role}`).click();
    check(`${role}: demo sign-in prefilled by the role picker`, (await page.getByTestId('sign-in-email').inputValue()) === email);
  } else {
    await page.getByTestId('sign-in-email').fill(email);
    await page.getByTestId('sign-in-password').fill(password);
  }
  await page.getByTestId('sign-in-submit').click();
}

// 1. Gate page, unauthenticated.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
  const page = await ctx.newPage();
  const res = await page.goto(BASE + '/builder/review/anything');
  check('unauthenticated deep link lands on the gate login page', new URL(page.url()).pathname === '/__gate/login' && res.status() === 200);
  check('app bundle not served before the gate', !(await page.content()).includes('_expo/static'));
  await page.screenshot({ path: join(SHOTS, CONVENIENCE ? 'gate-login-prefilled.png' : 'gate-login.png') });
  if (CONVENIENCE) check('gate password field is prefilled', (await page.inputValue('#pw')).length > 0);
  await page.fill('#pw', 'not-the-password');
  await page.click('button[type=submit]');
  check('wrong gate password shows an error and stays on the gate', (await page.textContent('[role=alert]'))?.includes('Wrong password') && new URL(page.url()).pathname === '/__gate/login');
  const cookies = await ctx.cookies();
  check('no gate cookie after a wrong password', cookies.length === 0);
  await ctx.close();
}

// 2. Tester.
{
  const { ctx, page } = await gatedPage('dark');
  const [c] = await ctx.cookies();
  check('gate cookie is HttpOnly, Secure, SameSite=Strict', !!c && c.httpOnly && c.secure && c.sameSite === 'Strict' && c.name === '__Host-pqa_gate');
  await page.getByTestId('sign-in-email').waitFor();
  if (CONVENIENCE) {
    await page.getByTestId('demo-accounts').waitFor();
    check('tester sign-in is prefilled by default', (await page.getByTestId('sign-in-email').inputValue()) === acct('Tester')[0]);
    check('sign-in footer says public demo preview', await shows(page, /Public demo preview/));
    await page.screenshot({ path: join(SHOTS, 'sign-in-demo-picker-dark.png') });
  }
  await appSignIn(page, acct('Tester'), 'tester');
  await page.getByTestId('discover-screen').waitFor();
  check('tester sees Discover with the demo study', await shows(page, 'Demo: onboarding screens'));
  check('rewards are labelled test credits, not guaranteed', (await shows(page, /test credits/)) && (await shows(page, /Not guaranteed/)));
  await page.screenshot({ path: join(SHOTS, 'tester-discover-dark.png') });
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('wallet-unavailable').scrollIntoViewIfNeeded();
  check('wallet section says devnet only, and that linking is not a payment', (await shows(page, /Solana devnet only/)) && (await shows(page, /it is not a payment/)));
  await page.screenshot({ path: join(SHOTS, 'tester-settings-devnet-dark.png') });
  await ctx.close();
}

// 3. Builder.
{
  const { ctx, page } = await gatedPage();
  await page.getByTestId('sign-in-email').waitFor();
  await appSignIn(page, acct('Builder'), 'builder');
  await page.getByTestId('studies-screen').waitFor();
  check('builder sees their demo studies', await shows(page, 'Demo: checkout flow'));
  await page.screenshot({ path: join(SHOTS, 'builder-studies.png') });
  await ctx.close();
}

// 4. Admin.
{
  const { ctx, page } = await gatedPage();
  await page.getByTestId('sign-in-email').waitFor();
  await appSignIn(page, acct('Admin'), 'admin');
  await page.getByTestId('disputes-screen').waitFor();
  await page.getByTestId('tab-stuck').click();
  await page.getByTestId('stuck-screen').waitFor();
  check('admin reaches the admin tabs (Disputes, Stuck)', true);
  await page.screenshot({ path: join(SHOTS, 'admin-stuck.png') });
  await ctx.close();
}

check(`no request left the preview origin (${foreign.length} foreign)`, foreign.length === 0);
if (foreign.length) console.log(foreign.slice(0, 5).map((u) => new URL(u).origin).join('\n'));
check(`no CSP violations (${cspErrors.length})`, cspErrors.length === 0);
if (cspErrors.length) console.log(cspErrors.slice(0, 3).join('\n'));
await browser.close();
console.log(`finished ${new Date().toISOString()}`);
console.log(failed ? `${failed} check(s) FAILED` : 'all browser checks passed');
process.exit(failed ? 1 : 0);
