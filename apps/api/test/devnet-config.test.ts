import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { MAINNET_USDC_MINT } from '@pocket-qa/domain';
import { loadConfig } from '../src/config';
import { hostedConfig } from '../src/hosted/app';
import { assertPlatformSigner, loadPlatformSigner } from '../src/settlement/squads/devnetSigner';
import { DEVNET_GENESIS, MAINNET_GENESIS, PILOT_MINT } from '../src/settlement/squads/pins';

// POCKETQA_ENV=devnet (docs/plans/devnet-phase-contract.md, amendments r1): a NEW mode with its own
// guards. Every existing refusal keeps its exact message and behaviour (CH: wrapped, not removed).

const canary = Keypair.generate();
const canaryJson = JSON.stringify(Array.from(canary.secretKey));
const arbiter = Keypair.generate().publicKey.toBase58();
const feeWallet = Keypair.generate().publicKey.toBase58();

const devnet = {
  POCKETQA_ENV: 'devnet',
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
  POCKETQA_SETTLEMENT: 'squads_devnet',
  POCKETQA_DEVNET_PLATFORM_SIGNER: canaryJson,
  POCKETQA_DEVNET_PLATFORM_PUBKEY: canary.publicKey.toBase58(),
  POCKETQA_DEVNET_ARBITER_PUBKEY: arbiter,
  POCKETQA_DEVNET_FEE_WALLET: feeWallet,
  POCKETQA_DEVNET_ALLOWED_EMAILS: 'devnet-builder@example.test, devnet-tester@example.test',
};
const staging = { ...devnet, POCKETQA_ENV: 'staging', POCKETQA_SETTLEMENT: 'simulated' } as Record<string, string | undefined>;
for (const k of Object.keys(staging)) if (k.startsWith('POCKETQA_DEVNET_')) delete staging[k];
const production = { ...staging, POCKETQA_ENV: 'production', POCKETQA_SETTLEMENT: 'off' };

const messageOf = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe('POCKETQA_ENV=devnet', () => {
  it('loads: hosted security, Firestore, the Squads devnet settlement, the devnet settings (no key in config)', () => {
    const c = loadConfig(devnet);
    expect(c).toMatchObject({ production: false, staging: false, dataBackend: 'firestore', authMode: 'firebase', storage: 'r2', features: { devnetTransfers: false, settlement: 'squads_devnet' }, pilotKeysDir: null });
    expect(c.devnet).toEqual({ platform: canary.publicKey.toBase58(), arbiter, feeWallet, allowedEmails: ['devnet-builder@example.test', 'devnet-tester@example.test'], signer: { kind: 'env' } });
    expect(JSON.stringify(c)).not.toContain(canaryJson);
    expect(c.rpcUrl).toBe('https://api.devnet.solana.com');
  });

  it.each([
    ['simulated settlement', { POCKETQA_SETTLEMENT: 'simulated' }, /runs only with POCKETQA_SETTLEMENT=squads_devnet/],
    ['settlement off', { POCKETQA_SETTLEMENT: 'off' }, /runs only with POCKETQA_SETTLEMENT=squads_devnet/],
    ['SQLite data', { POCKETQA_DATA_BACKEND: 'sqlite', POCKETQA_DATA_DIR: '/tmp/pqa-devnet-x' }, /Firestore/],
    ['the pilot key directory (server-held keys for every role)', { POCKETQA_SETTLEMENT_PILOT_KEYS_DIR: '/tmp' }, /POCKETQA_SETTLEMENT_PILOT_KEYS_DIR/],
    ['no platform signer', { POCKETQA_DEVNET_PLATFORM_SIGNER: undefined }, /exactly one of POCKETQA_DEVNET_PLATFORM_SIGNER/],
    ['two signer sources', { POCKETQA_DEVNET_PLATFORM_SIGNER_FILE: '/tmp/x.json' }, /exactly one of POCKETQA_DEVNET_PLATFORM_SIGNER/],
    ['an invalid arbiter key', { POCKETQA_DEVNET_ARBITER_PUBKEY: 'nope' }, /POCKETQA_DEVNET_ARBITER_PUBKEY/],
    ['no fee wallet', { POCKETQA_DEVNET_FEE_WALLET: undefined }, /POCKETQA_DEVNET_FEE_WALLET/],
    ['an empty allow-list', { POCKETQA_DEVNET_ALLOWED_EMAILS: '' }, /POCKETQA_DEVNET_ALLOWED_EMAILS/],
    ['a real (non-synthetic) account on the allow-list', { POCKETQA_DEVNET_ALLOWED_EMAILS: 'someone@gmail.com' }, /@example\.test/],
    ['a non-https RPC', { POCKETQA_SOLANA_RPC_URL: 'http://api.devnet.solana.com' }, /https/],
    ['no pinned platform key', { POCKETQA_DEVNET_PLATFORM_PUBKEY: undefined }, /POCKETQA_DEVNET_PLATFORM_PUBKEY/],
    ['the arbiter as the platform key', { POCKETQA_DEVNET_PLATFORM_PUBKEY: arbiter }, /three different keys/],
    ['the fee wallet as the arbiter', { POCKETQA_DEVNET_ARBITER_PUBKEY: feeWallet }, /three different keys/],
    ['the shared demo', { POCKETQA_SHARED_DEMO: '1' }, /shared demo/],
  ])('refuses %s', (_, over, msg) => {
    expect(() => loadConfig({ ...devnet, ...over })).toThrow(msg);
  });

  it('the hosted API runs it (and still refuses the pilot everywhere else)', () => {
    expect(hostedConfig({ ...devnet, CRON_SECRET: 'c'.repeat(40) } as NodeJS.ProcessEnv).config.devnet).not.toBeNull();
  });

  it('the pins are devnet and never mainnet (B2)', () => {
    expect(PILOT_MINT).toBe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    expect(PILOT_MINT).not.toBe(MAINNET_USDC_MINT);
    expect(DEVNET_GENESIS).toBe('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
    expect(DEVNET_GENESIS).not.toBe(MAINNET_GENESIS);
  });
});

describe('devnet settings outside POCKETQA_ENV=devnet (CH-D4: production refuses the signer)', () => {
  it.each([
    ['production', production],
    ['staging', staging],
    ['development', { POCKETQA_DATA_DIR: '/tmp/pqa-devnet-dev' }],
  ])('%s refuses POCKETQA_DEVNET_PLATFORM_SIGNER and every other POCKETQA_DEVNET_ setting, never echoing a value', (_, env) => {
    for (const k of ['POCKETQA_DEVNET_PLATFORM_SIGNER', 'POCKETQA_DEVNET_PLATFORM_SIGNER_FILE', 'POCKETQA_DEVNET_ARBITER_PUBKEY', 'POCKETQA_DEVNET_ALLOWED_EMAILS']) {
      const m = messageOf(() => loadConfig({ ...env, [k]: k.endsWith('SIGNER') ? canaryJson : 'x' }));
      expect(m).toMatch(new RegExp(`${k}.*only for POCKETQA_ENV=devnet`));
      expect(m).not.toContain(canaryJson);
    }
  });
});

describe('existing refusals keep their exact messages (wrapped, not removed)', () => {
  it.each([
    ['an unknown env', { POCKETQA_ENV: 'prod' }, 'POCKETQA_ENV must be development, staging or production.'],
    ['production with simulated settlement', { ...production, POCKETQA_SETTLEMENT: 'simulated' }, 'Simulated settlement and the devnet pilot never run in production (ADR 0007): set POCKETQA_SETTLEMENT=off.'],
    ['production with the devnet pilot', { ...production, POCKETQA_SETTLEMENT: 'squads_devnet' }, 'Simulated settlement and the devnet pilot never run in production (ADR 0007): set POCKETQA_SETTLEMENT=off.'],
    ['staging with the devnet pilot', { ...staging, POCKETQA_SETTLEMENT: 'squads_devnet' }, 'Staging never runs the devnet pilot (server-held test keys): use POCKETQA_SETTLEMENT=simulated or off.'],
    [
      'the shared demo with the devnet pilot',
      { POCKETQA_DATA_DIR: '/tmp/pqa-devnet-demo', POCKETQA_SHARED_DEMO: '1', POCKETQA_SETTLEMENT: 'squads_devnet' },
      'The shared demo never runs the devnet pilot: its server-held test keys would sign for any visitor. Use POCKETQA_SETTLEMENT=simulated (labelled) or off.',
    ],
  ])('%s', (_, env, msg) => {
    expect(messageOf(() => loadConfig(env))).toBe(msg);
  });

  it('the hosted API still refuses the pilot outside devnet, word for word', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-pilot-'));
    chmodSync(dir, 0o700);
    const env = { ...staging, POCKETQA_ENV: 'development', POCKETQA_SETTLEMENT: 'squads_devnet', POCKETQA_SETTLEMENT_PILOT_KEYS_DIR: dir, CRON_SECRET: 'c'.repeat(40) };
    expect(messageOf(() => hostedConfig(env as NodeJS.ProcessEnv))).toBe('The hosted API never runs the devnet pilot.');
  });
});

describe('loadPlatformSigner (CH-D4: one server key, never printed)', () => {
  it('from the env value (Vercel Preview)', () => {
    expect(loadPlatformSigner({ POCKETQA_DEVNET_PLATFORM_SIGNER: canaryJson }).publicKey.toBase58()).toBe(canary.publicKey.toBase58());
  });

  it('from a 0600 file in a 0700 directory (local live runs); looser modes are refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pqa-signer-'));
    chmodSync(dir, 0o700);
    const file = join(dir, 'pocketqa.json');
    writeFileSync(file, canaryJson, { mode: 0o600 });
    expect(loadPlatformSigner({ POCKETQA_DEVNET_PLATFORM_SIGNER_FILE: file }).publicKey.equals(canary.publicKey)).toBe(true);
    chmodSync(file, 0o644);
    expect(() => loadPlatformSigner({ POCKETQA_DEVNET_PLATFORM_SIGNER_FILE: file })).toThrow(/0600/);
    chmodSync(file, 0o600);
    chmodSync(dir, 0o755);
    expect(() => loadPlatformSigner({ POCKETQA_DEVNET_PLATFORM_SIGNER_FILE: file })).toThrow(/0700/);
  });

  it.each([
    ['not JSON', canaryJson.slice(0, -3)],
    ['the wrong length', JSON.stringify(Array.from(canary.secretKey).slice(0, 63))],
    ['a mismatched public half', JSON.stringify([...Array.from(canary.secretKey).slice(0, 32), ...Array.from(Keypair.generate().publicKey.toBytes())])],
  ])('refuses %s, and the error never contains the value', (_, value) => {
    const m = messageOf(() => loadPlatformSigner({ POCKETQA_DEVNET_PLATFORM_SIGNER: value }));
    expect(m).toMatch(/POCKETQA_DEVNET_PLATFORM_SIGNER/);
    expect(m).not.toContain(value);
    expect(m).not.toMatch(/\d+,\d+,\d+/);
  });
});

describe('assertPlatformSigner (pqa-qa P2-DA1)', () => {
  const roles = { platform: canary.publicKey.toBase58(), arbiter, feeWallet };
  it('accepts the pinned key', () => {
    expect(() => assertPlatformSigner(canary, roles)).not.toThrow();
  });
  it('refuses a different key than the pinned one (e.g. the builder fixture loaded by mistake)', () => {
    expect(() => assertPlatformSigner(Keypair.generate(), roles)).toThrow(/not POCKETQA_DEVNET_PLATFORM_PUBKEY/);
  });
  it('refuses when the platform key is also the study builder wallet (a server-held second vote)', () => {
    expect(() => assertPlatformSigner(canary, { ...roles, builderWallet: canary.publicKey.toBase58() })).toThrow(/another role/);
  });
  it('the RPC host is not trusted to name the cluster (devnet.example.com passes config; the genesis is read at runtime)', () => {
    expect(() => loadConfig({ ...devnet, POCKETQA_SOLANA_RPC_URL: 'https://devnet.example.com' })).not.toThrow();
  });
});
