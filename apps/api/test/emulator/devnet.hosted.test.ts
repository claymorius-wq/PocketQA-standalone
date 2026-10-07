import { Keypair } from '@solana/web3.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../../src/config';
import { DEVNET_ROOT } from '../../src/firestore/namespace';
import { hostedBackends } from '../../src/hosted/app';
import { FakeS3 } from '../fakeS3';
import { clearEmulator, emulatorFirestore, PROJECT } from './fs';

// pqa-qa P1-NS1: the hosted API in POCKETQA_ENV=devnet writes ONLY under the Firestore devnet namespace
// and R2's devnet/ prefix; staging and production keep the root collections and unprefixed keys.
const raw = emulatorFirestore();
const s3 = new FakeS3();
let endpoint = '';
beforeAll(async () => {
  endpoint = await s3.start();
});
afterAll(async () => s3.stop());
beforeEach(clearEmulator);

const base = {
  POCKETQA_DATA_BACKEND: 'firestore',
  POCKETQA_AUTH_MODE: 'firebase',
  POCKETQA_FIREBASE_PROJECT_ID: 'pocketqa-optijara',
  POCKETQA_FIREBASE_WEB_API_KEY: 'public-web-key', // check-secrets: allow (placeholder public Firebase web config in tests)
  POCKETQA_PUBLIC_ORIGIN: 'https://pocketqa-devnet.example',
  POCKETQA_STORAGE: 'r2',
  POCKETQA_R2_ACCOUNT_ID: 'a'.repeat(32),
  POCKETQA_R2_BUCKET: 'pocketqa-evidence',
  POCKETQA_R2_ACCESS_KEY_ID: 'key-id',
  POCKETQA_R2_SECRET_ACCESS_KEY: 'not-a-real-secret', // check-secrets: allow (placeholder test value)
  POCKETQA_R2_ALLOW_DELETE: '1',
};
const platform = Keypair.generate();
const devnetEnv = {
  ...base,
  POCKETQA_ENV: 'devnet',
  POCKETQA_SETTLEMENT: 'squads_devnet',
  POCKETQA_DEVNET_PLATFORM_SIGNER: JSON.stringify(Array.from(platform.secretKey)),
  POCKETQA_DEVNET_PLATFORM_PUBKEY: platform.publicKey.toBase58(),
  POCKETQA_DEVNET_ARBITER_PUBKEY: Keypair.generate().publicKey.toBase58(),
  POCKETQA_DEVNET_FEE_WALLET: Keypair.generate().publicKey.toBase58(),
  POCKETQA_DEVNET_ALLOWED_EMAILS: 'devnet-builder@example.test',
};
/** The deployment's config, pointed at the emulator's demo project and the fake S3 (test wiring only). */
const onEmulator = (c: Config): Config => ({ ...c, firebase: { ...c.firebase!, projectId: PROJECT }, r2: { ...c.r2!, endpoint, bucket: 'pqa-test' } });
const user = (id: string) => ({ id, email: `${id}@example.test`, password_hash: null, display_name: id, role: 'builder' as const, status: 'active' as const, device_json: null, created_at: '2026-10-06T00:00:00.000Z' });

describe('hostedBackends (pqa-qa P1-NS1)', () => {
  it('devnet: every Firestore write is under pocketqaNamespaces/devnet and every R2 key under devnet/', async () => {
    const { repo, store } = hostedBackends(onEmulator(loadConfig(devnetEnv)), process.env);
    expect(repo.namespace).toBe('devnet');
    expect(store.keyPrefix).toBe('devnet/');
    await repo.core.createUser(user('u1'));
    await repo.escrow.putLeaderboard('u1', true, 'Devnet Alias', Date.now());
    expect((await raw.listCollections()).map((c) => c.id)).toEqual(['pocketqaNamespaces']);
    expect((await raw.doc(DEVNET_ROOT).listCollections()).map((c) => c.id).sort()).toEqual(expect.arrayContaining(['users', 'userEmails', 'leaderboardProfiles', 'leaderboardAliases']));
    const put = await store.presignPut('evidence/devnetobj01', { contentType: 'video/mp4', contentLength: 3, expiresInSeconds: 60 });
    expect(new URL(put.url).pathname).toBe('/pqa-test/devnet/evidence/devnetobj01');
    s3.objects.set('pqa-test/evidence/prodobj0001', { body: Buffer.from('prod'), contentType: 'video/mp4' });
    s3.objects.set('pqa-test/devnet/evidence/prodobj0001', { body: Buffer.from('dev'), contentType: 'video/mp4' });
    await store.delete('evidence/prodobj0001');
    expect(s3.objects.has('pqa-test/evidence/prodobj0001')).toBe(true);
    expect(s3.objects.has('pqa-test/devnet/evidence/prodobj0001')).toBe(false);
  });

  for (const [name, env] of [
    ['staging', { ...base, POCKETQA_ENV: 'staging', POCKETQA_SETTLEMENT: 'simulated' }],
    ['production', { ...base, POCKETQA_ENV: 'production', POCKETQA_SETTLEMENT: 'off' }],
  ] as const) {
    it(`${name}: unchanged (root collections, unprefixed keys)`, async () => {
      const { repo, store } = hostedBackends(onEmulator(loadConfig(env)), process.env);
      expect(repo.namespace).toBeUndefined();
      expect(store.keyPrefix).toBe('');
      await repo.core.createUser(user('u2'));
      expect((await raw.listCollections()).map((c) => c.id)).toContain('users');
      const put = await store.presignPut('evidence/stagingobj1', { contentType: 'video/mp4', contentLength: 3, expiresInSeconds: 60 });
      expect(new URL(put.url).pathname).toBe('/pqa-test/evidence/stagingobj1');
    });
  }
});
