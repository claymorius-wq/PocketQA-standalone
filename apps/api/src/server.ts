import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp, loggerOptions } from './app';
import { loadConfig, readEnvFile, REPO_ROOT } from './config';
import { PID_FILE } from './backup';
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
// Lets db:restore see a running API whatever port it uses (inc4 review P3-3).
const pidFile = join(config.dataDir, PID_FILE);
writeFileSync(pidFile, `${process.pid}\n`, { mode: 0o600 });
// loadConfig guarantees a loopback host; never bind 0.0.0.0.
await app.listen({ host: config.host, port: config.port });
// Storage housekeeping: expire abandoned uploads, clear quarantine, retry deletions.
const sweep = () =>
  sweepStorage({ db, store: deps.store, now: Date.now }).catch(() => app.log.warn('storage sweep failed; will retry'));
void sweep();
const sweeper = setInterval(sweep, 60_000);

// Clean stop for the process supervisor (ledger O4): stop accepting requests, let in-flight
// ones finish, then close the database so the WAL is checkpointed. A restart resumes from
// durable state (upload intents, the deletion outbox) on the next sweep.
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    clearInterval(sweeper);
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(() => db.close())
      .then(() => rmSync(pidFile, { force: true }))
      .then(() => process.exit(0), () => process.exit(1));
  });
}
