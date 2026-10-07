import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// pqa-be2 harness only (not part of any app suite). Run under `firebase emulators:exec` from apps/api.
const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  test: {
    root: here,
    include: ['races.emulator.test.ts', 'e08.sqlite.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
