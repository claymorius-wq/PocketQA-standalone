import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, REPO_ROOT } from '../src/config';

// Production mode (docs/production/acceptance-ledger.md I1, D1–D4, O9): every demo,
// emulator and non-production path is refused at startup, never silently weakened.
const dataDir = mkdtempSync(join(tmpdir(), 'pqa-prod-'));
const prod = {
  POCKETQA_ENV: 'production',
  POCKETQA_DATA_DIR: dataDir,
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
};

describe('production mode (POCKETQA_ENV=production)', () => {
  it('a complete production config loads, with demo features off', () => {
    const c = loadConfig(prod);
    expect(c).toMatchObject({ production: true, authMode: 'firebase', sharedDemo: false, walletLogin: false, storage: 'r2', features: { testCredits: false, devnetTransfers: false } });
  });

  it('development stays the default and keeps the local test features', () => {
    expect(loadConfig({ POCKETQA_DATA_DIR: dataDir })).toMatchObject({ production: false, features: { testCredits: true, devnetTransfers: true } });
    expect(() => loadConfig({ POCKETQA_DATA_DIR: dataDir, POCKETQA_ENV: 'prod' })).toThrow(/POCKETQA_ENV/);
  });

  it('real providers without an explicit POCKETQA_ENV refuse to start (no silent development mode)', () => {
    const { POCKETQA_ENV: _, ...unset } = prod;
    expect(() => loadConfig(unset)).toThrow(/set POCKETQA_ENV explicitly/);
    expect(() => loadConfig({ POCKETQA_DATA_DIR: dataDir, POCKETQA_AUTH_MODE: 'firebase', POCKETQA_FIREBASE_PROJECT_ID: 'pocketqa-optijara', POCKETQA_FIREBASE_WEB_API_KEY: 'k' })).toThrow(/POCKETQA_ENV/);
    const { POCKETQA_ENV: __, POCKETQA_AUTH_MODE: ___, ...r2Only } = { ...prod, POCKETQA_R2_ALLOW_DELETE: '0', POCKETQA_R2_RETAIN_NONPROD: '1' };
    expect(() => loadConfig(r2Only)).toThrow(/POCKETQA_ENV/);
    // Explicit development is a deliberate choice (synthetic data, live tests).
    expect(loadConfig({ ...r2Only, POCKETQA_ENV: 'development' }).production).toBe(false);
  });

  it('refuses local password auth and the shared demo', () => {
    expect(() => loadConfig({ ...prod, POCKETQA_AUTH_MODE: 'local' })).toThrow(/production.*firebase/i);
    expect(() => loadConfig({ ...prod, POCKETQA_SHARED_DEMO: '1' })).toThrow(ConfigError);
  });

  it('refuses emulators and demo- Firebase projects', () => {
    expect(() => loadConfig({ ...prod, POCKETQA_FIREBASE_PROJECT_ID: 'demo-pocketqa', POCKETQA_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...prod, POCKETQA_FIREBASE_PROJECT_ID: 'demo-pocketqa' })).toThrow(/demo-/);
  });

  it('needs an https public origin that is not loopback', () => {
    const { POCKETQA_PUBLIC_ORIGIN: _, ...noOrigin } = prod;
    expect(() => loadConfig(noOrigin)).toThrow(/POCKETQA_PUBLIC_ORIGIN/);
    for (const o of ['http://localhost:8081', 'https://localhost', 'https://127.0.0.1', 'https://127.1', 'https://0.0.0.0', 'https://[::1]', 'https://192.168.1.10', 'https://10.0.2.2']) {
      expect(() => loadConfig({ ...prod, POCKETQA_PUBLIC_ORIGIN: o }), o).toThrow(/POCKETQA_PUBLIC_ORIGIN/);
    }
  });

  it('needs private R2 with an approved deletion policy (no retention-only mode, no local media)', () => {
    expect(() => loadConfig({ ...prod, POCKETQA_STORAGE: 'local' })).toThrow(/r2/);
    const { POCKETQA_R2_ALLOW_DELETE: _, ...noDelete } = prod;
    expect(() => loadConfig({ ...noDelete, POCKETQA_R2_RETAIN_NONPROD: '1' })).toThrow(/RETAIN_NONPROD/);
    expect(() => loadConfig({ ...prod, POCKETQA_R2_ENDPOINT: 'http://127.0.0.1:9000' })).toThrow(/test server/);
  });

  it('wallet login needs the recorded risk acceptance (ADR 0005 §2)', () => {
    expect(() => loadConfig({ ...prod, POCKETQA_WALLET_LOGIN: '1' })).toThrow(/ADR 0005/);
    expect(loadConfig({ ...prod, POCKETQA_WALLET_LOGIN: '1', POCKETQA_WALLET_LOGIN_RISK_ACCEPTED: '1' }).walletLogin).toBe(true);
  });

  it('keeps production data outside the repo (never the demo preview-data)', () => {
    expect(() => loadConfig({ ...prod, POCKETQA_DATA_DIR: join(REPO_ROOT, 'apps/api/.data') })).toThrow(/outside the repository/);
    expect(() => loadConfig({ ...prod, POCKETQA_DATA_DIR: join(REPO_ROOT, 'preview-data') })).toThrow(/outside the repository/);
  });
});
