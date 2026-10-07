/* global document, localStorage -- evidence copy: these run inside the page (Playwright evaluate/addInitScript) */
/* eslint-disable no-empty -- evidence copy kept verbatim (lint-only header; no code changed) */
// pqa-ios full-e2e WEB regression on production (https://pocketqa.vercel.app), real UI, Chromium.
// Synthetic accounts only; credentials read from the env files in memory and never printed or
// screenshotted while visible. Usage: node regression.mjs <viewport: desktop|mobile> <outDir>
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const require = createRequire(process.env.PW_FROM + '/package.json');
const { chromium, devices } = require('@playwright/test');

const VIEWPORT = process.argv[2];
const OUT = process.argv[3];
const BASE = 'https://pocketqa.vercel.app';
const run = `${VIEWPORT}-${Date.now().toString(36)}`;
mkdirSync(OUT, { recursive: true });
const creds = (f) => Object.fromEntries(readFileSync(join(homedir(), '.config/pocketqa', f), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')]));
const TESTER = creds('qa-synthetic-tester.env');
const BUILDER = creds('qa-synthetic-builder.env');

// A real 24x24 PNG so the server's magic-byte check sees an image (synthetic content only).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAH0lEQVR4nGNQNlpCFcQwatCoQaMGjRo0atCoQcPNIADPXyM9QJM8cAAAAABJRU5ErkJggg==', 'base64');
const pngPath = join(OUT, `synthetic-evidence-${run}.png`);
writeFileSync(pngPath, PNG);

const ctxOpts = VIEWPORT === 'mobile' ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 900 } };
const browser = await chromium.launch();
const results = [];
const mk = async (role, scheme) => {
  const ctx = await browser.newContext({ ...ctxOpts, colorScheme: scheme, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('pocketqa.introSeen', '1'); } catch {} });
  const page = await ctx.newPage();
  const log = { console: [], failed: [], http: [] };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => log.console.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('requestfailed', (r) => log.failed.push(`${r.method()} ${r.url().split('?')[0]} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => { if (r.status() >= 400) log.http.push(`${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`); });
  // Request-level trace of every storage call (R2) and upload-intent call: method, status, timing.
  page.on('request', (r) => { if (/r2\.cloudflarestorage|upload-intents|uploads/.test(r.url())) (globalThis.R2 ??= []).push({ t: Date.now(), ev: 'request', role, method: r.method(), url: r.url().split('?')[0].replace(/^https:\/\/[^/]+/, '') }); });
  page.on('requestfinished', async (r) => { if (/r2\.cloudflarestorage|upload-intents|uploads/.test(r.url())) { const res = await r.response().catch(() => null); (globalThis.R2 ??= []).push({ t: Date.now(), ev: 'finished', role, method: r.method(), status: res?.status() ?? null, url: r.url().split('?')[0].replace(/^https:\/\/[^/]+/, '') }); } });
  page.on('requestfailed', (r) => { if (/r2\.cloudflarestorage|upload-intents|uploads/.test(r.url())) (globalThis.R2 ??= []).push({ t: Date.now(), ev: 'failed', role, method: r.method(), err: r.failure()?.errorText, url: r.url().split('?')[0].replace(/^https:\/\/[^/]+/, '') }); });
  return { ctx, page, log, role };
};
const B = await mk('builder', 'light');
const T = await mk('tester', 'dark');
const drain = (p) => { const o = { console: [...p.log.console], failed: [...p.log.failed], http: [...p.log.http] }; p.log.console.length = 0; p.log.failed.length = 0; p.log.http.length = 0; return o; };
let blocked = null;
async function step(id, title, who, fn, { requires = true } = {}) {
  const r = { id, viewport: VIEWPORT, title, at: new Date().toISOString(), status: 'PASS', observed: null, error: null };
  if (blocked && requires) {
    r.status = 'NOT RUN';
    r.error = `prerequisite failed: ${blocked}`;
  } else {
    try {
      r.observed = await fn();
    } catch (e) {
      r.status = 'FAIL';
      r.error = String(e.message ?? e).split('\n').slice(0, 4).join(' | ').slice(0, 600);
      if (requires) blocked = id;
    }
  }
  for (const p of who) {
    try {
      await p.page.waitForTimeout(500);
      // Never photograph a sign-in form holding a credential.
      const filled = await p.page.evaluate(() => [...document.querySelectorAll('[data-testid="sign-in-email"],[data-testid="sign-in-password"]')].some((e) => e.value));
      if (filled) throw new Error('skip shot: sign-in form filled');
      const f = `${id}-${p.role}.png`;
      await p.page.screenshot({ path: join(OUT, f), fullPage: true });
      (r.shots ??= []).push(f);
    } catch {}
    r[`${p.role}Log`] = drain(p);
  }
  r.url = Object.fromEntries(who.map((p) => [p.role, p.page.url().replace(BASE, '')]));
  results.push(r);
  console.log(`${r.status.padEnd(7)} ${id} ${title}${r.error ? ' :: ' + r.error.slice(0, 200) : ''}`);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
}
const txt = async (p, id) => (await p.page.getByTestId(id).first().innerText()).replace(/\s+/g, ' ').trim();
const vis = (p, id) => p.page.getByTestId(id).first().waitFor({ state: 'visible', timeout: 25_000 });

async function signIn(p, who) {
  await p.page.goto(`${BASE}/sign-in`);
  await vis(p, 'sign-in-screen');
  const google = await p.page.getByTestId('sign-in-google').isVisible();
  await p.page.screenshot({ path: join(OUT, `sign-in-empty-${p.role}.png`), fullPage: true }); // before any typing
  await p.page.getByTestId('sign-in-email').fill(who.QA_TESTER_EMAIL);
  await p.page.getByTestId('sign-in-password').fill(who.QA_TESTER_PASSWORD);
  await p.page.getByTestId('sign-in-submit').click();
  // Leave the filled form before any screenshot.
  await p.page.waitForFunction(() => !document.querySelector('[data-testid="sign-in-screen"]'), null, { timeout: 30_000 });
  return { googleButtonVisible: google };
}

const studyTitle = `QA synthetic web regression ${run}`;
const ledger = {};

await step('W-10', 'Builder signs in (Google button visible, not used)', [B], async () => {
  const g = await signIn(B, BUILDER);
  await vis(B, 'studies-screen');
  if (!g.googleButtonVisible) throw new Error('Google button (sign-in-google) not visible');
  return { ...g, landed: 'studies-screen' };
});
await step('W-11', 'Builder budget before (test-credit ledger)', [B], async () => {
  await B.page.getByTestId('tab-budget').click();
  await vis(B, 'credit-balance');
  ledger.builderBefore = await txt(B, 'credit-balance');
  return { builderBalance: ledger.builderBefore, budgetCard: (await B.page.getByTestId('budget-card').count()) ? await txt(B, 'budget-card') : null };
});
let studyUrl = null;
await step('W-12', 'Builder creates a small test-credit study (1 slot) and publishes it', [B], async () => {
  await B.page.getByTestId('tab-studies').click();
  await B.page.getByTestId('new-study').click();
  await vis(B, 'new-study-screen');
  await B.page.getByTestId('study-title').fill(studyTitle);
  await B.page.getByTestId('study-objective').fill('QA synthetic objective: check the web regression journey end to end.');
  await B.page.getByTestId('study-task-0').fill('Open the home screen and describe what you see');
  await B.page.getByTestId('crit-web').click();
  await B.page.getByTestId('study-slots').fill('1');
  const reward = await B.page.getByTestId('study-reward').inputValue().catch(() => null);
  const pool = (await B.page.getByTestId('study-pool').count()) ? await txt(B, 'study-pool') : null;
  await B.page.getByTestId('study-save').click();
  await vis(B, 'builder-study-screen');
  const draft = await txt(B, 'study-status');
  await B.page.getByTestId('study-publish').click();
  await B.page.getByTestId('confirm-ok').click();
  await B.page.getByTestId('study-status').filter({ hasText: 'PUBLISHED' }).waitFor({ timeout: 25_000 });
  studyUrl = B.page.url();
  const reserved = (await B.page.getByTestId('budget-reserved').count()) ? await txt(B, 'budget-reserved') : null;
  return { title: studyTitle, rewardField: reward, pool, statusAfterSave: draft, statusAfterPublish: await txt(B, 'study-status'), budgetReserved: reserved, url: studyUrl.replace(BASE, '') };
});
await step('W-13', 'Tester signs in; ledger before', [T], async () => {
  await signIn(T, TESTER);
  await vis(T, 'discover-screen');
  await T.page.goto(`${BASE}/credits`);
  await vis(T, 'credit-balance');
  ledger.testerBefore = await txt(T, 'credit-balance');
  return { testerBalance: ledger.testerBefore };
});
await step('W-14', 'Eligibility: web-only study hidden for an Android profile, shown after saving a web profile', [T], async () => {
  await T.page.goto(`${BASE}/`);
  await vis(T, 'discover-screen');
  const chipBefore = (await T.page.getByTestId('device-matched').count()) ? await txt(T, 'device-matched') : null;
  const card = T.page.locator('[data-testid^="study-card-"]').filter({ hasText: studyTitle });
  const before = await card.count();
  await T.page.getByTestId('tab-settings').click();
  await vis(T, 'device-form');
  await T.page.getByTestId('device-platform-web').click();
  await T.page.getByTestId('device-os').fill('Chromium (QA synthetic)');
  await T.page.getByTestId('device-model').fill('Desktop browser');
  await T.page.getByTestId('device-save').click();
  await vis(T, 'device-saved');
  await T.page.getByTestId('tab-discover').click();
  await vis(T, 'discover-screen');
  await card.first().waitFor({ timeout: 25_000 });
  return { chipBefore, studyCardBeforeWebProfile: before, chipAfter: await txt(T, 'device-matched'), studyCardAfterWebProfile: await card.count() };
});
await step('W-15', 'Tester opens the study, consents (checkbox gate) and joins', [T], async () => {
  await T.page.locator('[data-testid^="study-card-"]').filter({ hasText: studyTitle }).first().click();
  await vis(T, 'study-detail-screen');
  const disclaimer = await txt(T, 'reward-disclaimer');
  const disabledBefore = await T.page.getByTestId('consent-submit').isDisabled();
  await T.page.getByTestId('consent-checkbox').click();
  const ariaChecked = await T.page.getByTestId('consent-checkbox').getAttribute('aria-checked');
  await T.page.getByTestId('consent-submit').click();
  await vis(T, 'participation-screen');
  return { disclaimer, consentSubmitDisabledBeforeTick: disabledBefore, ariaCheckedAfterTick: ariaChecked, status: await txt(T, 'session-status') };
});
await step('W-16', 'Tester starts the session and saves a task note', [T], async () => {
  await T.page.getByTestId('session-start').click();
  await T.page.getByTestId('session-status').filter({ hasText: /IN PROGRESS/i }).waitFor({ timeout: 25_000 });
  await T.page.getByTestId('task-note-0').fill('QA synthetic note (web regression): the home screen loaded; the main button label was clear.');
  await T.page.getByTestId('task-note-save-0').click();
  await T.page.getByTestId('task-note-save-0').filter({ hasText: 'Saved' }).waitFor({ timeout: 25_000 });
  await T.page.reload();
  await vis(T, 'participation-screen');
  const persisted = await T.page.getByTestId('task-note-0').inputValue();
  if (!persisted.startsWith('QA synthetic note')) throw new Error(`note not persisted after reload: ${persisted.slice(0, 40)}`);
  return { status: await txt(T, 'session-status'), noteAfterReload: persisted.slice(0, 60) };
});
await step('W-17', 'Tester attaches a synthetic PNG, keeps it and uploads it to private R2', [T], async () => {
  const chooser = T.page.waitForEvent('filechooser');
  await T.page.getByTestId('attach-evidence').click();
  await (await chooser).setFiles(pngPath);
  await T.page.getByTestId('segment-recorded').first().waitFor({ timeout: 25_000 });
  const pending = await txt(T, 'pending-evidence');
  const submitDisabledWhilePending = await T.page.getByTestId('session-submit').isDisabled();
  await T.page.getByTestId('segment-keep').click();
  await T.page.getByTestId('upload-kept').click();
  await T.page.getByTestId('uploaded-evidence').filter({ hasText: 'Uploaded (1)' }).waitFor({ timeout: 45_000 });
  return { pendingBeforeKeep: pending, submitDisabledWhilePending, uploaded: await txt(T, 'uploaded-evidence') };
});
await step('W-18', 'Tester submits the participation', [T], async () => {
  await T.page.getByTestId('session-submit').click();
  await T.page.getByTestId('confirm-ok').click();
  await T.page.getByTestId('session-status').filter({ hasText: /AWAITING REVIEW/i }).waitFor({ timeout: 25_000 });
  return { status: await txt(T, 'session-status'), awaiting: await txt(T, 'awaiting-review') };
});
await step('W-19', 'Builder reviews: note, private evidence playback, finding, approve', [B], async () => {
  await B.page.goto(studyUrl);
  await vis(B, 'builder-study-screen');
  const row = B.page.locator('[data-testid^="builder-participation-"]').first();
  await row.filter({ hasText: /AWAITING REVIEW/i }).waitFor({ timeout: 25_000 });
  await row.click();
  await vis(B, 'review-screen');
  const note = await txt(B, 'review-note-0');
  const ai = (await B.page.getByTestId('ai-unavailable').count()) ? await txt(B, 'ai-unavailable') : null;
  const items = await B.page.getByTestId('evidence-item').count();
  await B.page.getByTestId('evidence-view').first().click();
  await vis(B, 'evidence-media');
  const img = await B.page.getByTestId('evidence-media').first().evaluate((el) => {
    const i = el.tagName === 'IMG' ? el : el.querySelector('img');
    return i ? { tag: 'img', complete: i.complete, naturalWidth: i.naturalWidth, srcHost: new URL(i.currentSrc || i.src).host } : { tag: el.tagName };
  });
  await B.page.getByTestId('finding-title').fill('QA synthetic finding: main button label');
  await B.page.getByTestId('finding-description').fill('Synthetic web regression finding; no real issue.');
  await B.page.getByTestId('finding-submit').click();
  await B.page.getByTestId('finding-item').filter({ hasText: 'QA synthetic finding' }).waitFor({ timeout: 25_000 });
  await B.page.getByTestId('review-approve').click();
  await B.page.getByTestId('confirm-ok').click();
  await B.page.getByTestId('review-decided').filter({ hasText: 'Approved' }).waitFor({ timeout: 25_000 });
  return { note: note.slice(0, 80), ai, evidenceItems: items, evidenceMedia: img, decided: await txt(B, 'review-decided') };
});
await step('W-20', 'Ledger after: tester credited once, builder awarded; tester sees approval + finding', [T, B], async () => {
  await T.page.reload();
  await vis(T, 'approved-notice');
  const approved = await txt(T, 'approved-notice');
  const findingVisible = await T.page.getByText('QA synthetic finding: main button label').first().isVisible();
  await T.page.goto(`${BASE}/credits`);
  await vis(T, 'credit-balance');
  ledger.testerAfter = await txt(T, 'credit-balance');
  await B.page.goto(studyUrl);
  await vis(B, 'builder-study-screen');
  const awarded = (await B.page.getByTestId('budget-awarded').count()) ? await txt(B, 'budget-awarded') : null;
  const reserved = (await B.page.getByTestId('budget-reserved').count()) ? await txt(B, 'budget-reserved') : null;
  await B.page.goto(`${BASE}/budget`);
  await vis(B, 'credit-balance');
  ledger.builderAfter = await txt(B, 'credit-balance');
  return { approved, findingVisible, testerBefore: ledger.testerBefore, testerAfter: ledger.testerAfter, builderBefore: ledger.builderBefore, builderAfter: ledger.builderAfter, studyBudgetAwarded: awarded, studyBudgetReserved: reserved };
}, { requires: true });
await step('W-21', 'Tester reputation page', [T], async () => {
  await T.page.goto(`${BASE}/reputation`);
  await vis(T, 'reputation-screen');
  return { points: await txt(T, 'reputation-points'), hero: (await txt(T, 'reputation-hero')).slice(0, 120) };
}, { requires: false });
await step('W-22', 'Tester settings: data export', [T], async () => {
  await T.page.getByTestId('tab-settings').click().catch(async () => T.page.goto(`${BASE}/settings`));
  await vis(T, 'settings-screen');
  const dl = T.page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
  await T.page.getByTestId('export-data').click();
  await vis(T, 'export-done');
  const d = await dl;
  let file = null;
  if (d) {
    const p = join(OUT, `export-${run}.json`);
    await d.saveAs(p);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    file = { suggested: d.suggestedFilename(), topKeys: Object.keys(j).slice(0, 12), bytes: readFileSync(p).length };
    writeFileSync(p, '(export content not kept in evidence; keys recorded in results.json)\n');
  }
  return { exportDone: await txt(T, 'export-done'), download: file };
}, { requires: false });
await step('W-23', 'Sign-out (both roles) and private-route denial after sign-out', [T, B], async () => {
  const out = {};
  for (const p of [T, B]) {
    await p.page.goto(`${BASE}/${p.role === 'builder' ? 'builder-settings' : 'settings'}`);
    await p.page.getByTestId('sign-out').first().waitFor({ timeout: 25_000 });
    await p.page.getByTestId('sign-out').click();
    await p.page.getByTestId('sign-in-screen').or(p.page.getByTestId('welcome-screen')).first().waitFor({ timeout: 25_000 });
    await p.page.goto(`${BASE}/credits`);
    await p.page.waitForTimeout(2500);
    out[p.role] = { afterSignOutUrl: p.page.url().replace(BASE, ''), creditsVisible: await p.page.getByTestId('credit-balance').count(), signInVisible: await p.page.getByTestId('sign-in-screen').count() };
    if (out[p.role].creditsVisible) throw new Error(`${p.role}: /credits still shows a balance after sign-out`);
  }
  return out;
}, { requires: false });

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
writeFileSync(join(OUT, 'r2-trace.json'), JSON.stringify(globalThis.R2 ?? [], null, 2));
await browser.close();
