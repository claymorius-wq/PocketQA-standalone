// Starts an isolated, explicitly NON-PRODUCTION API against the real Firebase project and the real
// R2 bucket, for the live web end-to-end run (docs/production/web-launch.md). Settings come from the
// operator's ~/.config/pocketqa files (0600; values never printed). Synthetic data only:
//   POCKETQA_ENV=development, R2 retention-only (POCKETQA_R2_RETAIN_NONPROD=1), deletion OFF.
// The production guards are unchanged: this mode is refused when POCKETQA_ENV=production.
import { readFileSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = join(homedir(), '.config/pocketqa');
const env = { PATH: process.env.PATH, HOME: process.env.HOME };
for (const f of ['r2.env', 'firebase.env']) {
  for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
    const m = /^(POCKETQA_[A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
}
Object.assign(env, {
  POCKETQA_ENV: 'development',
  POCKETQA_R2_RETAIN_NONPROD: '1',
  POCKETQA_R2_ALLOW_DELETE: '0',
  POCKETQA_API_PORT: process.env.LIVE_API_PORT ?? '8797',
  // The app is loaded from the production origin in the test (mapped to this API), as deployed.
  POCKETQA_PUBLIC_ORIGIN: 'https://pocketqa.optijara.ai',
  POCKETQA_DATA_DIR: mkdtempSync(join(tmpdir(), 'pqa-live-web-')),
  GOOGLE_APPLICATION_CREDENTIALS: join(dir, 'pocketqa-api.json'),
});
const child = spawn('pnpm', ['--filter', '@pocket-qa/api', 'start'], { env, stdio: 'inherit' });
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => child.kill('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
