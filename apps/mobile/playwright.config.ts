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
  webServer: [
    {
      // Loopback devnet JSON-RPC test double (see e2e/fake-devnet-rpc.mjs).
      command: 'node e2e/fake-devnet-rpc.mjs',
      url: 'http://127.0.0.1:8899/__health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `POCKETQA_DATA_DIR=${dataDir} POCKETQA_SOLANA_RPC_URL=http://127.0.0.1:8899 pnpm --filter @pocket-qa/api start`,
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
