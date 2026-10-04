import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp, loggerOptions } from './app';
import { loadConfig, readEnvFile, REPO_ROOT } from './config';
import { openDb } from './db';
import { localStore } from './storage/local';
import { sweepStorage } from './storage/sweep';
import { httpDevnetRpc } from './rpc';

const config = loadConfig({ ...readEnvFile(join(REPO_ROOT, '.env.local')), ...process.env });
mkdirSync(join(config.dataDir, 'media'), { recursive: true, mode: 0o700 });
const db = openDb(join(config.dataDir, 'pocketqa.sqlite'));
const deps = {
    db,
    config,
    now: Date.now,
    rpc: httpDevnetRpc(config.rpcUrl),
    mediaDir: join(config.dataDir, 'media'),
    // Provider SDKs load only when their mode is configured, so local mode (and the shared
    // preview) start without them.
    identity: config.firebase ? (await import('./identity/firebase')).firebaseIdentity(config.firebase) : null,
    store: config.r2 ? (await import('./storage/r2')).r2Store(config.r2) : localStore(join(config.dataDir, 'media')),
};
const app = await buildApp(deps, { logger: loggerOptions() });
// loadConfig guarantees a loopback host; never bind 0.0.0.0.
await app.listen({ host: config.host, port: config.port });
// Storage housekeeping: expire abandoned uploads, clear quarantine, retry deletions.
const sweep = () =>
  sweepStorage({ db, store: deps.store, now: Date.now }).catch(() => app.log.warn('storage sweep failed; will retry'));
void sweep();
setInterval(sweep, 60_000).unref();
