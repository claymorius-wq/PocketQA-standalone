import { defineConfig, devices } from '@playwright/test';

// The devnet browser journey's harness (e2e-devnet/). harness.spec.ts self-tests the test wallet and
// the fake devnet RPC on a route-only page (no app, no emulators, no build):
//   pnpm --filter @pocket-qa/mobile exec playwright test -c playwright.devnet.config.ts --project=default harness
// The LOCAL hosted-devnet journey (be3's connectors seam) is added here once the fake chain speaks
// real transaction bytes (see docs/reviews/devnet/pqa-be1-journey-harness.md).
export default defineConfig({
  testDir: './e2e-devnet',
  timeout: Number(process.env.PQA_TEST_TIMEOUT_MS ?? 120_000),
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', actionTimeout: 20_000, ...devices['Pixel 7'] },
  // The HOSTED web devnet journey (hosted-journey.spec.ts) runs desktop first, then Pixel 7 emulation
  // ("mobile viewport, NOT a physical-device wallet deep-link (MWA) test"); the other specs use the default.
  projects: [
    { name: 'default', testIgnore: /hosted-journey/ },
    { name: 'desktop', testMatch: /hosted-journey/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'pixel7', testMatch: /hosted-journey/, use: { ...devices['Pixel 7'] }, dependencies: ['desktop'] },
  ],
  // The LOCAL journey's backend (its own ESM process; only under `firebase emulators:exec` with PQA_WEB_DIR).
  ...(process.env.FIRESTORE_EMULATOR_HOST && process.env.PQA_WEB_DIR
    ? { webServer: { command: 'npx tsx e2e-devnet/local-devnet-server.mts', url: `http://127.0.0.1:${process.env.PQA_DEVNET_API_PORT ?? 8693}/__harness/health`, reuseExistingServer: false, timeout: 90_000 } }
    : {}),
});
