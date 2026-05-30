import { defineConfig } from 'vitest/config';

/* Backend test runner — vitest because it speaks ESM + TS natively
 * (no babel dance for "type": "module"). Scope is restricted to
 * source/ so any future test in a sibling tree won't be picked up
 * by accident. */
export default defineConfig({
  test: {
    include: ['source/**/*.test.ts'],
    globals: true,
    environment: 'node',
  },
});
