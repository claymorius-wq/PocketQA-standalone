import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { API_DEFAULT_PORT, DEFAULT_SIWS_DOMAIN, isPublicHost, type AuthMode, type StorageMode } from '@pocket-qa/contracts';

/** Pocket QA's dedicated R2 bucket(s); add a staging bucket here only by decision (ADR 0005). */
export const R2_BUCKETS: readonly string[] = ['pocketqa-evidence'];

export type Config = {
  /**
   * POCKETQA_ENV=production (docs/production/acceptance-ledger.md): managed identity, an
   * https public origin, private R2 with an approved deletion policy, data outside the
   * repo, and no demo, emulator or test-credit paths. Default: development.
   */
  production: boolean;
  /**
   * Proxies whose X-Forwarded-For is trusted for the client address (per-client rate
   * limits). The API binds loopback only, so the only proxy that can exist is local:
   * `loopback` trusts 127.0.0.1 and ::1 and nothing else. Production defaults to it.
   */
  trustProxy: false | string[];
  /** Local test features; both off in production (no fake funding, no demo transfers). */
  features: { testCredits: boolean; devnetTransfers: boolean };
  host: '127.0.0.1' | '::1';
  port: number;
  dataDir: string;
  rpcUrl: string;
  siwsDomain: string;
  aiProvider: string | null;
  /** ADR 0005: 'local' password sessions (default) or 'firebase' managed identity. */
  authMode: AuthMode;
  /**
   * Firebase project settings. `webApiKey`/`authDomain` are public web config; the Admin
   * credential comes only from GOOGLE_APPLICATION_CREDENTIALS (never read or logged here).
   */
  firebase: { projectId: string; webApiKey: string; authDomain: string; authEmulatorHost: string | null } | null;
  /** The shared synthetic demo (preview): never runs with real-data features. */
  sharedDemo: boolean;
  /** Wallet-first login (ADR 0005 §2); off unless POCKETQA_WALLET_LOGIN=1. */
  walletLogin: boolean;
  /**
   * The app's real public origin (e.g. https://app.example). Wallet-login challenges use
   * its host as the SIWS domain so a `solana:signIn` wallet can refuse other origins.
   */
  publicOrigin: string | null;
  /** ADR 0005 §3: 'local' media directory (default) or private Cloudflare R2. */
  storage: StorageMode;
  /**
   * R2 (S3 API). The access key pair is server-only, read from the environment and never
   * logged or returned; `endpoint` is the account endpoint unless overridden for tests.
   */
  r2: { accountId: string; bucket: string; endpoint: string; accessKeyId: string; secretAccessKey: string; allowDelete: boolean } | null;
};

export class ConfigError extends Error {}

const LOOPBACK = new Set(['127.0.0.1', '::1']);
export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** Minimal .env parser for the gitignored `.env.local`; values never get logged. */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1]) out[m[1]] = (m[2] ?? '').replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function isGitIgnored(absDir: string): boolean {
  // Probe a file inside the directory: for a path that doesn't exist yet, git can't know
  // it is a directory, so dir-only patterns like `.data/` only match via a child path. The
  // probe name matches no file pattern, because media files have no extension.
  try {
    execFileSync('git', ['check-ignore', '-q', `${absDir}/pqa-ignore-probe`], { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Local-only guarantees enforced at startup: the API binds to loopback only, and its
 * data directory (SQLite + uploaded media) can never sit in a git-tracked location.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const envName = env.POCKETQA_ENV ?? 'development';
  if (envName !== 'development' && envName !== 'production') throw new ConfigError('POCKETQA_ENV must be development or production.');
  const production = envName === 'production';
  const host = env.POCKETQA_API_HOST ?? '127.0.0.1';
  if (!LOOPBACK.has(host)) throw new ConfigError(`POCKETQA_API_HOST must be 127.0.0.1 or ::1 (local-only build); got a non-loopback value.`);

  const port = Number(env.POCKETQA_API_PORT ?? API_DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('POCKETQA_API_PORT must be an integer port.');

  const dataDir = resolve(REPO_ROOT, env.POCKETQA_DATA_DIR ?? 'apps/api/.data');
  const rel = relative(REPO_ROOT, dataDir);
  const insideRepo = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  if (insideRepo && !isGitIgnored(dataDir)) {
    throw new ConfigError('POCKETQA_DATA_DIR is inside the repo but not git-ignored; refusing to store data there.');
  }
  // Production data never shares a directory with development or the demo (preview-data).
  if (production && insideRepo) throw new ConfigError('In production, POCKETQA_DATA_DIR must be outside the repository.');

  const rpcUrl = env.POCKETQA_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  if (!/^https?:\/\//.test(rpcUrl)) throw new ConfigError('POCKETQA_SOLANA_RPC_URL must be an http(s) URL.');

  const authMode = (env.POCKETQA_AUTH_MODE ?? 'local') as AuthMode;
  if (authMode !== 'local' && authMode !== 'firebase') throw new ConfigError('POCKETQA_AUTH_MODE must be local or firebase.');
  let firebase: Config['firebase'] = null;
  if (authMode === 'firebase') {
    const projectId = env.POCKETQA_FIREBASE_PROJECT_ID ?? '';
    const webApiKey = env.POCKETQA_FIREBASE_WEB_API_KEY ?? '';
    const authDomain = env.POCKETQA_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`;
    const authEmulatorHost = env.POCKETQA_FIREBASE_AUTH_EMULATOR_HOST || null;
    if (!/^[a-z0-9-]{4,40}$/.test(projectId)) throw new ConfigError('POCKETQA_FIREBASE_PROJECT_ID is required in firebase mode.');
    if (!webApiKey) throw new ConfigError('POCKETQA_FIREBASE_WEB_API_KEY (public web config) is required in firebase mode.');
    if (authEmulatorHost && !/^(127\.0\.0\.1|localhost):\d+$/.test(authEmulatorHost)) throw new ConfigError('POCKETQA_FIREBASE_AUTH_EMULATOR_HOST must be a loopback host:port.');
    // The emulator accepts unsigned tokens, so it is only allowed with a demo- project.
    if (authEmulatorHost && !projectId.startsWith('demo-')) throw new ConfigError('The Firebase Auth emulator may only be used with a demo- project id.');
    firebase = { projectId, webApiKey, authDomain, authEmulatorHost };
  }
  // firebase-admin also honours the raw FIREBASE_AUTH_EMULATOR_HOST and then accepts
  // unsigned tokens: refuse it unless this is an explicit demo- emulator setup.
  if (env.FIREBASE_AUTH_EMULATOR_HOST && !(firebase?.authEmulatorHost && firebase.projectId.startsWith('demo-'))) {
    throw new ConfigError('FIREBASE_AUTH_EMULATOR_HOST is set outside an explicit demo- emulator setup; refusing to start.');
  }
  if (production) {
    if (authMode !== 'firebase') throw new ConfigError('Production needs POCKETQA_AUTH_MODE=firebase (no local password accounts).');
    // Emulator hosts were refused above for non-demo projects; demo- projects are local-only.
    if (firebase!.projectId.startsWith('demo-')) throw new ConfigError('Production cannot use a demo- Firebase project.');
  }
  const sharedDemo = env.POCKETQA_SHARED_DEMO === '1';
  if (production && sharedDemo) throw new ConfigError('The shared demo never runs in production.');
  if (sharedDemo && authMode !== 'local') throw new ConfigError('The shared demo runs only with local auth (synthetic demo accounts).');
  const walletLogin = env.POCKETQA_WALLET_LOGIN === '1';
  // ADR 0005 §2: the operator sets this only after Hamza's acceptance is recorded there.
  if (production && walletLogin && env.POCKETQA_WALLET_LOGIN_RISK_ACCEPTED !== '1') {
    throw new ConfigError('Wallet login in production needs the residual-risk acceptance recorded in ADR 0005 §2 (POCKETQA_WALLET_LOGIN_RISK_ACCEPTED=1).');
  }
  // Wallet login can create accounts; the shared demo has no self-registration.
  if (sharedDemo && walletLogin) throw new ConfigError('The shared demo cannot enable wallet login (it creates accounts).');
  let publicOrigin: string | null = null;
  // Required for wallet login; optional otherwise (web wallet linking uses it when set).
  if (production && !env.POCKETQA_PUBLIC_ORIGIN) throw new ConfigError('Production needs POCKETQA_PUBLIC_ORIGIN (the exact https origin of the app).');
  if (walletLogin || env.POCKETQA_PUBLIC_ORIGIN) {
    const raw = env.POCKETQA_PUBLIC_ORIGIN ?? '';
    let u: URL | null;
    try {
      u = new URL(raw);
    } catch {
      u = null;
    }
    const loopback = u !== null && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    const ok = u !== null && (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) && !u.username && !u.password && !u.hostname.includes('*') && raw === u.origin;
    if (!ok) throw new ConfigError('POCKETQA_PUBLIC_ORIGIN must be the exact https origin of the app (http only for localhost); wallet login requires it.');
    if (production && (u!.protocol !== 'https:' || !isPublicHost(u!.hostname))) throw new ConfigError('In production, POCKETQA_PUBLIC_ORIGIN must be https on a public host (not localhost or a private address).');
    publicOrigin = u!.origin;
  }

  const storage = (env.POCKETQA_STORAGE ?? 'local') as StorageMode;
  if (storage !== 'local' && storage !== 'r2') throw new ConfigError('POCKETQA_STORAGE must be local or r2.');
  // Real uploads never go to the shared synthetic demo (its gate also refuses uploads).
  if (sharedDemo && storage !== 'local') throw new ConfigError('The shared demo runs only with local storage (no real uploads).');
  if (production && storage !== 'r2') throw new ConfigError('Production stores evidence in private r2 (POCKETQA_STORAGE=r2).');
  let r2: Config['r2'] = null;
  if (storage === 'r2') {
    const accountId = env.POCKETQA_R2_ACCOUNT_ID ?? '';
    const bucket = env.POCKETQA_R2_BUCKET ?? '';
    const accessKeyId = env.POCKETQA_R2_ACCESS_KEY_ID ?? '';
    const secretAccessKey = env.POCKETQA_R2_SECRET_ACCESS_KEY ?? '';
    if (!/^[a-f0-9]{32}$/.test(accountId)) throw new ConfigError('POCKETQA_R2_ACCOUNT_ID (32 hex) is required for r2 storage.');
    if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket)) throw new ConfigError('POCKETQA_R2_BUCKET is required for r2 storage.');
    const testServer = env.POCKETQA_R2_ENDPOINT !== undefined && env.POCKETQA_R2_ENDPOINT !== '';
    if (production && testServer) throw new ConfigError('Production cannot use an R2 test server endpoint (POCKETQA_R2_ENDPOINT).');
    // Retention-only mode exists for synthetic data; real users need real deletion (ledger S5).
    if (production && env.POCKETQA_R2_RETAIN_NONPROD === '1') throw new ConfigError('POCKETQA_R2_RETAIN_NONPROD is for synthetic data only and is refused in production.');
    if (!accessKeyId || !secretAccessKey) throw new ConfigError('POCKETQA_R2_ACCESS_KEY_ID and POCKETQA_R2_SECRET_ACCESS_KEY are required for r2 storage.');
    let endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    if (env.POCKETQA_R2_ENDPOINT) {
      // Override only for local S3-compatible test servers; never a remote plain-http host.
      if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.POCKETQA_R2_ENDPOINT)) throw new ConfigError('POCKETQA_R2_ENDPOINT may only point at a loopback test server.');
      endpoint = env.POCKETQA_R2_ENDPOINT;
    }
    // Deletion is off by default: deletes wait in the storage_deletions outbox (nothing is lost).
    // POCKETQA_R2_ALLOW_DELETE=1 turns on Hamza's scoped policy (A5, 2026-10-04): only objects
    // this app created and registered (storage_objects), only in its own bucket, only for
    // failed-upload cleanup, upload staging and account deletion (storage/sweep.ts). There is no
    // time-based expiry of evidence and no lifecycle rule.
    const allowDelete = env.POCKETQA_R2_ALLOW_DELETE === '1';
    // Only Pocket QA's own bucket is ever a write target, so a mistyped name with wider
    // credentials can't reach another project's bucket. Loopback test servers are exempt.
    if (!testServer && !R2_BUCKETS.includes(bucket)) throw new ConfigError(`POCKETQA_R2_BUCKET must be Pocket QA's own bucket (${R2_BUCKETS.join(', ')}).`);
    // With deletion off, account deletion can't erase recordings (and is refused), so r2 runs
    // without the scoped policy only for synthetic, non-production data.
    if (!allowDelete && env.POCKETQA_R2_RETAIN_NONPROD !== '1') {
      throw new ConfigError('r2 storage needs a deletion policy: POCKETQA_R2_ALLOW_DELETE=1 (approved) or POCKETQA_R2_RETAIN_NONPROD=1 (synthetic data only, objects retained).');
    }
    r2 = { accountId, bucket, endpoint, accessKeyId, secretAccessKey, allowDelete };
  }

  // Fail closed (inc1 review P2-1): real providers never fall back to development's test
  // credits, demo transfers or retention-only R2 just because POCKETQA_ENV was left out.
  const realFirebase = authMode === 'firebase' && !firebase!.projectId.startsWith('demo-');
  const realR2 = storage === 'r2' && !env.POCKETQA_R2_ENDPOINT;
  if ((realFirebase || realR2) && env.POCKETQA_ENV === undefined) {
    throw new ConfigError('A real Firebase project or real R2 is configured: set POCKETQA_ENV explicitly (production, or development for synthetic test data).');
  }

  const trust = env.POCKETQA_TRUST_PROXY ?? (production ? 'loopback' : 'none');
  if (trust !== 'loopback' && trust !== 'none') throw new ConfigError('POCKETQA_TRUST_PROXY must be loopback or none.');

  return {
    production,
    trustProxy: trust === 'loopback' ? ['127.0.0.1', '::1'] : false,
    features: { testCredits: !production, devnetTransfers: !production },
    host: host as Config['host'],
    port,
    dataDir,
    rpcUrl,
    // Fixed (not configurable) so it always matches the app's MWA identity URI.
    siwsDomain: DEFAULT_SIWS_DOMAIN,
    aiProvider: env.POCKETQA_AI_PROVIDER ? env.POCKETQA_AI_PROVIDER : null,
    authMode,
    firebase,
    sharedDemo,
    walletLogin,
    publicOrigin,
    storage,
    r2,
  };
}
