import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a running web + worker + local dependencies (Docker Compose).
 * Start them first: `pnpm dev` (or build + `pnpm start:web` and `pnpm worker`), then `pnpm test:e2e`.
 * Tests use the demo catalog and capture sign-in links from the local Mailpit mailbox.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
