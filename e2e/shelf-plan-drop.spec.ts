import { expect, test, addArtwork, gotoApp, placeArtworkOnWall, switchView } from "./fixtures";
import type { Locator } from "playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECOND_ARTWORK = path.join(
  REPO_ROOT,
  "fixtures/artworks/rijks-aic/images/aic-the-bedroom.jpg"
);

// A shelf is a SURFACE, and dropping a work onto it must work in every view —
// not only the one that happens to have a vertical axis.
//
// Before this, plan was the view where a shelf could not be aimed at: every
// wall drop went to the centerline, so a work released squarely on a slab's
// plan footprint hung a metre above it. That is exactly the claim a unit test
// cannot hold on its own, because it spans the plan drop resolver, the store
// commit and the elevation's rendered geometry: the assertion here is read in
// ELEVATION, off the same getBBox mm-space e2e/shelf-snap.spec.ts reads (the
// elevation's SVG user space IS wall-local millimetres), after a gesture made
// entirely in plan.

type MmBox = { x: number; y: number; width: number; height: number };

async function mmBoxOf(locator: Locator): Promise<MmBox> {
  return await locator.evaluate((element) => {
    const box = (element as SVGGraphicsElement).getBBox();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected the element to have a bounding box.");
  return box;
}

// A LengthField with a step control renders its two stepper buttons inside the
// label, so getByLabel resolves to three nodes. Address the input by role.
const lengthField = (inspector: Locator, label: string) =>
  inspector.getByRole("textbox", { name: new RegExp(`^${label}`) });

// Every work's bottom edge on the active wall, in wall-local mm (y measured
// DOWN from the top of the wall, the elevation viewBox's own frame).
async function workBottomsMm(elevation: Locator): Promise<number[]> {
  return await elevation.locator("rect.artwork-outline").evaluateAll((elements) =>
    elements.map((element) => {
      const box = (element as SVGGraphicsElement).getBBox();
      return box.y + box.height;
    })
  );
}

test("a checklist work dropped on a shelf's plan footprint stands on the slab", async ({
  page
}) => {
  await gotoApp(page);

  // --- One work hung on the wall, plus a shelf placed in elevation. ------
  await addArtwork(page);
  const elevation = await placeArtworkOnWall(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });

  const insert = page.getByRole("group", { name: "Insert" });
  await insert.getByRole("button", { name: "Shelf", exact: true }).click();

  const elevationBox = await boxOf(elevation);
  await page.mouse.click(
    elevationBox.x + elevationBox.width * 0.5,
    elevationBox.y + elevationBox.height * 0.6
  );

  const slab = elevation.locator(".elevation-shelf rect.shelf-slab");
  await expect(slab).toHaveCount(1);

  // Placing selects the new shelf, so its inspector is open. Widen the slab so
  // the plan drop lands well inside its span rather than on its end.
  await expect(lengthField(inspector, "Top height")).toBeVisible();
  await lengthField(inspector, "Width").fill("3 m");
  await lengthField(inspector, "Width").press("Enter");
  await expect.poll(async () => Math.round((await mmBoxOf(slab)).width)).toBe(3000);

  const slabTopY = (await mmBoxOf(slab)).y;
  const [hungWorkBottom] = await workBottomsMm(elevation);
  // The already-hung work is NOT on the shelf, so "a work's bottom edge is the
  // slab's top face" below can only be true of the one dropped from plan.
  expect(Math.abs(hungWorkBottom - slabTopY)).toBeGreaterThan(1);

  // --- The drop: a second checklist work, released on the slab in PLAN. --
  await addArtwork(page, SECOND_ARTWORK);

  // Give the incoming work REAL dimensions before the drag. Without them the
  // placement size is derived from the image aspect, which the drop ghost loads
  // asynchronously once the drag starts — a synthetic drag can release before
  // it arrives, and the assertion below would then be measuring that race
  // rather than the seating.
  await page
    .locator("li.checklist-row")
    .filter({ hasText: /bedroom/i })
    .first()
    .click();
  const workHeightField = lengthField(inspector, "Height");
  await expect(workHeightField).toBeVisible();
  await workHeightField.fill("0.5 m");
  await workHeightField.press("Enter");

  await switchView(page, "Plan");

  const plan = page.locator("svg:has(.plan-object-hit)").first();
  await expect(plan).toBeVisible();
  const planShelf = plan.locator(".plan-object:has(.plan-object-mark--shelf)");
  await expect(planShelf).toHaveCount(1);

  // A HAND-DRIVEN drag rather than locator.dragTo, so the gesture can be held
  // open and the MID-DRAG feedback asserted before the release.
  const planShelfBox = await boxOf(planShelf);
  const dropPoint = {
    x: planShelfBox.x + planShelfBox.width / 2,
    y: planShelfBox.y + planShelfBox.height / 2
  };
  await page
    .locator("li.checklist-row")
    .filter({ hasText: /bedroom/i })
    .first()
    .hover();
  await page.mouse.down();
  await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 16 });

  // Mid-drag, before the release: the slab says it caught the work. This is the
  // plan half of "a surface announces itself", and it exists only while the
  // pointer is down — the committed geometry below cannot show it.
  await expect(plan.locator(".plan-object.is-snap-target")).toHaveCount(1);
  await expect(planShelf).toHaveClass(/is-snap-target/);

  await page.mouse.up();

  // --- Read the result in elevation: it is standing on the slab. ---------
  await switchView(page, "Elevation");
  await expect(elevation.locator("rect.artwork-outline")).toHaveCount(2);

  await expect
    .poll(async () => {
      const bottoms = await workBottomsMm(elevation);
      return bottoms.filter((bottom) => Math.abs(bottom - slabTopY) < 1).length;
    })
    .toBe(1);

  // The shelf really is holding it: the other work is still where it was.
  const bottoms = await workBottomsMm(elevation);
  expect(bottoms.some((bottom) => Math.abs(bottom - hungWorkBottom) < 1)).toBe(true);
});
