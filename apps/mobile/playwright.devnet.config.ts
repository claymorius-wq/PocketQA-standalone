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
});
