import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Keep expected error-path logging out of the test output.
    env: { LOG_LEVEL: 'silent' },
  },
});
