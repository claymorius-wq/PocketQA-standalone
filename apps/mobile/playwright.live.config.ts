import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// LIVE web end-to-end against the real Firebase project and the real R2 bucket (synthetic data,
// non-production API). Never part of `pnpm verify` or CI. Needs ~/.config/pocketqa/{r2.env,
// firebase.env,pocketqa-api.json}. Run from the repo root: pnpm test:e2e:live
//
// The web side is exactly what production ships: scripts/production/build-web.sh (production
// bundle, same-origin /api) served by scripts/production/web-server.mjs with its real CSP.
const r2Account = /^POCKETQA_R2_ACCOUNT_ID=([a-f0-9]{32})$/m.exec(readFileSync(join(homedir(), '.config/pocketqa/r2.env'), 'utf8'))?.[1];
if (!r2Account) throw new Error('~/.config/pocketqa/r2.env has no POCKETQA_R2_ACCOUNT_ID');

export default defineConfig({
  testDir: './e2e-live',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', actionTimeout: 30_000, ...devices['Pixel 7'] },
  webServer: [
    { command: 'node e2e-live/start-api.mjs', url: 'http://127.0.0.1:8797/health', reuseExistingServer: false, timeout: 90_000 },
    {
      command: `PROD_API_URL=/api bash ../../scripts/production/build-web.sh && WEB_PORT=8091 WEB_API_PORT=8797 WEB_PUBLIC_HOST=pocketqa.optijara.ai WEB_ROOT=dist-production WEB_R2_ACCOUNT_ID=${r2Account} node ../../scripts/production/web-server.mjs`,
      url: 'http://127.0.0.1:8091',
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
