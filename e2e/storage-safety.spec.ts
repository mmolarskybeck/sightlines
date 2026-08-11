import { test, expect, gotoApp } from "./fixtures";
import type { Page } from "playwright/test";
import { strToU8, zipSync } from "fflate";

// End-to-end coverage for the storage-safety slice: Dropbox cloud backup
// (happy path + reauth), silent snapshot corruption recovery, and the
// scoped save-failure toast. All Dropbox network is page.route-mocked; the
// feature is real (this spec runs against a dev server started WITH
// VITE_DROPBOX_CLIENT_ID + shortened scheduler timings — see
// playwright.config.ts). Runs on Chromium and WebKit.

const DROPBOX_AUTH_KEY = "sightlines:dropboxAuth";
const CURRENT_SCHEMA_VERSION = 5;

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
        accountLabel,
        scope: "account_info.read files.content.write files.metadata.read sharing.write"
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
    if (url.includes("/2/sharing/create_shared_link_with_settings")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://www.dropbox.com/scl/fi/mock/shared-project.sightlines?rlkey=test&dl=0"
        })
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route("https://content.dropboxapi.com/**", async (route) => {
    const apiArg = route.request().headers()["dropbox-api-arg"];
    const path = apiArg ? JSON.parse(apiArg).path : "/backups/mock";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "backup.sightlines",
        id: "id:mock-upload",
        path_lower: String(path).toLowerCase(),
        path_display: path,
        server_modified: new Date().toISOString()
      })
    });
  });
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
  test("runs the shared-package relay during local development", async ({
    page,
    consoleGuard
  }) => {
    consoleGuard.allow(/Failed to load resource.*400/);
    await gotoApp(page);

    const status = await page.evaluate(async () => {
      const response = await fetch("/api/dropbox-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://evil.example/project.sightlines" })
      });
      return response.status;
    });

    // The production Worker handler rejects the host. A Vite fallthrough would
    // return its generic 404 instead, which caused local shared links to look
    // as though Dropbox had deleted them.
    expect(status).toBe(400);
  });

  test("separates automatic local save from optional Dropbox backup", async ({ page }) => {
    await gotoApp(page);
    await openStoragePopover(page);

    await expect(page.getByRole("heading", { name: "Save & backup" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "On this device" })).toBeVisible();
    await expect(
      page.getByText("Saved automatically in this browser.", { exact: false })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dropbox backup" })).toBeVisible();
    await expect(page.getByText("Automatic backup is off.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect|Turn on/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export backup file" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Storage settings" })).toBeVisible();
  });

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
    await expect(page.locator(".storage-popover-destinations")).toContainText(
      "Automatic backup on. Last backup"
    );

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
    await expect(page.locator(".storage-popover-destinations")).toContainText(
      "Reconnect Dropbox"
    );

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
    await expect(page.locator(".storage-popover-destinations")).toContainText(
      "Automatic backup on. Last backup"
    );
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

  test("creates a one-link Dropbox snapshot from the Export menu", async ({ page }) => {
    await installDropboxRoutes(page);
    await seedDropboxAuth(page);
    await gotoApp(page);

    const uploadRequest = page.waitForRequest((request) =>
      request.url().includes("content.dropboxapi.com/2/files/upload")
    );
    const linkRequest = page.waitForRequest((request) =>
      request.url().includes("api.dropboxapi.com/2/sharing/create_shared_link_with_settings")
    );
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("menuitem", { name: /Share project link/ }).click();
    await uploadRequest;
    await linkRequest;

    const dialog = page.getByRole("dialog", { name: "Share this project snapshot" });
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox?.width).toBeLessThanOrEqual(550);
    const bodyPadding = await dialog.locator(".share-project-body").evaluate((element) => {
      const styles = getComputedStyle(element);
      return { left: parseFloat(styles.paddingLeft), right: parseFloat(styles.paddingRight) };
    });
    expect(bodyPadding.left).toBeGreaterThanOrEqual(20);
    expect(bodyPadding.right).toBeGreaterThanOrEqual(20);
    const sharedUrl = await dialog.getByRole("textbox", { name: "Share link" }).inputValue();
    const parsed = new URL(sharedUrl);
    expect(parsed.pathname).toBe("/share");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toContain("provider=dropbox");
    expect(parsed.hash).toContain("www.dropbox.com");
    await expect(dialog).toContainText("Later changes will not sync");
  });

  test("opens a shared link as a fresh editable local copy", async ({ page }) => {
    const senderProject = validProject("sender-project-id", "Shared Exhibition");
    const bytes = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          mode: "metadata-only",
          project: senderProject,
          artworks: [],
          assets: []
        })
      )
    });
    await page.route("**/api/dropbox-share", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from(bytes)
      })
    );
    const dropboxUrl =
      "https://www.dropbox.com/scl/fi/mock/shared-project.sightlines?rlkey=test&dl=0";
    const fragment = new URLSearchParams({ provider: "dropbox", url: dropboxUrl });

    await page.goto(`/share#${fragment.toString()}`);
    await expect(page.locator(".app-main")).toBeVisible();
    const dialog = page.getByRole("dialog", { name: "A project was shared with you" });
    await expect(dialog).toContainText("The project is ready to save.");
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox?.width).toBeLessThanOrEqual(550);
    await expect(dialog.locator(".shared-project-status")).toHaveAttribute(
      "data-status",
      "ready"
    );
    await dialog.getByRole("button", { name: "Save a copy and open" }).click();

    await expect(page.getByRole("textbox", { name: "Project title" }).first()).toHaveValue(
      "Shared Exhibition (copy)"
    );
    const storedProjects = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("sightlines", 4);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return new Promise<Array<{ id: string; title: string }>>((resolve, reject) => {
        const request = db.transaction("projects", "readonly").objectStore("projects").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
    expect(storedProjects).toContainEqual(
      expect.objectContaining({ title: "Shared Exhibition (copy)" })
    );
    expect(storedProjects.some((project) => project.id === "sender-project-id")).toBe(false);
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

test.describe("shared-opening load repair durability", () => {
  const REPAIR_ID = "repair-project-e2e";
  const ROOM_SIZE = { widthMm: 4000, depthMm: 3000, heightMm: 2500 };

  // A rectangular room placement, spelled out for the same reason validProject
  // is: keeping app source (and its transitive deps) out of the spec's Node
  // context. Mirrors createRectangularRoomPlacement's output exactly.
  function rectangularRoom(roomId: string, name: string, offsetXMm: number) {
    const vertex = (corner: string, xMm: number, yMm: number) => ({
      id: `${roomId}-v-${corner}`,
      xMm,
      yMm
    });
    const wall = (side: string, from: string, to: string) => ({
      id: `${roomId}-wall-${side}`,
      roomId,
      name: `${side[0].toUpperCase()}${side.slice(1)} wall`,
      startVertexId: `${roomId}-v-${from}`,
      endVertexId: `${roomId}-v-${to}`,
      heightMm: ROOM_SIZE.heightMm
    });
    return {
      roomId,
      offsetXMm,
      offsetYMm: 0,
      rotationDeg: 0,
      room: {
        id: roomId,
        name,
        heightMm: ROOM_SIZE.heightMm,
        freestandingWalls: [],
        vertices: [
          vertex("nw", 0, 0),
          vertex("ne", ROOM_SIZE.widthMm, 0),
          vertex("se", ROOM_SIZE.widthMm, ROOM_SIZE.depthMm),
          vertex("sw", 0, ROOM_SIZE.depthMm)
        ],
        walls: [
          wall("north", "nw", "ne"),
          wall("east", "ne", "se"),
          wall("south", "se", "sw"),
          wall("west", "sw", "nw")
        ]
      }
    };
  }

  function door(id: string, wallId: string, xMm: number) {
    return {
      id,
      kind: "door",
      wallId,
      xMm,
      yMm: 1015,
      widthMm: 915,
      heightMm: 2030,
      blocksPlacement: true
    };
  }

  // Two rooms abutting at x = 4000, each carrying one unpaired door on the
  // shared boundary: the legacy one-sided-per-room shape the load repair adopts
  // into a single shared opening. door-b sits at the exact mirror of door-a
  // (3000 − 1200), so the pass links the two rather than moving either.
  function repairableProject() {
    return {
      ...validProject(REPAIR_ID, "Shared Opening Show"),
      // Newest updatedAt, so boot opens this instead of the sample project.
      updatedAt: "2099-01-01T00:00:00.000Z",
      wallObjects: [door("door-a", "room-a-wall-east", 1200), door("door-b", "room-b-wall-west", 1800)],
      floor: {
        rooms: [rectangularRoom("room-a", "Room A", 0), rectangularRoom("room-b", "Room B", 4000)]
      }
    };
  }

  // Read the doors back out of IndexedDB — what a reload would actually get,
  // as opposed to what the running app is holding in memory.
  function readStoredDoors(page: Page, projectId: string) {
    return page.evaluate(async (id) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const request = indexedDB.open("sightlines", 4);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const record: { wallObjects?: { id: string; connectsToObjectId?: string }[] } =
        await new Promise((resolve, reject) => {
          const request = db.transaction("projects", "readonly").objectStore("projects").get(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      db.close();
      return (record?.wallObjects ?? []).map((object) => ({
        id: object.id,
        partner: object.connectsToObjectId ?? null
      }));
    }, projectId);
  }

  // Every recovery snapshot held for this project, oldest first, reduced to the
  // door links so an assertion can say which document each copy holds.
  function readSnapshotDoors(page: Page, projectId: string) {
    return page.evaluate(async (id) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const request = indexedDB.open("sightlines", 4);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      type SnapshotRecord = {
        projectId: string;
        project: { wallObjects: { id: string; connectsToObjectId?: string }[] };
      };
      const records: SnapshotRecord[] = await new Promise((resolve, reject) => {
        const request = db
          .transaction("projectSnapshots", "readonly")
          .objectStore("projectSnapshots")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return records
        .filter((record) => record.projectId === id)
        .map((record) =>
          record.project.wallObjects.map((object) => ({
            id: object.id,
            partner: object.connectsToObjectId ?? null
          }))
        );
    }, projectId);
  }

  // Boot once so the DB and its schema exist, write the unrepaired document in
  // as the newest project, then reload so boot opens it.
  async function seedRepairableProject(page: Page) {
    await gotoApp(page);
    await page.evaluate(async (project) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const request = indexedDB.open("sightlines", 4);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("projects", "readwrite");
        tx.objectStore("projects").put(project);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    }, repairableProject());
    await page.reload();
    await expect(page.locator(".app-main")).toBeVisible();
  }

  test("writes the repair to storage and survives a reload, original recoverable", async ({
    page
  }) => {
    await seedRepairableProject(page);

    // The app says what it did, and settles on a save state it can honour.
    await expect(
      page.getByText("One shared opening was linked while opening this project.")
    ).toBeVisible();
    await expect(page.locator("button.status-badge")).toHaveText(/Saved/);

    // The claim under test: the REPAIRED document is what storage now holds.
    await expect
      .poll(() => readStoredDoors(page, REPAIR_ID))
      .toEqual([
        { id: "door-a", partner: "door-b" },
        { id: "door-b", partner: "door-a" }
      ]);

    // ...and the pre-repair original was not simply thrown away: a recovery
    // copy of it exists, so overwriting the user's document is reversible.
    const snapshots = await readSnapshotDoors(page, REPAIR_ID);
    expect(snapshots).toContainEqual([
      { id: "door-a", partner: null },
      { id: "door-b", partner: null }
    ]);

    // A reload gets the repaired document back — and does not have to repair it
    // a second time, which is exactly what "durable" means here.
    await page.reload();
    await expect(page.locator(".app-main")).toBeVisible();
    await expect(page.locator("button.status-badge")).toHaveText(/Saved/);
    await expect(
      page.getByText("One shared opening was linked while opening this project.")
    ).toHaveCount(0);
    expect(await readStoredDoors(page, REPAIR_ID)).toEqual([
      { id: "door-a", partner: "door-b" },
      { id: "door-b", partner: "door-a" }
    ]);
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
