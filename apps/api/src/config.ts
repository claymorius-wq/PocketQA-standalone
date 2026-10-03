import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { API_DEFAULT_PORT, DEFAULT_SIWS_DOMAIN, type AuthMode } from '@pocket-qa/contracts';

export type Config = {
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
  const sharedDemo = env.POCKETQA_SHARED_DEMO === '1';
  if (sharedDemo && authMode !== 'local') throw new ConfigError('The shared demo runs only with local auth (synthetic demo accounts).');

  return {
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
  };
}
