/**
 * End-to-end tests: the real web app against the real API, on a throwaway
 * database seeded with the demo data (see TEST_ACCOUNTS.md).
 *
 *   npx playwright install chromium   # once
 *   npm run e2e
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Fresh VAPID keys per run, so the push settings can be exercised without a secret in the repo.
const webpush = createRequire(path.resolve('server/package.json'))('web-push') as {
  generateVAPIDKeys(): { publicKey: string; privateKey: string };
};
const vapid = process.env.E2E_VAPID_PUBLIC_KEY
  ? { publicKey: process.env.E2E_VAPID_PUBLIC_KEY, privateKey: process.env.E2E_VAPID_PRIVATE_KEY! }
  : webpush.generateVAPIDKeys();
// Workers re-load this file; keep the same keys for all of them.
process.env.E2E_VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.E2E_VAPID_PRIVATE_KEY = vapid.privateKey;

const WEB = 'http://localhost:3100';
const API = 'http://localhost:4100';

export default defineConfig({
  testDir: './e2e',
  // The tests share one seeded database, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev:memory',
      cwd: 'server',
      url: `${API}/api/health`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: '4100',
        DEV_MEMORY_FRESH: '1',
        CLIENT_URL: WEB,
        REALTIME: 'polling',
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
      },
    },
    {
      command: 'npx next dev -p 3100',
      cwd: 'client',
      url: WEB,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_API_URL: API, NEXT_PUBLIC_SITE_URL: WEB },
    },
  ],
});

export { API };
