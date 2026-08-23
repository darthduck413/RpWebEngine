import { defineConfig } from 'vitest/config';

// Standalone from vite.config.ts on purpose: the app config carries the react
// plugin and a dev-only API proxy middleware that tests have no use for.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
