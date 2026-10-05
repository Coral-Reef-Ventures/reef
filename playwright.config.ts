import process from "node:process";

import { defineConfig, devices } from "@playwright/test";

/**
 * The door gate in three browsers: `pnpm run e2e` (once: `pnpm exec playwright install chromium firefox webkit`).
 * Global setup builds site-tools, runs the real reef-door-bundle bin twice into a temporary directory, starts each
 * bundle's server.mjs there with no node_modules anywhere above it, and puts TLS in front of each, as Amplify's CDN
 * does, beside a stand-in door that signs tickets with a test key. What is pinned in the browsers rather than in the
 * unit tests is what only a browser decides: that the state cookie travels on the door's cross-site POST, that the
 * session cookie is kept from that POST's response, and that every navigation without one gets the coming-soon page,
 * painted under its own CSP, whose button ends at the door.
 */
export default defineConfig({
  testDir: "./packages/site-tools/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./packages/site-tools/e2e/global-setup.ts",
  use: {
    // The gates and the door serve a certificate made for the run.
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
