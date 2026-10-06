import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Keypair } from '@solana/web3.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSiwsMessage, type SiwsInput } from '@pocket-qa/contracts';
import { buildHostedApp, hostedDeps, type HostedConnectors, type HostedDeps } from '../../src/hosted/app';
import { firebaseIdentity } from '../../src/identity/firebase';
import { DEVNET_ROOT } from '../../src/firestore/namespace';
import { MAINNET_GENESIS, PILOT_MINT } from '../../src/settlement/squads/pins';
import { FakeDevnetChain } from '../fakeDevnetChain';
import { FakeS3 } from '../fakeS3';
import { clearEmulator, emulatorFirestore, PROJECT } from './fs';

// The hosted app in POCKETQA_ENV=devnet, end to end on the emulators through the TEST-ONLY
// connectors (the env is the real devnet env and is validated as in production; only the
// connections go to the emulators, a fake S3 and the fake chain). Every hosted entry point
// (identity sign-in, the API routes, the cron jobs, the inline slices, the deletion worker) runs
// on the same namespaced repos and devnet/ R2 prefix; afterwards nothing exists outside them.
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
const CRON = 'c'.repeat(40);
const raw = emulatorFirestore();
const s3 = new FakeS3();
const chain = new FakeDevnetChain();
const BUILDER_EMAIL = 'devnet-builder@example.test';
let deps: HostedDeps;
let app: FastifyInstance;

const env = {
  POCKETQA_ENV: 'devnet',
  POCKETQA_DATA_BACKEND: 'firestore',
  POCKETQA_AUTH_MODE: 'firebase',
  POCKETQA_FIREBASE_PROJECT_ID: 'pocketqa-optijara',
  POCKETQA_FIREBASE_WEB_API_KEY: 'emulator-key', // check-secrets: allow (placeholder public Firebase web config in tests)
  POCKETQA_PUBLIC_ORIGIN: 'https://pocketqa-devnet.example',
  POCKETQA_STORAGE: 'r2',
  POCKETQA_R2_ACCOUNT_ID: 'a'.repeat(32),
  POCKETQA_R2_BUCKET: 'pocketqa-evidence',
  POCKETQA_R2_ACCESS_KEY_ID: 'test-key',
  POCKETQA_R2_SECRET_ACCESS_KEY: 'test-secret', // check-secrets: allow (placeholder test value)
  POCKETQA_R2_ALLOW_DELETE: '1',
  POCKETQA_SETTLEMENT: 'squads_devnet',
  // The fake chain's platform key: the env pins it, as a deployment's would.
  POCKETQA_DEVNET_PLATFORM_SIGNER: JSON.stringify(Array.from(chain.platformKp.secretKey)),
  POCKETQA_DEVNET_PLATFORM_PUBKEY: chain.roles.platform,
  POCKETQA_DEVNET_ARBITER_PUBKEY: chain.roles.arbiter,
  POCKETQA_DEVNET_FEE_WALLET: Keypair.generate().publicKey.toBase58(),
  POCKETQA_DEVNET_ALLOWED_EMAILS: BUILDER_EMAIL,
  CRON_SECRET: CRON,
};

async function rest(path: string, body: unknown) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/${path}?key=emulator-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as Record<string, string>;
}
const call = async (method: string, url: string, token?: string, payload?: unknown) => {
  const r = await app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload ? { payload: payload as object } : {}) });
  return { status: r.statusCode, body: r.body ? r.json() : null };
};
async function signUp(email: string, role: 'builder' | 'tester') {
  const up = await rest('accounts:signUp', { email, password: 'correct horse battery staple', returnSecureToken: true });
  const { getAuth } = await import('firebase-admin/auth');
  const { getApps } = await import('firebase-admin/app');
  await getAuth(getApps().find((a) => a.name === `pocketqa-${PROJECT}`)!).updateUser(up.localId!, { emailVerified: true });
  const token = (await rest('accounts:signInWithPassword', { email, password: 'correct horse battery staple', returnSecureToken: true })).idToken!;
  expect((await call('POST', '/auth/identity/session', token, { newAccount: { role, displayName: role } })).status).toBe(200);
  return token;
}
async function linkWallet(token: string, kp: Keypair) {
  const { input } = (await call('POST', '/wallet/nonce', token, { address: kp.publicKey.toBase58() })).body as { input: SiwsInput };
  const bytes = new TextEncoder().encode(buildSiwsMessage(input));
  const sig = ed25519.sign(bytes, kp.secretKey.slice(0, 32));
  const r = await call('POST', '/wallet/link', token, { address: input.address, nonce: input.nonce, signedMessage: Buffer.from(bytes).toString('base64'), signature: Buffer.from(sig).toString('base64') });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

let endpoint = '';
const connectors = (): HostedConnectors => ({
  firestore: () => raw,
  identity: (config) => firebaseIdentity({ ...config.firebase!, projectId: PROJECT, authEmulatorHost: AUTH }),
  r2: (config) => ({ ...config.r2!, endpoint, bucket: 'pqa-test' }),
  devnetChain: () => chain,
  now: Date.now,
});

beforeAll(async () => {
  endpoint = await s3.start();
  await clearEmulator();
  deps = hostedDeps(env, connectors());
  app = await buildHostedApp(deps, { cronLeaseWaitMs: 1_000 });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await s3.stop();
});

describe('hosted devnet app (POCKETQA_ENV=devnet) through the test-only connectors', () => {
  it('runs the devnet adapter (it is not refused like the pilot), with the startup pins proven', () => {
    expect(deps.settlement?.mode).toBe('squads_devnet');
    expect(deps.repo.namespace).toBe('devnet');
    expect(deps.store.keyPrefix).toBe('devnet/');
  });

  it('the allow-listed builder creates an escrow study and funds it; a builder off the list is refused before any signature', async () => {
    const builder = await signUp(BUILDER_EMAIL, 'builder');
    const wallet = Keypair.generate();
    await linkWallet(builder, wallet);
    const { STUDY } = await import('../helpers');
    const { rewardCredits: _, ...rest } = STUDY;
    const study = await call('POST', '/studies', builder, { ...rest, slots: 2, payment: { mode: 'escrow', rewardUnits: 1_000_000 } });
    expect(study.status, JSON.stringify(study.body)).toBe(200);
    expect(study.body.payment).toMatchObject({ mode: 'escrow', settlement: 'squads_devnet' });
    const funding = await call('POST', `/studies/${study.body.id}/escrow/fundings`, builder);
    expect(funding.status, JSON.stringify(funding.body)).toBe(200);
    let tx = await call('GET', `/escrow/fundings/${funding.body.id}/transaction`, builder);
    for (let i = 0; i < 6 && tx.status === 409; i++) tx = await call('GET', `/escrow/fundings/${funding.body.id}/transaction`, builder);
    expect(tx.status, JSON.stringify(tx.body)).toBe(200);
    expect(tx.body).toMatchObject({ network: 'devnet', fundingId: funding.body.id, amountUnits: 2_200_000 });
    expect(chain.landed.map((l) => l.step)).toEqual(['multisig_create', 'vault_ata_create']);

    const signed = chain.prepared.length;
    const outsider = await signUp('outsider-builder@example.test', 'builder');
    await linkWallet(outsider, Keypair.generate());
    const other = await call('POST', '/studies', outsider, { ...rest, slots: 2, payment: { mode: 'escrow', rewardUnits: 1_000_000 } });
    expect(other.status).toBe(200);
    const refused = await call('POST', `/studies/${other.body.id}/escrow/fundings`, outsider);
    expect(refused.status).toBe(403);
    expect(chain.prepared.length).toBe(signed);
  });

  it('the cron jobs (settle, sweep) run on the same namespaced repos', async () => {
    expect((await call('GET', '/jobs/settle', CRON)).body).toMatchObject({ job: 'settle', ran: true });
    expect((await call('GET', '/jobs/sweep', CRON)).body).toMatchObject({ job: 'sweep', ran: true });
  });

  it('afterwards: no Firestore document outside the devnet namespace, no R2 object outside devnet/', async () => {
    expect((await raw.listCollections()).map((c) => c.id)).toEqual(['pocketqaNamespaces']);
    expect((await raw.collection('pocketqaNamespaces').listDocuments()).map((d) => d.path)).toEqual([DEVNET_ROOT]);
    expect([...s3.objects.keys()].filter((k) => !k.startsWith('pqa-test/devnet/'))).toEqual([]);
  });
});

describe('the connectors are a test-only seam', () => {
  it('src never passes connectors: the Vercel entry and every caller use the production ones', () => {
    const src = (f: string) => readFileSync(join(__dirname, '../../src', f), 'utf8');
    expect(src('hosted/vercel.ts')).not.toMatch(/Connectors|connectors/);
    expect(src('hosted/app.ts')).toMatch(/buildHostedApp\(hostedDeps\(env\)\)/);
  });
  it('the devnet env itself is still refused on demo- projects and emulator variables (no weakening)', async () => {
    const { loadConfig } = await import('../../src/config');
    expect(() => loadConfig({ ...env, POCKETQA_FIREBASE_PROJECT_ID: PROJECT })).toThrow(/demo-/);
    expect(() => loadConfig({ ...env, FIREBASE_AUTH_EMULATOR_HOST: AUTH })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
  });
});

describe('startup fails closed on a non-devnet cluster (C)', () => {
  for (const [name, breakIt] of [
    ['a mainnet genesis (e.g. a mainnet RPC URL in the env)', (c: FakeDevnetChain) => (c.genesis = MAINNET_GENESIS)],
    ['a mint account that is not the pinned test USDC', (c: FakeDevnetChain) => (c.mintAccount = { address: PILOT_MINT, owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', decimals: 6 })],
  ] as const) {
    it(`${name}: the app is never built, nothing is signed`, async () => {
      const bad = new FakeDevnetChain();
      breakIt(bad);
      const e = { ...env, POCKETQA_DEVNET_PLATFORM_SIGNER: JSON.stringify(Array.from(bad.platformKp.secretKey)), POCKETQA_DEVNET_PLATFORM_PUBKEY: bad.roles.platform, POCKETQA_DEVNET_ARBITER_PUBKEY: bad.roles.arbiter, POCKETQA_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' };
      const d = hostedDeps(e, { ...connectors(), devnetChain: () => bad });
      await expect(buildHostedApp(d)).rejects.toThrow(/Refused before signing/);
      expect(bad.prepared).toEqual([]);
    });
  }
});

describe('escrow studies: devnet yes, production still no (A)', () => {
  it('production hosted (settlement off): createStudy with payment escrow is 403 FEATURE_UNAVAILABLE, as before', async () => {
    const prodEnv: Record<string, string> = { ...env, POCKETQA_ENV: 'production', POCKETQA_SETTLEMENT: 'off' };
    for (const k of Object.keys(prodEnv)) if (k.startsWith('POCKETQA_DEVNET_')) delete prodEnv[k];
    const prodDeps = hostedDeps(prodEnv, connectors());
    expect(prodDeps.settlement).toBeNull();
    const devApp = app;
    app = await buildHostedApp(prodDeps, { cronLeaseWaitMs: 1_000 });
    await app.ready();
    try {
      const builder = await signUp(`prod-builder-${Date.now()}@example.test`, 'builder');
      const { STUDY } = await import('../helpers');
      const { rewardCredits: _, ...rest } = STUDY;
      const r = await call('POST', '/studies', builder, { ...rest, slots: 2, payment: { mode: 'escrow', rewardUnits: 1_000_000 } });
      expect(r).toMatchObject({ status: 403, body: { code: 'FEATURE_UNAVAILABLE' } });
    } finally {
      await app.close();
      app = devApp;
    }
  });
});

describe('CH-D1: the shared rate limiter on every devnet send route (pqa-be2 E-25)', () => {
  it('rapid calls by one allow-listed builder get 429 RATE_LIMITED, before any chain read or signature', async () => {
    // The allow-listed builder from the journey above (sign-in again: a fresh token).
    const token = (await rest('accounts:signInWithPassword', { email: BUILDER_EMAIL, password: 'correct horse battery staple', returnSecureToken: true })).idToken!;
    const studies = (await call('GET', '/studies', token)).body.items as { id: string; payment: { mode: string } }[];
    const escrowStudy = studies.find((x) => x.payment.mode === 'escrow')!;
    const fundings = await Promise.all(Array.from({ length: 30 }, () => call('POST', `/studies/${escrowStudy.id}/escrow/fundings`, token)));
    const limited = fundings.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0]!.body.code).toBe('RATE_LIMITED');
    const fid = fundings.find((r) => r.status === 200)!.body.id as string;
    const signed = chain.prepared.length;
    const reads = await Promise.all(Array.from({ length: 30 }, () => call('GET', `/escrow/fundings/${fid}/transaction`, token)));
    expect(reads.filter((r) => r.status === 429).length).toBeGreaterThan(0);
    expect(chain.prepared.length).toBe(signed);
  });
});
