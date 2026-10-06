import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

// Hosted test deployment (docs/plans/firebase-vercel-refactor.md R11): POCKETQA_ENV=staging keeps
// production's security (managed sign-in, private R2, an exact public https origin, no demo or
// emulator paths) but runs labelled TEST CREDITS and simulated settlement, never real money and
// no chain sends from the server. Data lives in Firestore (no data directory).
const staging = {
  POCKETQA_ENV: 'staging',
  POCKETQA_DATA_BACKEND: 'firestore',
  POCKETQA_AUTH_MODE: 'firebase',
  POCKETQA_FIREBASE_PROJECT_ID: 'pocketqa-optijara',
  POCKETQA_FIREBASE_WEB_API_KEY: 'public-web-key', // check-secrets: allow (placeholder public Firebase web config in tests)
  POCKETQA_PUBLIC_ORIGIN: 'https://pocketqa.example',
  POCKETQA_STORAGE: 'r2',
  POCKETQA_R2_ACCOUNT_ID: 'a'.repeat(32),
  POCKETQA_R2_BUCKET: 'pocketqa-evidence',
  POCKETQA_R2_ACCESS_KEY_ID: 'key-id',
  POCKETQA_R2_SECRET_ACCESS_KEY: 'not-a-real-secret', // check-secrets: allow (placeholder test value)
  POCKETQA_R2_ALLOW_DELETE: '1',
  POCKETQA_SETTLEMENT: 'simulated',
};

describe('staging (hosted test deployment)', () => {
  it('loads with production security, Firestore data, labelled test credits and simulated settlement', () => {
    const c = loadConfig(staging);
    expect(c).toMatchObject({
      production: false,
      staging: true,
      dataBackend: 'firestore',
      authMode: 'firebase',
      storage: 'r2',
      sharedDemo: false,
      features: { testCredits: true, devnetTransfers: false, settlement: 'simulated' },
    });
  });

  it('needs no data directory (Firestore) and never touches git', () => {
    expect(() => loadConfig({ ...staging, POCKETQA_DATA_DIR: undefined })).not.toThrow();
  });

  it.each([
    ['local password accounts', { POCKETQA_AUTH_MODE: 'local' }, /firebase/],
    ['a demo- Firebase project', { POCKETQA_FIREBASE_PROJECT_ID: 'demo-pocketqa' }, /demo-/],
    ['the shared demo', { POCKETQA_SHARED_DEMO: '1' }, /shared demo/],
    ['local storage', { POCKETQA_STORAGE: 'local' }, /r2/],
    ['an R2 test endpoint', { POCKETQA_R2_ENDPOINT: 'http://127.0.0.1:9000' }, /test server/],
    ['retention-only R2', { POCKETQA_R2_ALLOW_DELETE: '0', POCKETQA_R2_RETAIN_NONPROD: '1' }, /RETAIN_NONPROD/],
    ['no public origin', { POCKETQA_PUBLIC_ORIGIN: undefined }, /PUBLIC_ORIGIN/],
    ['a localhost origin', { POCKETQA_PUBLIC_ORIGIN: 'http://localhost:8081' }, /https on a public host/],
    ['the devnet pilot (server-held keys)', { POCKETQA_SETTLEMENT: 'squads_devnet' }, /devnet pilot/],
  ])('refuses %s', (_label, change, msg) => {
    expect(() => loadConfig({ ...staging, ...change })).toThrow(msg);
  });

  it('POCKETQA_DATA_BACKEND accepts only sqlite or firestore, and sqlite is the local default', () => {
    expect(() => loadConfig({ ...staging, POCKETQA_DATA_BACKEND: 'postgres' })).toThrow(/POCKETQA_DATA_BACKEND/);
    expect(loadConfig({}).dataBackend).toBe('sqlite');
  });
});
