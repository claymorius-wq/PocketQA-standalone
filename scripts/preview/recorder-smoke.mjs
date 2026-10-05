// Web recorder smoke for the protected preview (docs/plans/web-screen-audio-recording.md).
//
// SYNTHETIC ONLY: a headless Chromium with fake media devices. The share dialog is auto-accepted,
// the "screen" is a synthetic tab capture, and the "microphone" is a generated tone. No real
// desktop, window or microphone is captured, and nothing is uploaded: the recorder is local only.
//
// It reads the gate password and the demo tester's sign-in from <state>/access.txt (0600), like
// smoke.mjs, and NEVER prints them. Output: PASS/FAIL lines and statuses only.
//
//   PREVIEW_URL=https://pocketqa.optijara.ai node scripts/preview/recorder-smoke.mjs
//   (local rehearsal: PREVIEW_URL=http://localhost:<gate port> PREVIEW_STATE_DIR=.preview-test/<x>)
//
// NON-DESTRUCTIVE: no study is created or joined, and no app data changes. (Joining a demo study
// was tried in rehearsal and rejected: a withdrawn participation can't be re-joined, so it would
// leave the shared demo tester with no studies. The in-app recording flow is covered by the
// desktop Playwright project instead.)
//  1. The permissions-policy header allows the microphone and display capture for this origin only
//     (the camera stays off).
//  2. Gate, then sign in as the demo tester.
//  3. A published demo study's page reports browser recording as available on this origin.
//  4. A synthetic capture probe in that page (screen, microphone, MediaRecorder for 1.5 s) runs on
//     the real origin. It touches no app data, and its tracks are stopped. It is NOT the app's
//     recorder: an injected script calls the browser APIs directly (policy and engine on this
//     origin). The in-app recorder card is covered by the local desktop Playwright project.
/* global window, document, navigator, MediaStream, MediaRecorder -- used only inside page.evaluate (the browser) */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = (process.env.PREVIEW_URL ?? '').replace(/\/$/, '');
if (!base) throw new Error('Set PREVIEW_URL');
const STATE = join(import.meta.dirname, '../..', process.env.PREVIEW_STATE_DIR ?? '.preview');
const access = readFileSync(join(STATE, 'access.txt'), 'utf8');
const gatePassword = access.match(/^Gate password: (\S+)$/m)?.[1];
const tester = access.match(/^Tester:\s+(\S+)\s+\/\s+(\S+)$/m);
if (!gatePassword || !tester) throw new Error('access.txt is missing the gate password or the tester sign-in');

let failed = 0;
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => {
  failed++;
  console.log(`FAIL  ${m}`);
};
const check = (ok, m) => (ok ? pass(m) : fail(m));

console.log(`recorder smoke ${new Date().toISOString()} against ${base}`);
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture'] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
try {
  // 1. Headers on the gate page (every response carries them).
  const first = await page.goto(`${base}/`);
  const pp = (await first.allHeaders())['permissions-policy'] ?? '';
  check(/(^|,\s*)microphone=\(self\)/.test(pp) && /display-capture=\(self\)/.test(pp) && /camera=\(\)/.test(pp), `permissions-policy allows microphone and display-capture for self, camera off`);

  // 2. Gate (the password is typed, never printed), then the app's own sign-in.
  await page.locator('#pw').fill(gatePassword);
  await page.locator('#pw').press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/__gate'), { timeout: 20_000 });
  pass('gate passed');
  await page.goto(`${base}/sign-in`);
  await page.getByTestId('sign-in-email').fill(tester[1]);
  await page.getByTestId('sign-in-password').fill(tester[2]);
  await page.getByTestId('sign-in-submit').click();
  await page.getByTestId('discover-screen').waitFor({ timeout: 20_000 });
  pass('demo tester signed in');

  // 3. A published demo study reports browser recording available on this origin.
  const card = page.locator('[data-testid^="study-card-"]').first();
  if (await card.count()) {
    await card.click();
    await page.getByTestId('web-recording-available').waitFor({ timeout: 20_000 });
    pass('study page: browser recording available (desktop capability on this origin)');
  } else {
    console.log('INFO  no open demo study for this tester; the study-page check was skipped');
  }

  // 4. Synthetic capture probe: the policy and the engine on the real origin (no app data).
  // The probe runs from a real click (user activation), so the button is set up first.
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'pqa-smoke-probe';
    b.textContent = 'probe';
    document.body.appendChild(b);
    window.__pqaProbe = new Promise((done) => {
      b.onclick = async () => {
        try {
          const d = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false });
          const m = await navigator.mediaDevices.getUserMedia({ audio: true });
          const s = new MediaStream([d.getVideoTracks()[0], m.getAudioTracks()[0]]);
          const r = new MediaRecorder(s);
          const parts = [];
          r.ondataavailable = (e) => e.data.size && parts.push(e.data);
          await new Promise((ok) => {
            r.onstop = ok;
            r.start(500);
            setTimeout(() => r.stop(), 1500);
          });
          [...d.getTracks(), ...m.getTracks()].forEach((t) => t.stop());
          done({ ok: true, mime: r.mimeType, bytes: parts.reduce((n, p) => n + p.size, 0) });
        } catch (e) {
          done({ ok: false, error: `${e.name}: ${e.message}` });
        } finally {
          b.remove();
        }
      };
    });
  });
  await page.click('#pqa-smoke-probe');
  const result = await page.evaluate(() => window.__pqaProbe).catch((e) => ({ ok: false, error: String(e) }));
  check(result.ok && result.bytes > 0, `synthetic capture probe on this origin: ${result.ok ? `${result.mime}, ${result.bytes} bytes` : result.error}`);


} catch (e) {
  fail(`unexpected: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
