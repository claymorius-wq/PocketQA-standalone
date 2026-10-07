import { defineConfig } from 'vitest/config';

// Firestore/Auth emulator tests (docs/plans/firebase-vercel-refactor.md §10). Run through
// `pnpm test:emulator`, which starts the emulators for project demo-pocketqa. Files run one at a
// time: each clears the emulator's data first.
export default defineConfig({
  test: {
    include: ['test/emulator/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
