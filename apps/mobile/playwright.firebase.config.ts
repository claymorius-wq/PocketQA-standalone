import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Firebase-mode browser tests (ADR 0005 §1) against the local Firebase Auth emulator on a
// demo- project: no account, no network. Run from the repo root with
//   pnpm test:e2e:firebase   (firebase emulators:exec --only auth --project demo-pocketqa …)
const dataDir = mkdtempSync(join(tmpdir(), 'pqa-e2e-fb-'));
const firebaseEnv = [
  'POCKETQA_AUTH_MODE=firebase',
  'POCKETQA_FIREBASE_PROJECT_ID=demo-pocketqa',
  'POCKETQA_FIREBASE_WEB_API_KEY=demo-web-api-key', // check-secrets: allow (emulator placeholder)
  'POCKETQA_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099',
  'FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099',
].join(' ');

export default defineConfig({
  testDir: './e2e-firebase',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:8090', trace: 'retain-on-failure', actionTimeout: 20_000, ...devices['Pixel 7'] },
  webServer: [
    {
      command: `POCKETQA_DATA_DIR=${dataDir} ${firebaseEnv} pnpm --filter @pocket-qa/api start`,
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx expo export --platform web --output-dir dist-web --clear && node e2e/serve-web.mjs',
      url: 'http://localhost:8090',
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
