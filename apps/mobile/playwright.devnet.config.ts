import { defineConfig, devices } from '@playwright/test';

// The devnet browser journey's harness (e2e-devnet/). harness.spec.ts self-tests the test wallet and
// the fake devnet RPC on a route-only page (no app, no emulators, no build):
//   pnpm --filter @pocket-qa/mobile exec playwright test -c playwright.devnet.config.ts harness
// The LOCAL hosted-devnet journey (be3's connectors seam) is added here once the fake chain speaks
// real transaction bytes (see docs/reviews/devnet/pqa-be1-journey-harness.md).
export default defineConfig({
  testDir: './e2e-devnet',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', actionTimeout: 20_000, ...devices['Pixel 7'] },
  // The LOCAL journey's backend (its own ESM process; only under `firebase emulators:exec` with PQA_WEB_DIR).
  ...(process.env.FIRESTORE_EMULATOR_HOST && process.env.PQA_WEB_DIR
    ? { webServer: { command: 'npx tsx e2e-devnet/local-devnet-server.mts', url: `http://127.0.0.1:${process.env.PQA_DEVNET_API_PORT ?? 8693}/__harness/health`, reuseExistingServer: false, timeout: 90_000 } }
    : {}),
});
