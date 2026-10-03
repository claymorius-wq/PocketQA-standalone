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

  it('the shared synthetic demo never runs with managed identity', () => {
    expect(loadConfig({ ...base, POCKETQA_SHARED_DEMO: '1' }).sharedDemo).toBe(true);
    expect(() => loadConfig({ ...fb, POCKETQA_SHARED_DEMO: '1' })).toThrow(/shared demo/);
  });
});
