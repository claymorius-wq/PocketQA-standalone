import { defineConfig } from 'vitest/config';

// Live provider checks only (see test-live/ and docs/deploy/cloud-backend.md).
export default defineConfig({
  test: { testTimeout: 120_000, pool: 'forks', include: ['test-live/**/*.live.test.ts'] },
});
