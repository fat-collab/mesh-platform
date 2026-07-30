import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // WebKit is CI-only: Playwright's WebKit builds require macOS 14+ and
    // crash on macOS 13 Ventura (missing system-framework symbols), which is
    // the local dev baseline here. CI runs on a supported platform, so full
    // cross-browser coverage still runs there; local runs just skip it.
    ...(process.env.CI ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }] : []),
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
