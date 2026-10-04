// Creates a local admin account. Admins can never be created through the HTTP API.
//   pnpm --filter @pocket-qa/api admin:create admin@example.test
// The password is read from a no-echo prompt (or from stdin when piped), never from argv
// or the environment, so it stays out of shell history.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Email, Password } from '@pocket-qa/contracts';
import { loadConfig, readEnvFile, REPO_ROOT } from '../src/config';
import { openDb } from '../src/db';
import { hashPassword, iso, newId } from '../src/util';

async function readPassword(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  if (process.stdin.isTTY) {
    process.stdout.write(prompt);
    // Suppress echo of typed characters.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
  }
  const line = await new Promise<string>((resolve) => rl.once('line', resolve));
  rl.close();
  if (process.stdin.isTTY) process.stdout.write('\n');
  return line;
}

const email = Email.parse(process.argv[2]);
const password = Password.parse(await readPassword('Admin password (min 12 chars): '));
const config = loadConfig({ ...readEnvFile(join(REPO_ROOT, '.env.local')), ...process.env });
// Local password admins exist only for local auth. Production (firebase) promotes a verified
// managed identity instead: pnpm --filter @pocket-qa/api admin:grant <email>.
if (config.authMode !== 'local') {
  console.error('This deployment uses managed sign-in; local password admins are refused. Use admin:grant.');
  process.exit(1);
}
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
const db = openDb(join(config.dataDir, 'pocketqa.sqlite'));
if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
  console.error('An account with that email already exists.');
  process.exit(1);
}
db.prepare(`INSERT INTO users (id, email, password_hash, display_name, role, status, created_at) VALUES (?,?,?,?, 'admin', 'active', ?)`).run(
  newId(),
  email,
  await hashPassword(password),
  'Admin',
  iso(Date.now()),
);
console.log('Admin account created.');
