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
        // The encoder's M1 (2-byte match) branch and the post-match defensive validation
        // fallback are unreachable from the current matcher and marked /* v8 ignore */
        // with explanatory comments. Remaining branch gap is mostly OR short-circuits in
        // the validity-filter expressions. Thresholds give a small buffer above current
        // numbers so genuine regressions trip CI.
        lines: 98,
        functions: 100,
        branches: 85,
        statements: 98,
      },
    },
  },
});
