import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { NODE_ENV: 'test', MONGODB_DB_NAME: 'nexity_test', PRESENCE_OFFLINE_GRACE_MS: '300' },
  },
});
