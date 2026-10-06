// The LOCAL hosted-devnet backend for the browser journey, as its own ESM process (apps/api is
// ESM; Playwright's test loader is not): `tsx e2e-devnet/local-devnet-server.mts`, started by
// playwright.devnet.config.ts under `firebase emulators:exec` (be1 ports). Binds 127.0.0.1 only.
//
// The API is the real hosted app in POCKETQA_ENV=devnet, its env validated as in production, built
// through be3's TEST-ONLY connectors: Firestore and Auth → the emulators, R2 → FakeS3, the chain →
// FakeDevnetChain (real transaction bytes). Harness-only control routes under /__harness/ let the
// test wallet "send" (FakeDevnetChain.walletSend) and the fake devnet RPC read vault accounts.
// Not evidence of a real devnet transfer.
import { createServer } from 'node:http';
import { Keypair } from '@solana/web3.js';
import { buildHostedApp, hostedDeps, type HostedConnectors } from '../../api/src/hosted/app';
import { firebaseIdentity } from '../../api/src/identity/firebase';
import { FakeDevnetChain } from '../../api/test/fakeDevnetChain';
import { FakeS3 } from '../../api/test/fakeS3';
import { clearEmulator, emulatorFirestore, PROJECT } from '../../api/test/emulator/fs';

const PORT = Number(process.env.PQA_DEVNET_API_PORT ?? 8693);
if (PORT === 8787) throw new Error('8787 is the live USB API: never');
const ORIGIN = process.env.PQA_DEVNET_ORIGIN ?? 'https://pocketqa-devnet.example';
const ALLOWED = process.env.PQA_DEVNET_ALLOWED_EMAILS ?? 'devnet-journey-builder@example.test';
const CRON = 'c'.repeat(40);
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!authHost || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run under `firebase emulators:exec` (needs FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST).');

const chain = new FakeDevnetChain();
const s3 = new FakeS3();
const endpoint = await s3.start();
await clearEmulator();
const raw = emulatorFirestore();
// The devnet env as a deployment would have it (placeholder values; the platform key is the fake chain's own).
const env = {
  POCKETQA_ENV: 'devnet',
  POCKETQA_DATA_BACKEND: 'firestore',
  POCKETQA_AUTH_MODE: 'firebase',
  POCKETQA_FIREBASE_PROJECT_ID: 'pocketqa-optijara',
  POCKETQA_FIREBASE_WEB_API_KEY: 'emulator-key', // check-secrets: allow (placeholder public Firebase web config in tests)
  POCKETQA_PUBLIC_ORIGIN: ORIGIN,
  POCKETQA_STORAGE: 'r2',
  POCKETQA_R2_ACCOUNT_ID: 'a'.repeat(32),
  POCKETQA_R2_BUCKET: 'pocketqa-evidence',
  POCKETQA_R2_ACCESS_KEY_ID: 'test-key',
  POCKETQA_R2_SECRET_ACCESS_KEY: 'test-secret', // check-secrets: allow (placeholder test value)
  POCKETQA_R2_ALLOW_DELETE: '1',
  POCKETQA_SETTLEMENT: 'squads_devnet',
  POCKETQA_DEVNET_PLATFORM_SIGNER: JSON.stringify(Array.from(chain.platformKp.secretKey)),
  POCKETQA_DEVNET_PLATFORM_PUBKEY: chain.roles.platform,
  POCKETQA_DEVNET_ARBITER_PUBKEY: chain.roles.arbiter,
  POCKETQA_DEVNET_FEE_WALLET: Keypair.generate().publicKey.toBase58(),
  POCKETQA_DEVNET_ALLOWED_EMAILS: ALLOWED,
  CRON_SECRET: CRON,
};
const connectors: HostedConnectors = {
  firestore: () => raw,
  identity: (config) => firebaseIdentity({ ...config.firebase!, projectId: PROJECT, authEmulatorHost: authHost }),
  r2: (config) => ({ ...config.r2!, endpoint, bucket: 'pqa-test' }),
  devnetChain: () => chain,
  now: Date.now,
};
const app = await buildHostedApp(hostedDeps(env as unknown as NodeJS.ProcessEnv, connectors), { cronLeaseWaitMs: 1_000 });
await app.ready();

const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', 'http://local');
    try {
      if (url.pathname === '/__harness/health') return json(res, 200, { ok: true, platform: chain.roles.platform });
      if (url.pathname === '/__harness/wallet-send') return json(res, 200, { signature: chain.walletSend(body.toString('utf8')) });
      if (url.pathname === '/__harness/vault-account') {
        const a = chain.vaultTransactionAccount(url.searchParams.get('address') ?? '');
        return json(res, 200, a ? { owner: a.owner, dataB64: Buffer.from(a.data).toString('base64') } : null);
      }
      if (url.pathname === '/__harness/landed') return json(res, 200, chain.landed.map((l) => l.step));
      const headers = { ...req.headers };
      delete headers['content-length'];
      const r = await app.inject({ method: (req.method ?? 'GET') as 'GET', url: url.pathname + url.search, headers, ...(body.length ? { payload: body } : {}) });
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.headers)) if (v !== undefined && k !== 'content-length' && k !== 'transfer-encoding') out[k] = String(v);
      res.writeHead(r.statusCode, out);
      res.end(r.rawPayload);
    } catch (e) {
      json(res, 400, { code: 'HARNESS', message: e instanceof Error ? e.message : String(e) });
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`local devnet API on http://127.0.0.1:${PORT} (origin ${ORIGIN}, auth emulator ${authHost}, fake S3 ${endpoint})`));
