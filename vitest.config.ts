import { defineConfig } from 'vitest/config';

// One embedded PostgreSQL 18 cluster for the whole run (test/support/global-setup.ts); each test file creates
// its own database from it. Set DATABASE_URL_ADMIN to use an existing server instead (CI service container).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    pool: 'forks',
  },
});
