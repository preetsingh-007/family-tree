import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build, served under a sub-path
 * exactly like a GitHub Pages project site (https://<user>.github.io/<repo>/).
 */
const PORT = 4174;
export const BASE_PATH = '/family-tree/';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort --base ${BASE_PATH}`,
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: false,
  },
});
