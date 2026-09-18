import { expect, test, addArtwork, gotoApp, placeArtworkOnWall, switchView } from "./fixtures";
import type { Locator, Page } from "playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECOND_ARTWORK = path.join(
  REPO_ROOT,
  "fixtures/artworks/rijks-aic/images/aic-the-bedroom.jpg"
);

// Shelves: the shelf-top snap, and the works standing on a shelf travelling
// with it.
//
// Both claims are cross-cutting in exactly the way a unit test cannot hold.
// "A work standing on a shelf travels with it" is not one rule — it is the SAME
// answer produced by separate move paths (elevation drag, inspector edit, plan
// drag), each of which re-derives the riders from geometry rather than reading
// a stored group. A suite that proves each path in isolation still ships the
// version where the elevation carries its riders and the plan leaves them
// behind on the wall.
//
// So this spec walks one shelf and two works through the surfaces in order:
// snap onto the shelf in elevation against a competing centerline, a second
// work onto the same slab, drag the shelf in elevation, edit its Top height in
// the inspector, then drag the whole assembly in plan.
//
// There is no test hook onto the store, so every claim is read off the RENDERED
// geometry. The elevation's SVG user space IS wall-local millimetres (see
// ElevationView.toWallLocalMm), so getBBox gives exact model numbers there —
// Playwright's own boundingBox inflates every rect by its stroke and shadow,
// which is enough to blur a 40 mm distinction. Screen coordinates are used only
// to aim the pointer, and in plan only as deltas, where the inflation cancels.

// Wall-local mm, y measured DOWN from the top of the wall (SVG convention),
// which is the frame the elevation's viewBox is in.
type MmBox = { x: number; y: number; width: number; height: number };

async function mmBoxOf(locator: Locator): Promise<MmBox> {
  return await locator.evaluate((element) => {
    const box = (element as SVGGraphicsElement).getBBox();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

const mmBottom = (box: MmBox) => box.y + box.height;
const mmCenterY = (box: MmBox) => box.y + box.height / 2;

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected the element to have a bounding box.");
  return box;
}

const centerOf = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

// A LengthField with a step control renders its two stepper buttons inside the
// label, so getByLabel resolves to three nodes. Address the input by role,
// anchored at the field's own name.
const lengthField = (inspector: Locator, label: string) =>
  inspector.getByRole("textbox", { name: new RegExp(`^${label}`) });

// Press-move-release with enough intermediate steps that the drag clears its
// dead zone and the snap resolver sees a real pointer path.
async function dragFromTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
}

// How far below the centerline the shelf's top face is parked: close enough
// that the centerline is inside the snap's capture radius the whole time
// (~106 mm at this zoom), far enough that "it landed on the shelf" and "it
// landed on the centerline" are different answers.
const SHELF_BELOW_CENTERLINE_MM = 40;

test("a work seats on the shelf top over a competing centerline, and the assembly moves as one", async ({
  page
}) => {
  await gotoApp(page);

  // --- One work on the wall, to measure the wall and the work with. ------
  await addArtwork(page);
  const elevation = await placeArtworkOnWall(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });

  const works = elevation.locator("rect.artwork-outline");
  const wall = await mmBoxOf(elevation.locator("rect.wall-fill").first());
  const centerlineY = (await mmBoxOf(elevation.locator(".centerline").first())).y;

  // --- Give the work a FRAME, before anything is measured off it. --------
  // The framed OUTER footprint is the foot, everywhere: the elevation snap,
  // the drop ghost, the placement barriers AND getShelfRiders all seat and
  // measure the outer bottom edge, so a framed work has to snap onto a slab
  // and then ride it exactly like a bare one. (The bug this guards: the rider
  // test used to read the STORED image bottom, so a framed work was snapped
  // onto the shelf visually and then left behind by every move of it.)
  //
  // rect.artwork-outline IS the outer box — ElevationArtwork wraps it around
  // image + mat + frame — so every geometry assertion below already reads the
  // FRAMED edge once this commits.
  const bareWorkHeightMm = (await mmBoxOf(works.first())).height;
  await inspector.getByRole("button", { name: /^Framing/ }).click();
  const frameWidth = lengthField(inspector, "Frame");
  await expect(frameWidth).toBeVisible();
  await frameWidth.fill("1 in");
  await frameWidth.press("Enter");
  // 1 in of frame face on every side: the outline grows by 2 in (50.8 mm).
  await expect
    .poll(async () => Math.round((await mmBoxOf(works.first())).height - bareWorkHeightMm))
    .toBe(51);

  const workHeightMm = (await mmBoxOf(works.first())).height;

  // --- A shelf, placed from the Insert tool on the elevation canvas. -----
  const insert = page.getByRole("group", { name: "Insert" });
  await insert.getByRole("button", { name: "Shelf", exact: true }).click();

  const elevationBox = await boxOf(elevation);
  await page.mouse.click(
    elevationBox.x + elevationBox.width * 0.5,
    elevationBox.y + elevationBox.height * 0.6
  );

  const slab = elevation.locator(".elevation-shelf rect.shelf-slab");
  await expect(slab).toHaveCount(1);

  // Placing selects the new shelf, so its inspector is already open. Widen the
  // slab so two works fit side by side, then park its TOP face a known 40 mm
  // below the height a work would sit at if the centerline won.
  const topHeight = lengthField(inspector, "Top height");
  await expect(topHeight).toBeVisible();
  await lengthField(inspector, "Width").fill("3 m");
  await lengthField(inspector, "Width").press("Enter");

  const targetSlabTopY = centerlineY + workHeightMm / 2 + SHELF_BELOW_CENTERLINE_MM;
  // The field authors wall-local height measured UP from the floor.
  await topHeight.fill(`${((wall.height - targetSlabTopY) / 1000).toFixed(4)} m`);
  await topHeight.press("Enter");
  await expect
    .poll(async () => Math.round((await mmBoxOf(slab)).y))
    .toBe(Math.round(targetSlabTopY));

  // --- Drag the work onto the shelf, aiming its CENTRE at the centerline. -
  // The worst case on purpose: the centerline target is at distance ZERO and
  // the shelf top is 40 mm away, so the only thing that can seat the work on
  // the slab is the shelf-top tier outranking the centerline (USER DECISION).
  const slabBox = await boxOf(slab);
  const centerlineScreenY = centerOf(await boxOf(elevation.locator(".centerline").first())).y;
  const dragStart = centerOf(await boxOf(works.first()));
  const dragEnd = {
    x: slabBox.x + slabBox.width * 0.25,
    y: centerlineScreenY
  };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 16 });

  // --- Mid-drag: the shelf says it caught the work. ----------------------
  // Held before mouse.up on purpose — this feedback exists only while the
  // pointer is down, and it is the whole difference between "on the shelf"
  // and "on the eyeline", which the committed geometry below cannot show.
  const slabMm = await mmBoxOf(slab);
  await expect(elevation.locator(".elevation-shelf.snap-target")).toHaveCount(1);
  await expect(elevation.locator("text.snap-guide-label")).toHaveText("On shelf");

  // The guide runs along the slab's TOP FACE and stops at the slab's ends,
  // rather than through the work's centre across the whole wall (which is
  // exactly what the losing centerline snap would have drawn).
  const horizontalGuides = await elevation.locator("line.snap-guide").evaluateAll((lines) =>
    lines
      .map((element) => {
        const line = element as SVGLineElement;
        return {
          x1: line.x1.baseVal.value,
          x2: line.x2.baseVal.value,
          y1: line.y1.baseVal.value,
          y2: line.y2.baseVal.value
        };
      })
      .filter((line) => Math.abs(line.y1 - line.y2) < 0.01)
  );
  expect(horizontalGuides).toHaveLength(1);
  expect(horizontalGuides[0].x1).toBeCloseTo(slabMm.x, 0);
  expect(horizontalGuides[0].x2).toBeCloseTo(slabMm.x + slabMm.width, 0);
  expect(horizontalGuides[0].y1).toBeCloseTo(slabMm.y, 0);

  await page.mouse.up();

  // The highlight and the label are drag-only state; nothing lingers.
  await expect(elevation.locator(".elevation-shelf.snap-target")).toHaveCount(0);
  await expect(elevation.locator("text.snap-guide-label")).toHaveCount(0);

  // The committed placement's BOTTOM edge is the slab's top face, to the
  // millimetre...
  const slabTopY = (await mmBoxOf(slab)).y;
  await expect
    .poll(async () => Math.round(mmBottom(await mmBoxOf(works.first()))))
    .toBe(Math.round(slabTopY));
  // ...so its centre is 40 mm off the centerline, which was in capture range
  // and simply lost on rank.
  expect(mmCenterY(await mmBoxOf(works.first())) - centerlineY).toBeCloseTo(
    SHELF_BELOW_CENTERLINE_MM,
    0
  );

  // --- A second work onto the same shelf. --------------------------------
  await addArtwork(page, SECOND_ARTWORK);
  await page
    .locator("li.checklist-row")
    .filter({ hasText: /bedroom/i })
    .first()
    .dragTo(elevation, {
      targetPosition: {
        x: slabBox.x + slabBox.width * 0.75 - elevationBox.x,
        y: slabBox.y - 60 - elevationBox.y
      }
    });
  await expect(works).toHaveCount(2);

  // Both works are on the slab now, so they always move together; identifying
  // them by wall-local x keeps the assertions independent of scene order.
  const workIndicesLeftToRight = async (): Promise<[number, number]> => {
    const boxes = await Promise.all([mmBoxOf(works.nth(0)), mmBoxOf(works.nth(1))]);
    return boxes[0].x <= boxes[1].x ? [0, 1] : [1, 0];
  };
  const sortedWorkBoxes = async (): Promise<[MmBox, MmBox]> => {
    const [left, right] = await workIndicesLeftToRight();
    return [await mmBoxOf(works.nth(left)), await mmBoxOf(works.nth(right))];
  };

  // Wall-local mm → screen y, fitted through two points whose CENTRES are
  // exactly known (a box's centre is immune to the symmetric stroke/shadow
  // inflation that makes its edges unusable): the centerline and the slab.
  const slabCenterScreenY = centerOf(await boxOf(slab)).y;
  const mmPerScreenY = (slabTopY + 20 - centerlineY) / (slabCenterScreenY - centerlineScreenY);
  const toScreenY = (mmY: number) => centerlineScreenY + (mmY - centerlineY) / mmPerScreenY;

  const [, rightIndex] = await workIndicesLeftToRight();
  const rightWork = works.nth(rightIndex);
  const rightHeightMm = (await mmBoxOf(rightWork)).height;
  const rightScreen = centerOf(await boxOf(rightWork));
  await dragFromTo(page, rightScreen, {
    x: rightScreen.x,
    // 30 mm shy of seated: inside the capture radius, and visibly not resting
    // on anything if the shelf-top target is never offered.
    y: toScreenY(slabTopY - rightHeightMm / 2 - 30)
  });
  await expect
    .poll(async () => Math.round(mmBottom((await sortedWorkBoxes())[1])))
    .toBe(Math.round(slabTopY));

  // --- Drag the SHELF in elevation: both works ride along. ---------------
  const beforeSlab = await mmBoxOf(slab);
  const [leftBeforeDrag, rightBeforeDrag] = await sortedWorkBoxes();

  // Grab the slab near its left end, clear of both works.
  const slabScreen = await boxOf(slab);
  const shelfGrab = {
    x: slabScreen.x + slabScreen.width * 0.06,
    y: slabScreen.y + slabScreen.height / 2
  };
  await dragFromTo(page, shelfGrab, { x: shelfGrab.x - 90, y: shelfGrab.y });

  await expect.poll(async () => (await mmBoxOf(slab)).x - beforeSlab.x).toBeLessThan(-300);
  const slabDeltaX = (await mmBoxOf(slab)).x - beforeSlab.x;
  const [leftAfterDrag, rightAfterDrag] = await sortedWorkBoxes();
  expect(leftAfterDrag.x - leftBeforeDrag.x).toBeCloseTo(slabDeltaX, 0);
  expect(rightAfterDrag.x - rightBeforeDrag.x).toBeCloseTo(slabDeltaX, 0);
  // Still seated after the ride.
  expect(mmBottom(leftAfterDrag)).toBeCloseTo((await mmBoxOf(slab)).y, 0);

  // --- Edit Top height in the inspector: both works follow vertically. ----
  const reselect = await boxOf(slab);
  await page.mouse.click(reselect.x + reselect.width * 0.06, reselect.y + reselect.height / 2);
  await expect(topHeight).toBeVisible();

  const slabBeforeLift = await mmBoxOf(slab);
  const [leftBeforeLift, rightBeforeLift] = await sortedWorkBoxes();

  await topHeight.fill(`${((wall.height - slabBeforeLift.y) / 1000 + 0.4).toFixed(4)} m`);
  await topHeight.press("Enter");

  // 400 mm up the wall is 400 mm DOWN in this y-flipped frame.
  await expect
    .poll(async () => Math.round((await mmBoxOf(slab)).y - slabBeforeLift.y))
    .toBe(-400);
  const [leftAfterLift, rightAfterLift] = await sortedWorkBoxes();
  expect(leftAfterLift.y - leftBeforeLift.y).toBeCloseTo(-400, 0);
  expect(rightAfterLift.y - rightBeforeLift.y).toBeCloseTo(-400, 0);
  expect(mmBottom(leftAfterLift)).toBeCloseTo((await mmBoxOf(slab)).y, 0);

  // --- Drag the SHELF onto the eyeline: it aligns by its own TOP FACE. ----
  // The assembly is three objects tall by now, so the union box's centre sits
  // well above the slab. Snapping the union would park that centre on the
  // eyeline and leave the slab somewhere below it; what the curator is aiming
  // is the surface the works stand on. Park the top face 60 mm under the
  // eyeline — inside the capture radius, and far enough that a union-box snap
  // could not be mistaken for this one — then push it up.
  const HOVER_BELOW_CENTERLINE_MM = 60;
  await topHeight.fill(
    `${((wall.height - (centerlineY + HOVER_BELOW_CENTERLINE_MM)) / 1000).toFixed(4)} m`
  );
  await topHeight.press("Enter");
  await expect
    .poll(async () => Math.round((await mmBoxOf(slab)).y - centerlineY))
    .toBe(HOVER_BELOW_CENTERLINE_MM);

  const slabScreenBeforeSnap = await boxOf(slab);
  const snapGrab = {
    x: slabScreenBeforeSnap.x + slabScreenBeforeSnap.width * 0.06,
    y: slabScreenBeforeSnap.y + slabScreenBeforeSnap.height / 2
  };
  await page.mouse.move(snapGrab.x, snapGrab.y);
  await page.mouse.down();
  await page.mouse.move(
    snapGrab.x,
    snapGrab.y - HOVER_BELOW_CENTERLINE_MM / mmPerScreenY,
    { steps: 16 }
  );

  // Mid-drag: one horizontal guide, on the eyeline — drawn where the top face
  // lands, not through the middle of the slab or of the union box.
  const snapGuides = await elevation.locator("line.snap-guide").evaluateAll((lines) =>
    lines
      .map((element) => {
        const line = element as SVGLineElement;
        return { y1: line.y1.baseVal.value, y2: line.y2.baseVal.value };
      })
      .filter((line) => Math.abs(line.y1 - line.y2) < 0.01)
  );
  expect(snapGuides).toHaveLength(1);
  expect(snapGuides[0].y1).toBeCloseTo(centerlineY, 0);

  await page.mouse.up();

  // Committed: the slab's top face is ON the eyeline, and both works are still
  // standing on it (the riders rode the snapped move, not the raw pointer).
  await expect.poll(async () => Math.round((await mmBoxOf(slab)).y)).toBe(Math.round(centerlineY));
  const [leftOnEyeline, rightOnEyeline] = await sortedWorkBoxes();
  expect(mmBottom(leftOnEyeline)).toBeCloseTo(centerlineY, 0);
  expect(mmBottom(rightOnEyeline)).toBeCloseTo(centerlineY, 0);

  // --- Plan: dragging the shelf carries the same two riders. -------------
  // Plan is a different move path entirely (usePlanObjectMove plus the rigid
  // planGroupMove entry), so it gets its own gesture rather than a re-render
  // check. Deltas are read in screen pixels here: the plan's user space is
  // floor mm but every object carries its own rotation, and a delta is immune
  // to the stroke inflation that made screen numbers unusable above.
  await switchView(page, "Plan");
  const plan = page.locator("svg:has(.plan-object-hit)").first();
  await expect(plan).toBeVisible();

  const planShelf = plan.locator(".plan-object:has(.plan-object-mark--shelf)");
  const planWorks = plan.locator(".plan-object:has(.plan-object-mark--artwork)");
  await expect(planShelf).toHaveCount(1);
  await expect(planWorks).toHaveCount(2);

  const planShelfBefore = await boxOf(planShelf);
  const planWorksBefore = [await boxOf(planWorks.nth(0)), await boxOf(planWorks.nth(1))].sort(
    (a, b) => a.x - b.x
  );

  const planGrab = {
    x: planShelfBefore.x + planShelfBefore.width * 0.08,
    y: planShelfBefore.y + planShelfBefore.height / 2
  };
  await dragFromTo(page, planGrab, { x: planGrab.x + 110, y: planGrab.y });

  await expect
    .poll(async () => (await boxOf(planShelf)).x - planShelfBefore.x)
    .toBeGreaterThan(40);
  const planShelfAfter = await boxOf(planShelf);
  const planDelta = planShelfAfter.x - planShelfBefore.x;
  const planWorksAfter = [await boxOf(planWorks.nth(0)), await boxOf(planWorks.nth(1))].sort(
    (a, b) => a.x - b.x
  );
  expect(planWorksAfter[0].x - planWorksBefore[0].x).toBeCloseTo(planDelta, 0);
  expect(planWorksAfter[1].x - planWorksBefore[1].x).toBeCloseTo(planDelta, 0);
  // Rigid: the assembly kept its shape, it did not stretch or pile up.
  expect(planShelfAfter.width).toBeCloseTo(planShelfBefore.width, 0);
});
