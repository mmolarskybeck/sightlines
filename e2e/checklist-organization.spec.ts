import type { Artwork, Project } from "../src/domain/project";
import { CURRENT_ARTWORK_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION } from "../src/domain/project";
import {
  ARTWORK_STORE,
  DB_NAME,
  DB_VERSION,
  PROJECT_STORE
} from "../src/domain/repositories/database";
import { expect, gotoApp, hideFontLab, test } from "./fixtures";

const artworks: Artwork[] = [
  makeArtwork("boyun-landscape", "Landscape Study", "Boyun Jang", {
    subject: "urban landscape"
  }),
  makeArtwork("boyun-interior", "Interior Study", "Boyun Jang"),
  makeArtwork("alma-wind", "Wind Study", "Alma Thomas"),
  makeArtwork("unknown", "Untitled Study")
];

const project: Project = {
  id: "checklist-organization",
  schemaVersion: CURRENT_SCHEMA_VERSION,
  title: "Checklist organization",
  unit: "ft",
  defaultWallHeightMm: 3657.6,
  defaultCenterlineHeightMm: 1447.8,
  checklistArtworkIds: artworks.map((artwork) => artwork.id),
  wallObjects: [],
  floorObjects: [],
  referenceMeasurements: [],
  savedViews: [],
  createdAt: "2099-01-01T00:00:00.000Z",
  updatedAt: "2099-01-01T00:00:00.000Z",
  floor: { rooms: [] }
};

test("temporarily searches and collapses artist groups in the checklist", async ({ page }) => {
  await seedChecklist(page);

  const options = page.getByRole("button", { name: /Checklist options/ });
  await options.click();
  await page.getByRole("menuitemcheckbox", { name: "Group by artist" }).click();

  const alma = page.getByRole("button", { name: "Alma Thomas, 1 work" });
  const boyun = page.getByRole("button", { name: "Boyun Jang, 2 works" });
  await expect(alma).toHaveAttribute("aria-expanded", "true");
  await expect(boyun).toHaveAttribute("aria-expanded", "true");

  await boyun.click();
  await expect(boyun).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Landscape Study")).toHaveCount(0);
  await expect(page.getByText("Wind Study")).toBeVisible();

  await page.getByRole("button", { name: "Search checklist" }).click();
  const search = page.getByRole("searchbox", { name: "Search checklist" });
  await search.fill("landscape");
  await expect(page.getByText("1 of 4 works")).toBeVisible();
  await expect(page.getByRole("button", { name: "Boyun Jang, 1 work" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  await expect(page.getByText("Landscape Study")).toBeVisible();

  // The field's one trailing control clears first and only closes an already
  // empty field, so the restored disclosure state is observable while the
  // search row is still open.
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(boyun).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Close search" }).first().click();
  await expect(search).toHaveCount(0);

  await options.click();
  await page.getByRole("menuitem", { name: "Expand all artists" }).click();
  await expect(boyun).toHaveAttribute("aria-expanded", "true");

  await options.click();
  await page.getByRole("menuitem", { name: "Collapse all artists" }).click();
  await expect(alma).toHaveAttribute("aria-expanded", "false");
  await expect(boyun).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".checklist-panel")).toHaveJSProperty("scrollLeft", 0);
  expect(
    await page.locator(".checklist-panel").evaluate((panel) => panel.scrollWidth <= panel.clientWidth)
  ).toBe(true);
});

function makeArtwork(
  id: string,
  title: string,
  artist?: string,
  metadata: Artwork["metadata"] = {}
): Artwork {
  return {
    id,
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    title,
    artist,
    dimensions: { status: "unknown" },
    metadata
  };
}

async function seedChecklist(page: Parameters<typeof gotoApp>[0]) {
  await gotoApp(page);
  await page.evaluate(
    async ({ artworkRecords, projectRecord, database }) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const request = indexedDB.open(database.name, database.version);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(
          [database.projectStore, database.artworkStore],
          "readwrite"
        );
        transaction.objectStore(database.projectStore).put(projectRecord);
        for (const artwork of artworkRecords) {
          transaction.objectStore(database.artworkStore).put(artwork);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      db.close();
    },
    {
      artworkRecords: artworks,
      projectRecord: project,
      database: {
        name: DB_NAME,
        version: DB_VERSION,
        projectStore: PROJECT_STORE,
        artworkStore: ARTWORK_STORE
      }
    }
  );

  await page.reload();
  await expect(page.locator(".app-main")).toBeVisible();
  await hideFontLab(page);
  await expect(page.getByRole("textbox", { name: "Project title" }).first()).toHaveValue(
    project.title
  );
}
