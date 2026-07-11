import { defineConfig, devices } from "@playwright/test";

/**
 * E2E scaffold — run against a live server:
 *   PLAYWRIGHT_BASE_URL=https://opencode-ui-production.up.railway.app npx playwright test
 * or local:
 *   npm run preview & PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 8000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
