import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Local-only: the API on 127.0.0.1:8787 with a throwaway data dir, and the Expo web
// preview on :8090. Existing servers are reused when already running.
const dataDir = process.env.POCKETQA_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'pqa-e2e-'));
// Shared with specs (e.g. to create an admin through the real CLI against the same DB).
process.env.POCKETQA_E2E_DATA_DIR = dataDir;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:8090', trace: 'retain-on-failure', actionTimeout: 20_000, ...devices['Pixel 7'] },
  projects: [
    // Every flow on a mobile-sized web view (the recorder there says it needs a computer).
    { name: 'mobile-web', testIgnore: /web-recorder\.spec\.ts/ },
    // The desktop web recorder in real Chromium, with SYNTHETIC media: the fake-UI flag accepts the
    // share chooser and the fake devices supply a test-pattern screen and a tone for the microphone.
    // No real screen, window or microphone is captured (docs/plans/web-screen-audio-recording.md).
    {
      name: 'desktop-recorder',
      testMatch: /web-recorder\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture'] },
      },
    },
  ],
  webServer: [
    {
      // Loopback devnet JSON-RPC test double (see e2e/fake-devnet-rpc.mjs).
      command: 'node e2e/fake-devnet-rpc.mjs',
      url: 'http://127.0.0.1:8899/__health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Wallet login on, bound to this test origin (ADR 0005 §2).
      command: `POCKETQA_DATA_DIR=${dataDir} POCKETQA_SOLANA_RPC_URL=http://127.0.0.1:8899 POCKETQA_WALLET_LOGIN=1 POCKETQA_SETTLEMENT=simulated POCKETQA_PUBLIC_ORIGIN=http://localhost:8090 pnpm --filter @pocket-qa/api start`,
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // A fresh static export each run, so tests never see a stale dev bundle.
      command: 'npx expo export --platform web --output-dir dist-web --clear && node e2e/serve-web.mjs',
      url: 'http://localhost:8090',
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
