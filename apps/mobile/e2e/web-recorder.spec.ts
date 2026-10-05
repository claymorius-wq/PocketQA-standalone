import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The desktop web recorder in REAL Chromium (MediaRecorder, getDisplayMedia, getUserMedia), with
// SYNTHETIC media from the browser's fake-device flags (playwright.config.ts, desktop-recorder):
// a test-pattern screen and a tone for the microphone. No real screen, window, tab content or
// microphone is captured, and the real OS/browser chooser UI is NOT exercised (it is auto-accepted).
// The downloaded file is checked with ffprobe/ffmpeg (docs/plans/web-screen-audio-recording.md).
const API = 'http://127.0.0.1:8787';
const OUT = join(__dirname, '../../../docs/reviews/screen-recording');
mkdirSync(OUT, { recursive: true });
const PROBE = join(OUT, 'ffprobe.txt');
const run = Date.now().toString(36);
let n = 0;

/** A builder's published study with a tester in progress on it, through the real local API. */
async function seed(request: APIRequestContext) {
  const post = async (path: string, token: string | null, data: unknown, method = 'POST') => {
    const r = await request.fetch(`${API}${path}`, { method, data, headers: token ? { authorization: `Bearer ${token}` } : {} });
    expect(r.ok(), `${method} ${path} → ${r.status()}`).toBe(true);
    return r.json();
  };
  const reg = (role: string) => post('/auth/register', null, { email: `rec-${role}-${run}-${++n}@example.test`, password: 'correct horse battery staple', displayName: `Rec ${role} ${n}`, role });
  const b = await reg('builder');
  await post('/me/credits/test-topup', b.token, { amount: 1000 });
  const study = await post('/studies', b.token, {
    title: `Checkout narration ${run}-${n}`,
    objective: 'Find where first-time buyers hesitate during checkout.',
    tasks: [{ instruction: 'Add an item to the cart and check out' }],
    deviceCriteria: { platforms: ['web'], minAndroidApi: 29, languages: ['en'] },
    rewardCredits: 50,
    slots: 1,
    consentText: 'I agree to record my screen only while doing these tasks, and to review clips before upload.',
  });
  await post(`/studies/${study.id}/publish`, b.token, null);
  const t = await reg('tester');
  await post('/me/device', t.token, { platform: 'web', osVersion: 'Chrome', androidApiLevel: null, model: 'Desktop browser', languages: ['en-US'] }, 'PUT');
  const p = await post(`/studies/${study.id}/consent`, t.token, { consentVersion: 1, accepted: true });
  await post(`/participations/${p.id}/start`, t.token, null);
  return { email: t.user.email as string, participationId: p.id as string };
}

/** Records how the page calls the media APIs, and keeps the streams so the test can check release. */
async function instrument(page: Page, mic: 'allow' | 'deny' = 'allow') {
  await page.addInitScript((micMode) => {
    const w = window as unknown as { __pqa: { displayCalls: { active: boolean | null }[]; micCalls: number; display: MediaStream | null; mic: MediaStream | null } };
    w.__pqa = { displayCalls: [], micCalls: 0, display: null, mic: null };
    const md = navigator.mediaDevices;
    const gdm = md.getDisplayMedia.bind(md);
    const gum = md.getUserMedia.bind(md);
    md.getDisplayMedia = (o?: DisplayMediaStreamOptions) => {
      w.__pqa.displayCalls.push({ active: (navigator as unknown as { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? null });
      return gdm(o).then((s) => ((w.__pqa.display = s), s));
    };
    md.getUserMedia = (o?: MediaStreamConstraints) => {
      w.__pqa.micCalls++;
      if (micMode === 'deny') return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      return gum(o).then((s) => ((w.__pqa.mic = s), s));
    };
  }, mic);
}
const tracksState = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __pqa: { display: MediaStream | null; mic: MediaStream | null } };
    return [...(w.__pqa.display?.getTracks() ?? []), ...(w.__pqa.mic?.getTracks() ?? [])].map((t) => `${t.kind}:${t.readyState}`);
  });

async function openSession(page: Page, email: string, participationId: string) {
  await page.goto('/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill('correct horse battery staple');
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('discover-screen')).toBeVisible();
  // In-app navigation (no reload), so leaving the session later is a real unmount in this page.
  await page.getByTestId('tab-work').click();
  await page.getByTestId(`participation-card-${participationId}`).click();
  await expect(page.getByTestId('web-recorder')).toBeVisible();
}
async function consentAndStart(page: Page) {
  await expect(page.getByTestId('web-rec-start')).toBeDisabled();
  await page.getByTestId('web-rec-consent').click();
  await expect(page.getByTestId('web-rec-consent')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('web-rec-start').click();
  await expect(page.getByTestId('web-rec-status')).toContainText('Recording ·');
}
async function shot(page: Page, name: string) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}

test('record a synthetic screen with a synthetic microphone, stop, replay, download: a real file with video and audio, nothing sent', async ({ browser, request }) => {
  const { email, participationId } = await seed(request);
  const ctx = await browser.newContext({ colorScheme: 'light', acceptDownloads: true });
  const page = await ctx.newPage();
  await instrument(page);
  await openSession(page, email, participationId);
  await expect(page.getByTestId('web-rec-privacy')).toContainText('Everything visible in what you share is recorded');
  await shot(page, 'web-recorder-consent-light');

  // Nothing is asked for before the click (T1).
  expect(await page.evaluate(() => (window as unknown as { __pqa: { displayCalls: unknown[] } }).__pqa.displayCalls.length)).toBe(0);
  // Anything that could carry the recording out: a non-GET request or any request with a body.
  // (The page's own reads of its local blob: URL by the player and the download are recorded
  // apart; they never leave the browser.)
  const sent: string[] = [];
  const localReads: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' || r.postData()) sent.push(`${r.method()} ${r.url()}`);
    else if (r.url().startsWith('blob:')) localReads.push(r.url().replace(/[0-9a-f-]{36}$/, '<id>'));
  });
  await consentAndStart(page);
  // The screen was requested inside the click (user activation live), and the mic after it (T1, T2).
  const calls = await page.evaluate(() => (window as unknown as { __pqa: { displayCalls: { active: boolean | null }[]; micCalls: number } }).__pqa);
  expect(calls.displayCalls).toEqual([{ active: true }]);
  expect(calls.micCalls).toBe(1);
  await page.waitForTimeout(3500);
  await expect(page.getByTestId('web-rec-status')).toContainText(/Recording · 00:0[2-9] \/ 15:00/);
  await shot(page, 'web-recorder-recording-light');
  await page.getByTestId('web-rec-stop').click();
  await expect(page.getByTestId('web-rec-review')).toContainText('Recording ready');
  await expect(page.getByTestId('web-rec-ended')).toHaveCount(0);
  // Every device is released once the recording stops (T7).
  expect(await tracksState(page)).toEqual(['video:ended', 'audio:ended']);
  await shot(page, 'web-recorder-review-light');

  // Replay: the browser's own player decodes the local blob and plays it.
  const replay = await page.evaluate(async () => {
    const v = document.querySelector('[data-testid="web-rec-player"]') as HTMLVideoElement;
    if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    // MediaRecorder WebM carries no duration header; seeking to the end makes the browser compute it.
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e9;
      await new Promise((r) => v.addEventListener('durationchange', r, { once: true }));
    }
    const duration = v.duration;
    v.currentTime = 0;
    v.muted = true; // headless autoplay; the audio itself is verified with ffmpeg below
    await v.play();
    await new Promise((r) => setTimeout(r, 700));
    const t = v.currentTime;
    v.pause();
    return { duration, played: t, error: v.error?.code ?? null, src: v.currentSrc.slice(0, 5), w: v.videoWidth, h: v.videoHeight };
  });
  expect(replay.error).toBeNull();
  expect(replay.src).toBe('blob:');
  expect(Number.isFinite(replay.duration) && replay.duration > 2).toBe(true);
  expect(replay.played).toBeGreaterThan(0.2);
  expect(replay.w).toBeGreaterThan(0);

  // Download through the app's own button; then inspect the actual file.
  const dl = page.waitForEvent('download');
  await page.getByTestId('web-rec-download').click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/^pocketqa-recording-\d{8}-\d{6}\.webm$/);
  const file = join(tmpdir(), `pqa-web-recording-${run}.webm`);
  await download.saveAs(file);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,width,height,sample_rate,channels', '-show_entries', 'format=format_name,size', '-of', 'compact', file]).toString();
  const streams = probe.split('\n').filter((l) => l.startsWith('stream|'));
  expect(streams.filter((l) => l.includes('codec_type=video'))).toHaveLength(1);
  expect(streams.filter((l) => l.includes('codec_type=audio'))).toHaveLength(1);
  expect(probe).toMatch(/codec_name=(vp9|vp8|h264)\|codec_type=video/);
  expect(probe).toMatch(/codec_name=(opus|aac)\|codec_type=audio/);
  // Decodes end to end without errors, and the narration track is not silent (the fake mic's tone).
  const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  expect(decode.status).toBe(0);
  expect(decode.stderr.trim()).toBe('');
  const vol = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(vol.stderr)?.[1]);
  const max = Number(/max_volume: (-?[\d.]+) dB/.exec(vol.stderr)?.[1]);
  expect(mean).toBeGreaterThan(-50);
  writeFileSync(
    PROBE,
    `# Web recorder, real Chromium MediaRecorder on SYNTHETIC media (fake devices), ${new Date().toISOString()}\n` +
      `# downloaded through the app as ${download.suggestedFilename()} (${statSync(file).size} bytes)\n` +
      `$ ffprobe -v error -show_entries stream=... -show_entries format=format_name,size -of compact <file>\n${probe}` +
      `$ ffmpeg -v error -i <file> -f null -   → exit ${decode.status}, stderr ${JSON.stringify(decode.stderr.trim())} (decoded without errors)\n` +
      `$ ffmpeg -i <file> -af volumedetect -vn -f null -   → mean_volume ${mean} dB, max_volume ${max} dB (the fake microphone's tone; not silence)\n` +
      `replay in page: ${JSON.stringify(replay)}\n`,
  );

  // Nothing was sent anywhere while recording, stopping, replaying or downloading (T10).
  expect(sent).toEqual([]);
  expect(localReads.every((u) => u === 'blob:http://localhost:8090/<id>')).toBe(true);

  // Discard: the draft goes away and its object URL no longer resolves (T8).
  const url = await page.evaluate(() => (document.querySelector('[data-testid="web-rec-player"]') as HTMLVideoElement).src);
  await page.getByTestId('web-rec-discard').click();
  await expect(page.getByTestId('web-rec-start')).toBeVisible();
  expect(await page.evaluate(async (u) => fetch(u).then(() => 'still there', () => 'revoked'), url)).toBe('revoked');
  await ctx.close();
});

test('the browser’s “Stop sharing” ends the recording and keeps the draft (dark)', async ({ browser, request }) => {
  const { email, participationId } = await seed(request);
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  const page = await ctx.newPage();
  await instrument(page);
  await openSession(page, email, participationId);
  await consentAndStart(page);
  await shot(page, 'web-recorder-recording-dark');
  await page.waitForTimeout(2000);
  // What the browser does when its own "Stop sharing" is pressed: the screen track ends.
  await page.evaluate(() => (window as unknown as { __pqa: { display: MediaStream } }).__pqa.display.getVideoTracks()[0]!.dispatchEvent(new Event('ended')));
  await expect(page.getByTestId('web-rec-ended')).toContainText('You stopped sharing from the browser');
  await expect(page.getByTestId('web-rec-review')).toContainText('Recording ready');
  expect(await tracksState(page)).toEqual(['video:ended', 'audio:ended']);
  await shot(page, 'web-recorder-review-dark');
  await ctx.close();
});

test('a refused microphone stops the screen share and records nothing (T3)', async ({ browser, request }) => {
  const { email, participationId } = await seed(request);
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  await instrument(page, 'deny');
  await openSession(page, email, participationId);
  await page.getByTestId('web-rec-consent').click();
  await page.getByTestId('web-rec-start').click();
  await expect(page.getByTestId('web-rec-error')).toContainText('Microphone access was blocked');
  await expect(page.getByTestId('web-rec-error')).toContainText('nothing was recorded');
  expect(await tracksState(page)).toEqual(['video:ended']);
  await expect(page.getByTestId('web-rec-review')).toHaveCount(0);
  await expect(page.getByTestId('web-rec-start')).toBeEnabled(); // retry stays possible
  await shot(page, 'web-recorder-mic-denied-light');
  await ctx.close();
});

test('leaving the session mid-recording releases the screen and microphone and keeps nothing (T7)', async ({ browser, request }) => {
  const { email, participationId } = await seed(request);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await instrument(page);
  await openSession(page, email, participationId);
  await consentAndStart(page);
  const doc = await page.evaluate(() => performance.timeOrigin);
  await page.goBack();
  await expect(page.getByTestId('web-recorder')).toHaveCount(0);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(doc); // same document: an in-app unmount, not a reload
  await expect.poll(() => tracksState(page)).toEqual(['video:ended', 'audio:ended']);
  await ctx.close();
});
