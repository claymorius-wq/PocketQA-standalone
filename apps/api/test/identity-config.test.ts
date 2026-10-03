import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';

// ADR 0005: misconfiguration of managed identity fails at startup, never silently weakens auth.
const base = { POCKETQA_DATA_DIR: tmpdir() };
const fb = { ...base, POCKETQA_AUTH_MODE: 'firebase', POCKETQA_FIREBASE_PROJECT_ID: 'pocketqa-staging', POCKETQA_FIREBASE_WEB_API_KEY: 'public-web-key' }; // check-secrets: allow (placeholder public Firebase web config in tests)

describe('managed identity config', () => {
  it('defaults to local auth with no Firebase', () => {
    expect(loadConfig(base)).toMatchObject({ authMode: 'local', firebase: null, sharedDemo: false });
  });

  it('firebase mode needs a project id and the public web API key', () => {
    expect(loadConfig(fb).firebase).toEqual({ projectId: 'pocketqa-staging', webApiKey: 'public-web-key', authDomain: 'pocketqa-staging.firebaseapp.com', authEmulatorHost: null }); // check-secrets: allow (placeholder public Firebase web config in tests)
    expect(() => loadConfig({ ...fb, POCKETQA_FIREBASE_PROJECT_ID: '' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...fb, POCKETQA_FIREBASE_WEB_API_KEY: '' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, POCKETQA_AUTH_MODE: 'magic' })).toThrow(ConfigError);
  });

  it('the Auth emulator (which accepts unsigned tokens) is only allowed for demo- projects on loopback', () => {
    expect(loadConfig({ ...fb, POCKETQA_FIREBASE_PROJECT_ID: 'demo-pocketqa', POCKETQA_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }).firebase?.authEmulatorHost).toBe('127.0.0.1:9099');
    expect(() => loadConfig({ ...fb, POCKETQA_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow(/demo-/);
    expect(() => loadConfig({ ...fb, POCKETQA_FIREBASE_PROJECT_ID: 'demo-pocketqa', POCKETQA_FIREBASE_AUTH_EMULATOR_HOST: '10.0.0.5:9099' })).toThrow(/loopback/);
  });

  it('refuses a stray raw FIREBASE_AUTH_EMULATOR_HOST outside an explicit demo emulator setup', () => {
    expect(() => loadConfig({ ...fb, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
    expect(() => loadConfig({ ...base, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
  });

  it('wallet login is opt-in and never runs on the shared demo (it creates accounts)', () => {
    expect(loadConfig(base).walletLogin).toBe(false);
    // Wallet login needs the real public origin for its sign-in domain (review r1 P2).
    expect(() => loadConfig({ ...base, POCKETQA_WALLET_LOGIN: '1' })).toThrow(/POCKETQA_PUBLIC_ORIGIN/);
    expect(loadConfig({ ...base, POCKETQA_WALLET_LOGIN: '1', POCKETQA_PUBLIC_ORIGIN: 'https://app.pocketqa.example' })).toMatchObject({ walletLogin: true, publicOrigin: 'https://app.pocketqa.example' });
    expect(loadConfig({ ...base, POCKETQA_WALLET_LOGIN: '1', POCKETQA_PUBLIC_ORIGIN: 'http://localhost:8081' }).publicOrigin).toBe('http://localhost:8081');
    for (const bad of ['http://app.pocketqa.example', 'https://app.pocketqa.example/path', 'https://user@app.pocketqa.example', 'pocketqa.local', 'https://*.example']) {
      expect(() => loadConfig({ ...base, POCKETQA_WALLET_LOGIN: '1', POCKETQA_PUBLIC_ORIGIN: bad }), bad).toThrow(ConfigError);
    }
    expect(() => loadConfig({ ...base, POCKETQA_SHARED_DEMO: '1', POCKETQA_WALLET_LOGIN: '1', POCKETQA_PUBLIC_ORIGIN: 'https://app.pocketqa.example' })).toThrow(/wallet login/);
  });

  it('the shared synthetic demo never runs with managed identity', () => {
    expect(loadConfig({ ...base, POCKETQA_SHARED_DEMO: '1' }).sharedDemo).toBe(true);
    expect(() => loadConfig({ ...fb, POCKETQA_SHARED_DEMO: '1' })).toThrow(/shared demo/);
  });
});

describe('storage config (ADR 0005 §3)', () => {
  const r2 = { ...base, POCKETQA_STORAGE: 'r2', POCKETQA_R2_ACCOUNT_ID: 'a'.repeat(32), POCKETQA_R2_BUCKET: 'pqa-staging', POCKETQA_R2_ACCESS_KEY_ID: 'key-id', POCKETQA_R2_SECRET_ACCESS_KEY: 'not-a-real-secret' }; // check-secrets: allow (placeholder test values)

  it('defaults to local storage; r2 needs account, bucket and server-side keys', () => {
    expect(loadConfig(base)).toMatchObject({ storage: 'local', r2: null });
    expect(loadConfig(r2).r2).toMatchObject({ bucket: 'pqa-staging', endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com` });
    for (const k of ['POCKETQA_R2_ACCOUNT_ID', 'POCKETQA_R2_BUCKET', 'POCKETQA_R2_ACCESS_KEY_ID', 'POCKETQA_R2_SECRET_ACCESS_KEY']) {
      expect(() => loadConfig({ ...r2, [k]: '' }), k).toThrow(ConfigError);
    }
    expect(() => loadConfig({ ...base, POCKETQA_STORAGE: 's3' })).toThrow(ConfigError);
  });

  it('the endpoint override is for loopback test servers only', () => {
    expect(loadConfig({ ...r2, POCKETQA_R2_ENDPOINT: 'http://127.0.0.1:9000' }).r2?.endpoint).toBe('http://127.0.0.1:9000');
    expect(() => loadConfig({ ...r2, POCKETQA_R2_ENDPOINT: 'http://evil.example:9000' })).toThrow(/loopback/);
    expect(() => loadConfig({ ...r2, POCKETQA_R2_ENDPOINT: 'https://other-account.r2.cloudflarestorage.com' })).toThrow(/loopback/);
  });

  it('the shared demo never uses real storage', () => {
    expect(() => loadConfig({ ...r2, POCKETQA_SHARED_DEMO: '1' })).toThrow(/shared demo/);
  });
});
