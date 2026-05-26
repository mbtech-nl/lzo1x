import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.ts', 'src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        // The encoder contains format-dictated branches our greedy single-pass matcher
        // never reaches (M1 2-byte matches, M1-long-distance, M4 length ladder). We keep
        // the code for spec completeness rather than delete and re-derive on a future
        // matcher upgrade. Thresholds are calibrated to actual reachability + 1-2%.
        lines: 85,
        functions: 95,
        branches: 75,
        statements: 85,
      },
    },
  },
});
