import { defineConfig } from 'vitest/config';

// Live provider suites (test-live/) never run in the normal suite or CI: they create real
// cloud objects/users. Run them only through `pnpm test:live` with explicit credentials.
export default defineConfig({
  test: { testTimeout: 20_000, pool: 'forks', exclude: ['**/node_modules/**', 'test-live/**', 'test/emulator/**'] },
});
