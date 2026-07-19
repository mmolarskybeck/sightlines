import { defineConfig, devices } from "playwright/test";

// Two dev servers: the default one for every existing spec, and a second one
// launched with the cloud-backup env set (VITE_DROPBOX_CLIENT_ID + shortened
// scheduler timings) that ONLY the storage-safety spec talks to. Vite bakes
// import.meta.env at server start, so the feature can't be toggled per-request
// — a dedicated port with its own env is the least invasive way to give one
// spec the configured feature while leaving the other specs' environment
// (and their timing) untouched.
const PORT = 5199;
const STORAGE_PORT = 5198;

const STORAGE_ENV = {
  VITE_DROPBOX_CLIENT_ID: "e2e-test-client-id",
  VITE_CLOUD_BACKUP_SETTLE_MS: "500",
  VITE_CLOUD_BACKUP_MIN_INTERVAL_MS: "1000"
};

const STORAGE_SAFETY = /storage-safety\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: ".playwright-mcp/playwright-report", open: "never" }],
  ],
  outputDir: ".playwright-mcp/test-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      // Every existing spec: Chromium, default server, no cloud-backup env.
      name: "chromium",
      testIgnore: STORAGE_SAFETY,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } },
    },
    {
      // The storage-safety spec on Chromium, against the cloud-backup server.
      name: "chromium-storage",
      testMatch: STORAGE_SAFETY,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1600, height: 1000 },
        baseURL: `http://127.0.0.1:${STORAGE_PORT}`,
      },
    },
    {
      // The storage-safety spec on WebKit — the audience skews Mac/Safari and
      // this slice exists for Safari's storage behaviour, so it earns a second
      // engine. Scoped to this spec only so the suite time doesn't balloon.
      name: "webkit-storage",
      testMatch: STORAGE_SAFETY,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1600, height: 1000 },
        baseURL: `http://127.0.0.1:${STORAGE_PORT}`,
      },
    },
  ],
  webServer: [
    {
      command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${STORAGE_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${STORAGE_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: STORAGE_ENV,
    },
  ],
});
