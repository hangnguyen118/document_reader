import { defineConfig, devices } from "@playwright/test";
import baseConfig from "./playwright.config";

// Opt in with FOLIO_REAL_TRANSLATION=1; PLAYWRIGHT_BROWSERS_PATH can select
// the browser installation without coupling this config to browser revisions.
export default defineConfig({
  ...baseConfig,
  testMatch: "**/translation.spec.ts",
  grep: /real downloaded model/,
  projects: [
    { name: "firefox", use: { ...devices["Desktop Firefox"], browserName: "firefox" } },
    { name: "webkit", use: { ...devices["Desktop Safari"], browserName: "webkit" } }
  ]
});
