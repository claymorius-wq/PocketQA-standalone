import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      // Plan Phase 2: state machines must have 100% branch coverage.
      thresholds: {
        'src/study.ts': { branches: 100, lines: 100 },
        'src/participation.ts': { branches: 100, lines: 100 },
        'src/segment.ts': { branches: 100, lines: 100 },
        'src/transfer.ts': { branches: 100, lines: 100 },
        'src/utf8.ts': { lines: 100 },
      },
    },
  },
});
