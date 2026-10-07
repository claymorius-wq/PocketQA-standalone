/* global localStorage -- evidence copy: this runs inside the page (Playwright addInitScript) */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = join(__dirname, 'evidence', `demo-showcase-${stamp}`);
const origin = 'https://pocketqa-devnet.vercel.app';
const originHost = 'pocketqa-devnet.vercel.app';
const proxyPort = 9443;
const backend = 'http://127.0.0.1:8697';

function parseEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

function envPick(env, ...keys) {
  for (const k of keys) if (env[k]) return env[k];
  return '';
}

function ensureCert() {
  mkdirSync(evidenceDir, { recursive: true });
  const tlsDir = join(tmpdir(), 'pocketqa-codex-web-e2e-tls');
  mkdirSync(tlsDir, { recursive: true });
  const cert = join(tlsDir, 'local-devnet.crt');
  const key = join(tlsDir, 'local-devnet.key');
  if (!existsSync(cert) || !existsSync(key)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=pocketqa-devnet.vercel.app', '-addext', 'subjectAltName=DNS:pocketqa-devnet.vercel.app'], { stdio: 'ignore' });
  }
  return { cert: readFileSync(cert), key: readFileSync(key) };
}

function startProxy() {
  const tls = ensureCert();
  const server = https.createServer(tls, (req, res) => {
    const target = new URL(req.url ?? '/', backend);
    const proxy = http.request(target, { method: req.method, headers: { ...req.headers, host: '127.0.0.1:8697' } }, (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    });
    proxy.on('error', (err) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`proxy error: ${err.message}`);
    });
    req.pipe(proxy);
  });
  return new Promise((resolve) => server.listen(proxyPort, '127.0.0.1', () => resolve(server)));
}

async function signIn(page, creds) {
  await page.goto(`${origin}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sign-in-email').fill(creds.email);
  await page.getByTestId('sign-in-password').fill(creds.password);
  await page.getByTestId('sign-in-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
}

async function shot(locator, name) {
  const path = join(evidenceDir, `${name}.png`);
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path });
  return path;
}

async function captureViewport(browser, viewport, name) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport });
  const page = await context.newPage();
  const consoleMessages = [];
  const network = [];
  page.on('console', (m) => consoleMessages.push({ at: new Date().toISOString(), type: m.type(), text: m.text().slice(0, 1000) }));
  page.on('pageerror', (err) => consoleMessages.push({ at: new Date().toISOString(), type: 'pageerror', text: err.message }));
  page.on('requestfinished', async (req) => {
    const res = await req.response().catch(() => null);
    network.push({ at: new Date().toISOString(), method: req.method(), url: req.url().split('?')[0], status: res?.status() });
  });
  page.on('requestfailed', (req) => network.push({ at: new Date().toISOString(), method: req.method(), url: req.url().split('?')[0], failed: req.failure()?.errorText }));
  await page.addInitScript(() => localStorage.setItem('pocketqa.introSeen', '1'));

  const env = parseEnv(join(homedir(), '.config/pocketqa-e28/tester3.env'));
  const creds = { email: envPick(env, 'E29_TESTER3_EMAIL', 'E28_TESTER3_EMAIL'), password: envPick(env, 'E29_TESTER3_PASSWORD', 'E28_TESTER3_PASSWORD') };
  if (!creds.email || !creds.password) throw new Error('Missing tester-3 credentials');

  await signIn(page, creds);
  await page.goto(`${origin}/leaderboard`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('leaderboard-screen').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByTestId('demo-toggle').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByTestId('demo-profile-demo-1').waitFor({ state: 'visible', timeout: 30000 });

  const shots = {};
  const realList = page.getByTestId('leaderboard-list');
  if (await realList.isVisible().catch(() => false)) {
    shots.realRanking = await shot(realList, `${name}-01-real-ranking`);
  } else {
    const path = join(evidenceDir, `${name}-01-real-ranking-empty.png`);
    await page.getByText('No one yet').waitFor({ state: 'visible', timeout: 30000 });
    await page.screenshot({ path, fullPage: false });
    shots.realRanking = path;
  }
  shots.demoOn = await shot(page.getByTestId('demo-showcase'), `${name}-02-demo-examples-on`);
  await page.getByTestId('demo-toggle').click();
  await page.getByTestId('demo-profile-demo-1').waitFor({ state: 'detached', timeout: 30000 });
  shots.demoOff = await shot(page.getByTestId('demo-showcase'), `${name}-03-demo-toggle-off`);
  await page.getByTestId('demo-toggle').click();
  await page.getByTestId('demo-profile-demo-1').waitFor({ state: 'visible', timeout: 30000 });
  shots.demoOnAgain = await shot(page.getByTestId('demo-showcase'), `${name}-04-demo-toggle-on`);

  const text = {
    realRanking: (await realList.innerText().catch(() => page.getByText('No one yet').innerText().catch(() => ''))),
    demoShowcase: await page.getByTestId('demo-showcase').innerText(),
  };
  await context.close();
  return { viewport, shots, text, consoleMessages, consoleErrors: consoleMessages.filter((m) => ['error', 'pageerror'].includes(m.type)), network };
}

async function main() {
  const server = await startProxy();
  const browser = await chromium.launch({
    headless: false,
    channel: process.env.PQA_CHROME_CHANNEL || 'chrome',
    args: [`--host-resolver-rules=MAP ${originHost}:443 127.0.0.1:${proxyPort}`, '--ignore-certificate-errors'],
  });
  try {
    const run = {
      label: 'test-only hostname mapping, TLS errors ignored, NOT the hosted deployment',
      candidate: { branch: 'feat/demo-showcase', sha: '6fb9e3e', entry: 'entry-47f56763760474f397b9b75f007c8bb1.js', backend, origin },
      auth: { user: 'tester-3' },
      desktop: await captureViewport(browser, { width: 1280, height: 900 }, 'desktop-1280x900'),
      mobile: await captureViewport(browser, { width: 390, height: 844 }, 'mobile-390x844'),
    };
    writeFileSync(join(evidenceDir, 'run.json'), JSON.stringify(run, null, 2));
    console.log(JSON.stringify({ ok: true, evidenceDir, consoleErrors: { desktop: run.desktop.consoleErrors, mobile: run.mobile.consoleErrors }, shots: { desktop: run.desktop.shots, mobile: run.mobile.shots } }, null, 2));
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
