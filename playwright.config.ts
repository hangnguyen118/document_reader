import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: true, workers: 2, retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI), reporter: "list",
  use: { baseURL: "http://localhost:3101", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "node node_modules/next/dist/bin/next start --port 3101", url: "http://localhost:3101", reuseExistingServer: !process.env.CI, timeout: 120_000 }
});
