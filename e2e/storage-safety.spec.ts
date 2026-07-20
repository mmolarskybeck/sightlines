import { test, expect, gotoApp } from "./fixtures";
import type { Page } from "playwright/test";

// End-to-end coverage for the storage-safety slice: Dropbox cloud backup
// (happy path + reauth), silent snapshot corruption recovery, and the
// scoped save-failure toast. All Dropbox network is page.route-mocked; the
// feature is real (this spec runs against a dev server started WITH
// VITE_DROPBOX_CLIENT_ID + shortened scheduler timings — see
// playwright.config.ts). Runs on Chromium and WebKit.

const DROPBOX_AUTH_KEY = "sightlines:dropboxAuth";
const CURRENT_SCHEMA_VERSION = 4;

// A schema-valid project literal for the recovery snapshot (mirrors
// createBlankProject so parseProject/migrateProject accept it as-is). Inlined
// rather than imported so the spec's Node context never drags app source /
// transitive deps through Playwright's loader.
function validProject(id: string, title: string) {
  const now = new Date().toISOString();
  return {
    id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title,
    unit: "ft",
    defaultWallHeightMm: 3657.6,
    defaultCenterlineHeightMm: 1447.8,
    checklistArtworkIds: [],
    wallObjects: [],
    floorObjects: [],
    referenceMeasurements: [],
    savedViews: [],
    createdAt: now,
    updatedAt: now,
    floor: { rooms: [] }
  };
}

// Seed a Dropbox auth record before app boot. `expired` puts expiresAt in the
// past so the next upload forces a token refresh (the reauth path); otherwise
// the access token is valid for an hour and no refresh is attempted.
async function seedDropboxAuth(
  page: Page,
  { expired = false, accountLabel = "Test Curator" }: { expired?: boolean; accountLabel?: string } = {}
) {
  const expiresAt = expired ? Date.now() - 60_000 : Date.now() + 3_600_000;
  await page.addInitScript(
    ({ key, record }) => {
      window.localStorage.setItem(key, JSON.stringify(record));
    },
    {
      key: DROPBOX_AUTH_KEY,
      record: {
        refreshToken: "seed-refresh-token",
        accessToken: "seed-access-token",
        expiresAt,
        accountLabel
      }
    }
  );
}

// Mock every Dropbox endpoint the provider can touch. `tokenStatus`/`tokenBody`
// drive the refresh response so a single helper serves both the happy path
// (200, never actually called) and the reauth path (400 invalid_grant).
async function installDropboxRoutes(
  page: Page,
  { tokenStatus = 200, tokenBody }: { tokenStatus?: number; tokenBody?: unknown } = {}
) {
  await page.route("https://api.dropboxapi.com/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/oauth2/token")) {
      return route.fulfill({
        status: tokenStatus,
        contentType: "application/json",
        body: JSON.stringify(
          tokenBody ?? { access_token: "refreshed-access-token", token_type: "bearer", expires_in: 14_400 }
        )
      });
    }
    if (url.includes("/2/files/list_folder")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: [], has_more: false, cursor: "" })
      });
    }
    if (url.includes("/2/files/delete_v2")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (url.includes("/2/users/get_current_account")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ name: { display_name: "Test Curator" } })
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route("https://content.dropboxapi.com/**", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "backup.sightlines",
        id: "id:mock-upload",
        path_lower: "/backups/mock",
        server_modified: new Date().toISOString()
      })
    })
  );
}

// The scheduler's periodic gate is a 15s interval, but its visibilitychange →
// hidden path flushes a pending backup immediately, bypassing the settle/
// interval gates. Simulate the tab going hidden to force a deterministic,
// fast backup attempt through the real scheduler code.
async function flushCloudBackupOnHide(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden"
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

// Rename the project through the top-bar title field — a real, persisted edit
// that changes the backup fingerprint.
async function renameProject(page: Page, title: string) {
  const input = page.getByRole("textbox", { name: "Project title" }).first();
  await input.fill(title);
  await input.press("Enter");
}

function openStoragePopover(page: Page) {
  return page.locator("button.status-badge").click();
}

test.describe("cloud backup", () => {
  test("backs up to Dropbox after an edit and shows the connected state", async ({ page }) => {
    await installDropboxRoutes(page);
    await seedDropboxAuth(page);
    await gotoApp(page);

    // A real edit, settled to "Saved", so the fingerprint is dirty and stable.
    await renameProject(page, "Backup Happy Path");
    await expect(page.locator("button.status-badge")).toHaveText(/Saved/);

    // Force the scheduler's hidden-tab flush and wait for the mocked upload.
    const uploadRequest = page.waitForRequest((request) =>
      request.url().includes("content.dropboxapi.com/2/files/upload")
    );
    await flushCloudBackupOnHide(page);
    await uploadRequest;

    // The save-status popover reports the backup.
    await openStoragePopover(page);
    await expect(page.locator(".storage-popover-cloud")).toContainText("Backed up to Dropbox");

    // Settings shows the connected account.
    await page.getByRole("button", { name: "Storage settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await expect(settings).toContainText("Connected as Test Curator");
    await expect(settings.getByRole("button", { name: "Disconnect" })).toBeVisible();
  });

  test("surfaces the reconnect affordance when the refresh token is rejected", async ({
    page,
    consoleGuard
  }) => {
    // A failed token refresh is expected here; the reauth path reports it via a
    // toast, not the console, so nothing needs allow-listing — but be explicit
    // that a 400 from the mocked token endpoint is by design.
    consoleGuard.allow(/Failed to load resource.*40[01]/);

    await installDropboxRoutes(page, {
      tokenStatus: 400,
      tokenBody: { error: "invalid_grant", error_description: "refresh token revoked" }
    });
    await seedDropboxAuth(page, { expired: true });
    await gotoApp(page);

    // The expired access token forces a refresh on the next upload attempt.
    const tokenRequest = page.waitForRequest((request) =>
      request.url().includes("api.dropboxapi.com/oauth2/token")
    );
    await flushCloudBackupOnHide(page);
    await tokenRequest;

    // Popover flips to the reconnect line.
    await openStoragePopover(page);
    await expect(page.locator(".storage-popover-cloud")).toContainText("Reconnect Dropbox");

    // Settings offers the reconnect button.
    await page.getByRole("button", { name: "Storage settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("button", { name: "Reconnect Dropbox" })).toBeVisible();

    // The app is still alive and usable.
    await expect(page.locator("svg.plan-svg")).toBeVisible();
  });

  test("backs up on demand from the save-status popover", async ({ page }) => {
    await installDropboxRoutes(page);
    await seedDropboxAuth(page);
    await gotoApp(page);

    // A real edit leaves the project dirty (nothing backed up yet).
    await renameProject(page, "Manual Backup");
    await expect(page.locator("button.status-badge")).toHaveText(/Saved/);

    // "Back up now" in the popover triggers a real (mocked) upload.
    await openStoragePopover(page);
    const uploadRequest = page.waitForRequest((request) =>
      request.url().includes("content.dropboxapi.com/2/files/upload")
    );
    await page.getByRole("button", { name: "Back up now" }).click();
    await uploadRequest;

    // The row settles into the backed-up state without reopening the popover.
    await expect(page.locator(".storage-popover-cloud")).toContainText("Backed up to Dropbox");
  });

  test("offers a top-level Dropbox backup in the Export menu", async ({ page }) => {
    await installDropboxRoutes(page);
    await seedDropboxAuth(page);
    await gotoApp(page);

    // Back up once so the menu item can describe a last-backup time.
    await renameProject(page, "Export Menu Cloud");
    const uploadRequest = page.waitForRequest((request) =>
      request.url().includes("content.dropboxapi.com/2/files/upload")
    );
    await flushCloudBackupOnHide(page);
    await uploadRequest;

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const item = page.getByRole("menuitem", { name: /Back up to Dropbox/ });
    await expect(item).toBeVisible();
    await expect(item).toContainText("Last backed up");
  });
});

test.describe("corruption recovery", () => {
  // Boot the app once (creates + saves the sample project and the DB schema),
  // then write a corrupt project record whose load fails Zod parse, plus a
  // schema-valid snapshot for the same project id, and reload so the corrupt
  // record is the newest project boot tries to open.
  async function seedCorruption(page: Page) {
    await gotoApp(page);
    await page.evaluate(async (schemaVersion) => {
      const corruptId = "corrupt-project-e2e";
      const now = new Date().toISOString();
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const request = indexedDB.open("sightlines", 4);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      // A record that lists (has an id) but fails migrate/parse: no
      // schemaVersion, no floor — the typed corruption signal.
      const corrupt = {
        id: corruptId,
        title: "Corrupt Show",
        // Newest updatedAt so it sorts to the top of the project list.
        updatedAt: "2099-01-01T00:00:00.000Z"
      };
      const snapshotProject = {
        id: corruptId,
        schemaVersion,
        title: "Recovered Copy",
        unit: "ft",
        defaultWallHeightMm: 3657.6,
        defaultCenterlineHeightMm: 1447.8,
        checklistArtworkIds: [],
        wallObjects: [],
        floorObjects: [],
        referenceMeasurements: [],
        savedViews: [],
        createdAt: now,
        updatedAt: now,
        floor: { rooms: [] }
      };
      const snapshot = {
        projectId: corruptId,
        createdAt: now,
        projectTitle: "Recovered Copy",
        fingerprint: "e2e-fingerprint",
        project: snapshotProject
      };
      const snapshotKey = `${corruptId}:${now}:e2e-snapshot`;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["projects", "projectSnapshots"], "readwrite");
        tx.objectStore("projects").put(corrupt);
        tx.objectStore("projectSnapshots").put(snapshot, snapshotKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    }, CURRENT_SCHEMA_VERSION);
    await page.reload();
    await expect(page.locator(".app-main")).toBeVisible();
  }

  test("offers and restores a previous copy when the project can't be opened", async ({
    page
  }) => {
    await seedCorruption(page);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/couldn.t be opened/);
    await expect(dialog).toContainText("Restore a previous copy");

    await dialog.getByRole("button", { name: "Restore previous copy" }).click();

    // The recovered project opens, persists, and is usable. (It has an empty
    // floor, so the plan surface is its empty state, not svg.plan-svg.)
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Project title" }).first()).toHaveValue(
      "Recovered Copy"
    );
    await expect(page.locator(".app-main")).toBeVisible();
    await expect(page.locator("button.status-badge")).toHaveText(/Saved/);
  });

  test("leaves no dialog when the recovery offer is dismissed", async ({ page }) => {
    await seedCorruption(page);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/couldn.t be opened/);

    await dialog.getByRole("button", { name: "Not now" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The app remains usable on its in-memory fallback document.
    await expect(page.locator("svg.plan-svg")).toBeVisible();
  });
});

test.describe("save failure", () => {
  test("shows a scoped retry toast and recovers when the write succeeds", async ({
    page,
    consoleGuard
  }) => {
    // The forced IndexedDB write failure can surface as a console/page error in
    // some engines; the product path handles it (toast + retry), so allow it.
    consoleGuard.allow(/Simulated project save failure/i);

    await gotoApp(page);

    // Make the "projects" object store's put() throw while a flag is set — a
    // realistic mid-session persistence failure that the store must surface.
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype;
      const original = proto.put;
      proto.put = function put(this: IDBObjectStore, ...args: unknown[]) {
        if ((window as unknown as { __failProjectPut?: boolean }).__failProjectPut && this.name === "projects") {
          throw new DOMException("Simulated project save failure", "UnknownError");
        }
        // @ts-expect-error forwarding original signature
        return original.apply(this, args);
      };
    });

    await page.evaluate(() => {
      (window as unknown as { __failProjectPut?: boolean }).__failProjectPut = true;
    });
    await renameProject(page, "Save Failure Path");

    // The scoped failure toast appears with a Retry action.
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await expect(page.locator("button.status-badge")).toHaveText(/Save issue/);

    // Un-break the write and retry — the save recovers.
    await page.evaluate(() => {
      (window as unknown as { __failProjectPut?: boolean }).__failProjectPut = false;
    });
    await retry.click();

    await expect(page.locator("button.status-badge")).toHaveText(/Saved/);
  });
});
