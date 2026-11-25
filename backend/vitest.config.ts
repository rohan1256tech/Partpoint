import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    // Integration tests share one Postgres database.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
