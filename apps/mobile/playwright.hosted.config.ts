import { defineConfig, devices } from '@playwright/test';
import { introSeen } from './e2e/introSeen';

// Local rehearsal of the HOSTED web build (no cloud): the built .vercel/output served exactly as
// its config.json routes it (scripts/vercel/serve-local.mjs), the API function on the Firestore and
// Auth emulators, and FakeS3. Build first, then run under the emulators (be2's ports):
//   POCKETQA_R2_ACCOUNT_ID=0123456789abcdef0123456789abcdef POCKETQA_R2_BUCKET=pqa-test node scripts/vercel/build.mjs --env staging
//   cd apps/api && firebase emulators:exec --only firestore,auth --project demo-pocketqa --config ../../firebase.emu-be2.json \
//     'pnpm --filter @pocket-qa/mobile exec playwright test -c playwright.hosted.config.ts'
const PORT = Number(process.env.PQA_HOSTED_PORT ?? 8495);
const WEB = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e-hosted',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: WEB, trace: 'retain-on-failure', actionTimeout: 20_000, ...devices['Pixel 7'], storageState: introSeen(WEB) },
  webServer: {
    command: 'node e2e-hosted/start-hosted.mjs',
    url: `${WEB}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
