/* global CustomEvent, btoa, window -- evidence copy: these run inside the page (Playwright evaluate/addInitScript) */
/* eslint-disable no-empty -- evidence copy kept verbatim (lint-only header; no code changed) */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { createSignInMessageText } from '@solana/wallet-standard-util';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = join(__dirname, 'evidence', `codex-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const origin = 'https://pocketqa-devnet.vercel.app';
const originHost = 'pocketqa-devnet.vercel.app';
const proxyPort = 9443;
const backend = 'http://127.0.0.1:8697';
const rpcUrl = 'https://api.devnet.solana.com';
const DEVNET = 'solana:devnet';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const TEST_WALLET_NAME = 'Pocket QA Test Wallet (devnet): injected by Playwright, not an extension';
const RESUME_TITLE_DEFAULT = 'Codex devnet journey muxosrqy';
const FUNDING_FACTS_PATH = join(homedir(), '.local/share/pocketqa/e28/codex-study-funding.json');

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

function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

function sigInfo(signature) {
  return signature ? { prefix: signature.slice(0, 10), sha256: sha256(signature) } : null;
}

function readFundingFacts(studyId) {
  if (!existsSync(FUNDING_FACTS_PATH)) return null;
  const raw = JSON.parse(readFileSync(FUNDING_FACTS_PATH, 'utf8'));
  const escrow = raw.studyEscrows?.find((x) => x.study_id === studyId) ?? raw.studyEscrowDoc;
  const funding = raw.escrowFundings?.find((x) => x.study_id === studyId) ?? null;
  return { escrow, funding };
}

function loadFixtureSeed(role) {
  const dir = join(homedir(), '.config/pocketqa-devnet-pilot');
  const raw = JSON.parse(readFileSync(join(dir, `${role}.json`), 'utf8'));
  const bytes = Uint8Array.from(Array.isArray(raw) ? raw : raw.secretKey ?? []);
  if (bytes.length !== 64) throw new Error(`fixture ${role}: expected a 64-byte secret key`);
  const seed = bytes.slice(0, 32);
  bytes.fill(0);
  const address = base58.encode(ed25519.getPublicKey(seed));
  const published = JSON.parse(readFileSync(join(dir, 'public-addresses.json'), 'utf8'))[role];
  if (published !== address) throw new Error(`fixture ${role}: public key does not match public-addresses.json`);
  return { seed, address };
}

function devnetSend(rpcUrl) {
  const rpc = async (method, params) => {
    const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const json = await res.json();
    if (json.error || json.result === undefined) throw new Error(`${method}: ${json.error?.message ?? res.status}`);
    return json.result;
  };
  let proven = false;
  return async (signed) => {
    if (!proven) {
      if ((await rpc('getGenesisHash', [])) !== DEVNET_GENESIS) throw new Error('refusing: the RPC is not Solana devnet');
      proven = true;
    }
    return rpc('sendTransaction', [base64.encode(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
  };
}

async function devnetRpc(method, params) {
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = await res.json();
  if (json.error || json.result === undefined) throw new Error(`${method}: ${json.error?.message ?? res.status}`);
  return json.result;
}

async function tokenAccountUnits(address) {
  const balance = await devnetRpc('getTokenAccountBalance', [address]).catch((err) => {
    if (String(err.message).includes('could not find account')) return null;
    throw err;
  });
  return balance?.value?.amount ?? '0';
}

function decodeServerTx(transactionB64) {
  let bytes;
  try {
    bytes = base64.decode(transactionB64);
  } catch {
    throw new Error('Not a valid devnet transaction: not base64.');
  }
  let at = 0;
  const need = (n) => {
    if (at + n > bytes.length) throw new Error('Not a valid devnet transaction: truncated.');
  };
  const u8 = () => {
    need(1);
    return bytes[at++];
  };
  const shortvec = () => {
    let v = 0;
    for (let i = 0; i < 3; i += 1) {
      const b = u8();
      v |= (b & 0x7f) << (7 * i);
      if (!(b & 0x80)) return v;
    }
    throw new Error('Not a valid devnet transaction: length prefix too long.');
  };
  const take = (n) => {
    need(n);
    const out = bytes.subarray(at, at + n);
    at += n;
    return out;
  };
  const sigCount = shortvec();
  const signed = [];
  for (let i = 0; i < sigCount; i += 1) signed.push(take(64).some((b) => b !== 0));
  let version = 'legacy';
  need(1);
  if (bytes[at] & 0x80) {
    const v = u8() & 0x7f;
    if (v !== 0) throw new Error(`Not a valid devnet transaction: unsupported message version ${v}.`);
    version = 0;
  }
  const requiredSignatures = u8();
  u8();
  u8();
  const keyCount = shortvec();
  const keys = [];
  for (let i = 0; i < keyCount; i += 1) keys.push(base58.encode(take(32)));
  const recentBlockhash = base58.encode(take(32));
  const ixCount = shortvec();
  const programIds = [];
  for (let i = 0; i < ixCount; i += 1) {
    const p = u8();
    if (p >= keys.length) throw new Error('Not a valid devnet transaction: a program is not a static account.');
    programIds.push(keys[p]);
    const accountIdx = Array.from(take(shortvec()));
    if (accountIdx.some((a) => a >= keys.length)) throw new Error('Not a valid devnet transaction: an instruction uses a lookup-table account.');
    take(shortvec());
  }
  let lookupTables = 0;
  if (version === 0) {
    lookupTables = shortvec();
    for (let i = 0; i < lookupTables; i += 1) {
      take(32);
      take(shortvec());
      take(shortvec());
    }
  }
  if (at !== bytes.length) throw new Error('Not a valid devnet transaction: trailing bytes.');
  if (requiredSignatures < 1 || requiredSignatures !== sigCount || keys.length < requiredSignatures) throw new Error('Not a valid devnet transaction: signature count mismatch.');
  return { version, requiredSignatures, signed, feePayer: keys[0], programIds, recentBlockhash, lookupTables };
}

function signFeePayerSlot(tx, seed) {
  const decoded = decodeServerTx(Buffer.from(tx).toString('base64'));
  const address = base58.encode(ed25519.getPublicKey(seed));
  if (decoded.feePayer !== address) throw new Error('refusing: this wallet is not the fee payer');
  if (decoded.requiredSignatures !== 1 || tx[0] !== 1) throw new Error('refusing: the transaction needs other signers');
  const message = tx.subarray(65);
  const signature = ed25519.sign(message, seed);
  const signed = Uint8Array.from(tx);
  signed.set(signature, 1);
  return { signed, signature };
}

async function installDevnetWallet(page, { seed, name = TEST_WALLET_NAME, send, rejectNext = new Set() }) {
  const address = base58.encode(ed25519.getPublicKey(seed));
  const log = [];
  const guard = (kind, chain, account, extra = {}) => {
    const refuse = (why) => {
      log.push({ kind, chain: chain ?? DEVNET, ...extra, approved: false, refused: why });
      return Object.assign(new Error(`refusing ${kind}: ${why}`), { code: why === 'policy' ? 4001 : undefined });
    };
    if (chain && chain !== DEVNET) throw refuse(`chain ${chain} is not ${DEVNET}`);
    if (account && account !== address) throw refuse("not this wallet's account");
    if (rejectNext.delete(kind)) throw refuse('policy');
    log.push({ kind, chain: chain ?? DEVNET, ...extra, approved: true });
  };

  await page.exposeFunction('__pqaDevnetWallet', async (kind, payload) => {
    if (kind === 'connect') {
      log.push({ kind, approved: true });
      return { address, publicKey: Array.from(base58.decode(address)) };
    }
    if (kind === 'disconnect') {
      log.push({ kind, approved: true });
      return null;
    }
    if (kind === 'signIn') {
      const input = payload.input;
      if (input.domain !== originHost) throw new Error(`refusing signIn: domain ${input.domain} is not ${originHost}`);
      if (input.address && input.address !== address) throw new Error('refusing signIn: another address');
      const text = new TextEncoder().encode(createSignInMessageText({ ...input, address }));
      guard(kind, null, null, { bytes: text.length });
      return { signedMessage: Array.from(text), signature: Array.from(ed25519.sign(text, seed)) };
    }
    if (kind === 'signMessage') {
      const message = Uint8Array.from(payload.message);
      guard(kind, null, payload.account, { bytes: message.length });
      return { signedMessage: Array.from(message), signature: Array.from(ed25519.sign(message, seed)) };
    }
    if (kind === 'signAndSendTransaction') {
      const tx = Uint8Array.from(payload.transaction);
      const decoded = decodeServerTx(Buffer.from(tx).toString('base64'));
      guard(kind, payload.chain, payload.account, { bytes: tx.length, programs: decoded.programIds });
      const { signed, signature } = signFeePayerSlot(tx, seed);
      const sent = await send(signed);
      const expected = base58.encode(signature);
      if (sent !== expected) throw new Error('the network returned another signature');
      log.push({ kind: 'sent', chain: DEVNET, signature: sent, approved: true });
      return { signature: Array.from(signature) };
    }
    throw new Error(`unsupported wallet request ${kind}`);
  });

  await page.addInitScript(({ walletName }) => {
    const call = (kind, payload) => window.__pqaDevnetWallet(kind, payload);
    const u8 = (a) => Uint8Array.from(a);
    const CHAINS = ['solana:devnet'];
    const FEATURES = ['solana:signIn', 'solana:signMessage', 'solana:signAndSendTransaction'];
    let accounts = [];
    const listeners = new Set();
    const account = (a) => ({ address: a.address, publicKey: u8(a.publicKey), chains: CHAINS, features: FEATURES, label: walletName });
    const emit = () => listeners.forEach((l) => l({ accounts }));
    const connect = async () => {
      accounts = [account(await call('connect', {}))];
      emit();
      return { accounts };
    };
    const wallet = {
      version: '1.0.0',
      name: walletName,
      icon: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="#3640c8"/></svg>'),
      chains: CHAINS,
      get accounts() {
        return accounts;
      },
      features: {
        'standard:connect': { version: '1.0.0', connect },
        'standard:disconnect': {
          version: '1.0.0',
          disconnect: async () => {
            await call('disconnect', {});
            accounts = [];
            emit();
          },
        },
        'standard:events': {
          version: '1.0.0',
          on: (event, listener) => {
            if (event !== 'change') return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        'solana:signIn': {
          version: '1.0.0',
          signIn: async (...inputs) =>
            Promise.all(
              inputs.map(async (input) => {
                if (!accounts.length) await connect();
                const r = await call('signIn', { input });
                return { account: accounts[0], signedMessage: u8(r.signedMessage), signature: u8(r.signature), signatureType: 'ed25519' };
              }),
            ),
        },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: async (...inputs) =>
            Promise.all(
              inputs.map(async (i) => {
                const r = await call('signMessage', { account: i.account.address, message: Array.from(i.message) });
                return { signedMessage: u8(r.signedMessage), signature: u8(r.signature) };
              }),
            ),
        },
        'solana:signAndSendTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy', 0],
          signAndSendTransaction: async (...inputs) =>
            Promise.all(
              inputs.map(async (i) => {
                const r = await call('signAndSendTransaction', { account: i.account.address, chain: i.chain, transaction: Array.from(i.transaction) });
                return { signature: u8(r.signature) };
              }),
            ),
        },
      },
    };
    const register = ({ register: r }) => r(wallet);
    try {
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
    } catch {}
    window.addEventListener('wallet-standard:app-ready', ({ detail }) => register(detail));
  }, { walletName: name });

  return { address, log, rejectNext };
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
  return new Promise((resolveServer) => server.listen(proxyPort, '127.0.0.1', () => resolveServer(server)));
}

async function shot(page, name) {
  const path = join(evidenceDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function waitVisible(page, testId, timeout = 30000) {
  const loc = page.getByTestId(testId);
  await loc.waitFor({ state: 'visible', timeout });
  return loc;
}

async function expectText(page, testId, text, timeout = 30000) {
  const end = Date.now() + timeout;
  const loc = page.getByTestId(testId);
  while (Date.now() < end) {
    const value = await loc.innerText().catch(() => '');
    if (value.includes(text)) return value;
    await page.waitForTimeout(500);
  }
  throw new Error(`stopped: ${testId} did not contain ${text}`);
}

async function until(page, what, ready, timeout = 300000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (let i = 0; i < 10; i += 1) {
      if (await ready().catch(() => false)) return;
      await page.waitForTimeout(1000);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  throw new Error(`stopped: ${what} not reached within ${Math.round(timeout / 1000)}s`);
}

async function signIn(page, creds) {
  await page.goto(`${origin}/sign-in`, { waitUntil: 'domcontentloaded' });
  await waitVisible(page, 'sign-in-email');
  await page.getByTestId('sign-in-email').fill(creds.email);
  await page.getByTestId('sign-in-password').fill(creds.password);
  await page.getByTestId('sign-in-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
}

async function linkTesterWallet(page, walletAddress) {
  await page.goto(`${origin}/settings`, { waitUntil: 'domcontentloaded' });
  await waitVisible(page, 'wallet-section');
  const address = page.getByTestId('wallet-address');
  if (await address.isVisible().catch(() => false)) {
    const text = await address.textContent();
    if (!text?.includes(walletAddress)) throw new Error(`Tester account already has unexpected wallet ${text}`);
    return 'already-linked';
  }
  await page.getByTestId('wallet-link').click();
  await waitVisible(page, 'wallet-address', 30000);
  const linked = await page.getByTestId('wallet-address').textContent();
  if (!linked?.includes(walletAddress)) throw new Error('Wallet link did not show expected tester fixture address');
  return 'linked-first-time';
}

async function saveTesterDeviceProfile(page) {
  await page.goto(`${origin}/settings`, { waitUntil: 'domcontentloaded' });
  await waitVisible(page, 'device-save');
  if (await page.getByTestId('device-platform-web').isVisible().catch(() => false)) await page.getByTestId('device-platform-web').click();
  await page.getByTestId('device-save').click();
  await waitVisible(page, 'device-saved', 30000);
}

async function clickConfirm(page, label) {
  const ok = page.getByTestId('confirm-ok');
  if (await ok.isVisible().catch(() => false)) {
    await ok.click();
    return;
  }
  await page.getByText(label).last().click();
}

function signatureSummaries(log) {
  return log.filter((x) => x.signature).map((x) => ({ kind: x.kind, ...sigInfo(x.signature) }));
}

function persistRun(run, { builderWallet, testerWallet, consoleLog, network, partial = false }) {
  run.walletLogs.builder = builderWallet.log;
  run.walletLogs.tester = testerWallet.log;
  run.signatures.builder = signatureSummaries(builderWallet.log);
  run.signatures.tester = signatureSummaries(testerWallet.log);
  run.consoleLog = consoleLog;
  run.network = network;
  writeFileSync(join(evidenceDir, partial ? 'run.partial.json' : 'run.json'), JSON.stringify(run, null, 2));
}

async function main() {
  const builderEnv = parseEnv(join(homedir(), '.config/pocketqa-e28/builder.env'));
  const testerEnv = parseEnv(join(homedir(), '.config/pocketqa-e28/tester3.env'));
  const builderCreds = { email: builderEnv.E28_BUILDER_EMAIL, password: builderEnv.E28_BUILDER_PASSWORD };
  const testerCreds = {
    email: envPick(testerEnv, 'E29_TESTER3_EMAIL', 'E28_TESTER3_EMAIL'),
    password: envPick(testerEnv, 'E29_TESTER3_PASSWORD', 'E28_TESTER3_PASSWORD'),
  };
  if (!builderCreds.email || !builderCreds.password || !testerCreds.email || !testerCreds.password) throw new Error('Missing synthetic credentials');

  const server = await startProxy();
  const consoleLog = [];
  const network = [];
  const resumeStudyId = process.env.PQA_RESUME_STUDY_ID?.trim() ?? '';
  const resumeTitle = process.env.PQA_RESUME_TITLE?.trim() || RESUME_TITLE_DEFAULT;
  const fundingFacts = resumeStudyId ? readFundingFacts(resumeStudyId) : null;
  const run = {
    label: 'test-only hostname mapping, TLS errors ignored, NOT the hosted deployment',
    walletClass: `${TEST_WALLET_NAME}; NOT extension compatibility`,
    target: { origin, proxyPort, backend, artifact: '4ee4603' },
    mode: resumeStudyId ? 'resume' : 'full',
    resume: resumeStudyId ? { studyId: resumeStudyId, title: resumeTitle, noCreationFundingOrPublish: true } : null,
    fundingFacts,
    ids: {},
    signatures: {},
    screenshots: [],
    walletLogs: {},
  };

  const browser = await chromium.launch({
    headless: false,
    channel: process.env.PQA_CHROME_CHANNEL || 'chrome',
    args: [`--host-resolver-rules=MAP pocketqa-devnet.vercel.app:443 127.0.0.1:${proxyPort}`, '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const builderPage = await context.newPage();
  const testerPage = await context.newPage();
  for (const page of [builderPage, testerPage]) {
    page.on('console', (m) => consoleLog.push({ at: new Date().toISOString(), type: m.type(), text: m.text().slice(0, 500) }));
    page.on('requestfinished', async (req) => {
      const res = await req.response().catch(() => null);
      network.push({ at: new Date().toISOString(), method: req.method(), url: req.url().split('?')[0], status: res?.status() });
    });
    page.on('requestfailed', (req) => network.push({ at: new Date().toISOString(), method: req.method(), url: req.url().split('?')[0], failed: req.failure()?.errorText }));
  }

  const send = devnetSend(rpcUrl);
  const builderWallet = await installDevnetWallet(builderPage, { seed: loadFixtureSeed('builder').seed, send });
  const testerWallet = await installDevnetWallet(testerPage, { seed: loadFixtureSeed('tester').seed, send });
  run.wallets = { builder: builderWallet.address, tester: testerWallet.address };

  try {
    await builderPage.goto(origin, { waitUntil: 'domcontentloaded' });
    run.firstNavigation = { url: builderPage.url(), title: await builderPage.title() };
    run.screenshots.push(await shot(builderPage, '00-first-navigation'));

    await signIn(builderPage, builderCreds);
    await waitVisible(builderPage, 'studies-screen');
    run.screenshots.push(await shot(builderPage, '01-builder-signed-in'));

    await signIn(testerPage, testerCreds);
    await waitVisible(testerPage, 'discover-screen');
    run.screenshots.push(await shot(testerPage, '02-tester3-signed-in'));
    run.ids.testerWalletLink = await linkTesterWallet(testerPage, testerWallet.address);
    run.screenshots.push(await shot(testerPage, '03-tester3-wallet-linked'));
    await saveTesterDeviceProfile(testerPage);
    run.screenshots.push(await shot(testerPage, '04-tester3-device-profile'));

    let studyUrl;
    let title;
    if (resumeStudyId) {
      title = resumeTitle;
      studyUrl = `${origin}/builder/study/${resumeStudyId}`;
      run.title = title;
      run.ids.studyId = resumeStudyId;
      await builderPage.goto(studyUrl, { waitUntil: 'domcontentloaded' });
      await waitVisible(builderPage, 'builder-study-screen');
      await expectText(builderPage, 'study-status', 'PUBLISHED', 60000);
      run.screenshots.push(await shot(builderPage, '05-resume-builder-study-published'));
    } else {
      await builderPage.goto(`${origin}/builder/new-study`, { waitUntil: 'domcontentloaded' });
      await waitVisible(builderPage, 'new-study-screen');
      const stamp = Date.now().toString(36);
      title = `Codex devnet journey ${stamp}`;
      run.title = title;
      await builderPage.getByTestId('study-title').fill(title);
      await builderPage.getByTestId('study-objective').fill('Verify a screenshot upload and review workflow through the browser UI.');
      await builderPage.getByTestId('study-task-0').fill('Upload the synthetic screenshot and add the requested note.');
      await builderPage.getByTestId('crit-web').click();
      await builderPage.getByTestId('crit-langs').fill('en');
      await builderPage.getByTestId('payment-mode-escrow').click();
      await builderPage.getByTestId('study-reward-usdc').fill('0.50');
      await builderPage.getByTestId('study-slots').fill('2');
      await builderPage.getByTestId('study-consent').fill('I agree to upload only the synthetic screenshot for this Codex devnet test.');
      run.screenshots.push(await shot(builderPage, '04-builder-new-study-filled'));
      await builderPage.getByTestId('study-save').click();
      await waitVisible(builderPage, 'builder-study-screen');
      studyUrl = builderPage.url();
      run.ids.studyId = /\/builder\/study\/([^/?#]+)/.exec(studyUrl)?.[1] ?? null;
      run.screenshots.push(await shot(builderPage, '05-builder-draft-study'));

      await builderPage.getByTestId('escrow-fund').click();
      await waitVisible(builderPage, 'escrow-pilot-request', 30000);
      for (let i = 0; i < 20 && !(await builderPage.getByTestId('escrow-wallet-plan').isVisible().catch(() => false)); i += 1) {
        const review = builderPage.getByTestId('escrow-wallet-review');
        if ((await review.isVisible().catch(() => false)) && (await review.isEnabled().catch(() => false))) await review.click();
        await builderPage.waitForTimeout(3000);
      }
      await waitVisible(builderPage, 'escrow-wallet-plan', 30000);
      run.screenshots.push(await shot(builderPage, '06-funding-plan-checked'));
      builderWallet.rejectNext.add('signAndSendTransaction');
      await builderPage.getByTestId('escrow-wallet-sign').click();
      await waitVisible(builderPage, 'escrow-wallet-error', 30000);
      run.screenshots.push(await shot(builderPage, '07-funding-cancelled-in-wallet'));
      await builderPage.getByTestId('escrow-wallet-sign').click();
      await until(builderPage, 'funding confirmed', async () => {
        if (await builderPage.getByTestId('escrow-check').isVisible().catch(() => false)) await builderPage.getByTestId('escrow-check').click();
        return builderPage.getByTestId('escrow-funded').isVisible();
      }, 300000);
      run.screenshots.push(await shot(builderPage, '08-funded-on-devnet'));

      await builderPage.getByTestId('study-publish').click();
      await clickConfirm(builderPage, 'Publish');
      await expectText(builderPage, 'study-status', 'PUBLISHED', 60000);
      run.screenshots.push(await shot(builderPage, '09-published'));
    }

    await testerPage.goto(`${origin}/discover`, { waitUntil: 'domcontentloaded' });
    await until(testerPage, 'study appears in Discover', () => testerPage.getByText(title).first().isVisible(), 180000);
    await testerPage.getByText(title).first().click();
    await waitVisible(testerPage, 'study-detail-screen');
    await testerPage.getByTestId('consent-checkbox').click();
    await testerPage.getByTestId('consent-reward-wallet').click();
    await testerPage.getByTestId('consent-submit').click();
    await waitVisible(testerPage, 'participation-screen', 30000);
    run.ids.participationId = /\/participation\/([^/?#]+)/.exec(testerPage.url())?.[1] ?? null;
    await testerPage.getByTestId('session-start').click();
    await testerPage.getByTestId('task-note-0').fill('Codex synthetic screenshot uploaded for devnet browser payout test.');
    await testerPage.getByTestId('task-note-save-0').click();
    const png = join(evidenceDir, 'synthetic-evidence.png');
    writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'));
    const chooser = testerPage.waitForEvent('filechooser');
    await testerPage.getByTestId('attach-evidence').click();
    await (await chooser).setFiles(png);
    await testerPage.getByTestId('segment-keep').click();
    await testerPage.getByTestId('upload-kept').click();
    await waitVisible(testerPage, 'uploaded-evidence', 60000);
    run.screenshots.push(await shot(testerPage, '10-tester-uploaded'));
    await testerPage.getByTestId('session-submit').click();
    await clickConfirm(testerPage, 'Submit');
    await waitVisible(testerPage, 'awaiting-review', 30000);
    run.screenshots.push(await shot(testerPage, '11-tester-submitted'));

    await builderPage.goto(studyUrl, { waitUntil: 'domcontentloaded' });
    await until(builderPage, 'submission visible to builder', () => builderPage.locator('[data-testid^="builder-participation-"]').first().isVisible(), 60000);
    await builderPage.locator('[data-testid^="builder-participation-"]').first().click();
    await waitVisible(builderPage, 'review-screen');
    await builderPage.getByTestId('review-approve').click();
    await clickConfirm(builderPage, 'Approve');
    await waitVisible(builderPage, 'review-decided', 30000);
    await until(builderPage, 'reward approval card', () => builderPage.getByTestId('reward-approval-review').isVisible(), 900000);
    await builderPage.getByTestId('reward-approval-review').click();
    await waitVisible(builderPage, 'reward-approval-plan', 30000);
    run.screenshots.push(await shot(builderPage, '12-reward-vote-card'));
    builderWallet.rejectNext.add('signAndSendTransaction');
    await builderPage.getByTestId('reward-approval-sign').click();
    await waitVisible(builderPage, 'reward-approval-error', 30000);
    run.screenshots.push(await shot(builderPage, '13-reward-vote-cancelled'));
    await builderPage.getByTestId('reward-approval-sign').click();
    await until(builderPage, 'reward settled', () => builderPage.getByTestId('payment-state').getByText('Settled on devnet').isVisible(), 900000);
    run.screenshots.push(await shot(builderPage, '14-reward-settled'));

    await builderPage.goto(studyUrl, { waitUntil: 'domcontentloaded' });
    await builderPage.getByTestId('study-close').click();
    await clickConfirm(builderPage, 'Close');
    await waitVisible(builderPage, 'study-status', 30000);
    for (const [prefix, label] of [['escrow-refund-approval', 'refund'], ['escrow-fee-approval', 'fee']]) {
      await until(builderPage, `${label} vote card`, () => builderPage.getByTestId(`${prefix}-review`).isVisible(), 900000);
      await builderPage.getByTestId(`${prefix}-review`).click();
      await waitVisible(builderPage, `${prefix}-plan`, 30000);
      run.screenshots.push(await shot(builderPage, `15-${label}-vote-card`));
      await builderPage.getByTestId(`${prefix}-sign`).click();
    }
    await until(
      builderPage,
      'refund and fee sweep finalized',
      async () =>
        (await builderPage.getByTestId('escrow-refund').innerText().catch(() => '')).includes('finalized on devnet') &&
        (await builderPage.getByTestId('escrow-fee-sweep').innerText().catch(() => '')).includes('finalized on devnet'),
      900000,
    );
    run.screenshots.push(await shot(builderPage, '17-closed-refund-fee'));
    const vaultAta = fundingFacts?.escrow?.vault || process.env.PQA_RESUME_VAULT_ATA;
    if (vaultAta) run.finalVaultUnits = await tokenAccountUnits(vaultAta);

    persistRun(run, { builderWallet, testerWallet, consoleLog, network });
    console.log(JSON.stringify({ ok: true, evidenceDir, firstNavigation: run.firstNavigation, studyId: run.ids.studyId, participationId: run.ids.participationId, walletClass: run.walletClass }, null, 2));
  } catch (err) {
    run.error = err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) };
    persistRun(run, { builderWallet, testerWallet, consoleLog, network, partial: true });
    throw err;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
