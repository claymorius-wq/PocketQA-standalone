import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp, loggerOptions } from './app';
import { loadConfig, readEnvFile, REPO_ROOT } from './config';
import { openDb } from './db';
import { firebaseIdentity } from './identity/firebase';
import { httpDevnetRpc } from './rpc';

const config = loadConfig({ ...readEnvFile(join(REPO_ROOT, '.env.local')), ...process.env });
mkdirSync(join(config.dataDir, 'media'), { recursive: true, mode: 0o700 });
const db = openDb(join(config.dataDir, 'pocketqa.sqlite'));
const app = await buildApp(
  {
    db,
    config,
    now: Date.now,
    rpc: httpDevnetRpc(config.rpcUrl),
    mediaDir: join(config.dataDir, 'media'),
    identity: config.firebase ? firebaseIdentity(config.firebase) : null,
  },
  { logger: loggerOptions() },
);
// loadConfig guarantees a loopback host; never bind 0.0.0.0.
await app.listen({ host: config.host, port: config.port });
