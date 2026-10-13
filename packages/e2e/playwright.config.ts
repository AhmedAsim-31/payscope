import { defineConfig, devices } from '@playwright/test';

try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url));
} catch {
  // .env.local absent: specs skip themselves when DEMO_USER_PASSWORD is missing
}

const WEB_URL = 'http://localhost:3000';
const API_URL = `http://localhost:${process.env.API_PORT ?? '3001'}`;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @payscope/api exec tsx --env-file=../../.env.local src/server.ts',
      url: `${API_URL}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @payscope/web dev',
      url: `${WEB_URL}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, hasTouch: true },
      dependencies: ['setup'],
    },
  ],
});
