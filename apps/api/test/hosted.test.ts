import { describe, expect, it, vi } from 'vitest';
import { IDEMPOTENCY_PENDING_MS } from '../src/repo/core/firestore';

// Hosted entry (src/hosted): config refusals, the /api prefix, the idempotency lease against the
// function's maxDuration (pqa-qa early r1 P3), and that the hosted bundle never loads native modules.

// The hosted path must not load better-sqlite3 or argon2 (left out of the Vercel bundle).
vi.mock('better-sqlite3', () => {
  throw new Error('better-sqlite3 loaded on the hosted path');
});
vi.mock('@node-rs/argon2', () => {
  throw new Error('argon2 loaded on the hosted path');
});

const base = {
  POCKETQA_DATA_BACKEND: 'firestore',
  POCKETQA_AUTH_MODE: 'firebase',
  POCKETQA_FIREBASE_PROJECT_ID: 'demo-pocketqa',
  POCKETQA_FIREBASE_WEB_API_KEY: 'public-web-key', // check-secrets: allow (placeholder public Firebase web config in tests)
  POCKETQA_STORAGE: 'r2',
  POCKETQA_R2_ACCOUNT_ID: '0'.repeat(32),
  POCKETQA_R2_BUCKET: 'pqa-test',
  POCKETQA_R2_ACCESS_KEY_ID: 'k',
  POCKETQA_R2_SECRET_ACCESS_KEY: 's', // check-secrets: allow (placeholder test value)
  POCKETQA_R2_ENDPOINT: 'http://127.0.0.1:9',
  POCKETQA_R2_ALLOW_DELETE: '1',
  CRON_SECRET: 'c'.repeat(40),
};

describe('hosted entry', () => {
  it('imports without loading native modules (better-sqlite3, argon2)', async () => {
    const mod = await import('../src/hosted/vercel');
    expect(typeof mod.default).toBe('function');
  });

  it('strips the /api prefix the Vercel route keeps', async () => {
    const { stripApiPrefix } = await import('../src/hosted/vercel');
    expect(stripApiPrefix('/api/me')).toBe('/me');
    expect(stripApiPrefix('/api/studies/s1?x=1')).toBe('/studies/s1?x=1');
    expect(stripApiPrefix('/api')).toBe('/');
    expect(stripApiPrefix('/api?x=1')).toBe('/?x=1');
    expect(stripApiPrefix('/apiary')).toBe('/apiary');
    expect(stripApiPrefix('/me')).toBe('/me');
  });

  it.each([
    ['SQLite data', { POCKETQA_DATA_BACKEND: 'sqlite' }, /only on Firestore/],
    ['local sign-in', { POCKETQA_AUTH_MODE: 'local' }, /only on Firestore/],
    ['local storage', { POCKETQA_STORAGE: 'local' }, /only on Firestore/],
    ['no cron secret', { CRON_SECRET: undefined }, /CRON_SECRET/],
    ['a short cron secret', { CRON_SECRET: 'short' }, /CRON_SECRET/],
  ])('refuses %s', async (_label, change, msg) => {
    const { hostedConfig } = await import('../src/hosted/app');
    expect(() => hostedConfig({ ...base, ...change })).toThrow(msg);
  });

  it('accepts the emulator-shaped hosted config', async () => {
    const { hostedConfig } = await import('../src/hosted/app');
    expect(hostedConfig(base).config.dataBackend).toBe('firestore');
  });

  it('an idempotency reservation outlives the longest request (P3: lease >= 2 x maxDuration)', async () => {
    const { MAX_DURATION_S } = await import('../src/hosted/app');
    expect(IDEMPOTENCY_PENDING_MS).toBeGreaterThanOrEqual(2 * MAX_DURATION_S * 1000);
  });
});
