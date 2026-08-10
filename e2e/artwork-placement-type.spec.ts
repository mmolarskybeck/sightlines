import {
  expect,
  test,
  addArtwork,
  gotoApp,
  placeArtworkOnWall,
  switchView
} from "./fixtures";

// The inspector's Wall|Floor "Type" control used to write a library flag and
// nothing else, so clicking it left the panel reading "Position on North wall"
// under "Type: Floor" and moved no object. It now converts the placement, which
// is only observable end to end: the store action, the value App derives from
// the object's actual surface, and the section retitling that is the feedback
// all have to line up. A unit test can hold any two of those together while the
// third is wrong.
test("the inspector's Type control moves the work between wall and floor", async ({ page }) => {
  await gotoApp(page);
  await addArtwork(page);
  await placeArtworkOnWall(page);

  await page.locator("li.checklist-row").first().click();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toContainText(/Position on .* wall/);

  const placementType = inspector.getByRole("radiogroup", { name: "Placement type" });
  await placementType.getByRole("radio", { name: "Floor", exact: true }).click();

  // The retitled section IS the confirmation — and the floor-only fields that
  // arrive with it prove an actual floor object now exists, not just a relabel.
  await expect(inspector).toContainText("Position on floor");
  await expect(inspector.getByLabel("Height off floor")).toBeVisible();
  await expect(inspector).not.toContainText(/Position on .* wall/);

  // One undo, not two: the conversion deliberately skips the placementForm
  // write that would have pushed a second entry.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(inspector).toContainText(/Position on .* wall/);

  // And back the other way from the same control — the round trip is the point.
  await placementType.getByRole("radio", { name: "Floor", exact: true }).click();
  await expect(inspector).toContainText("Position on floor");
  await placementType.getByRole("radio", { name: "Wall", exact: true }).click();
  await expect(inspector).toContainText(/Position on .* wall/);
});

// The direct-manipulation twin of the control above, and the other half of the
// USER DECISION that reversed the wall-only drag rule (see floatPolicyForKind).
// A hung work dragged into open floor used to paint the red reject ghost and
// commit nothing — and a floor work whose library flag still said "wall" could
// not be dragged anywhere at all. Both directions have to work from the mouse,
// which is exactly what no unit test can assert.
test("a plan drag converts an artwork in both directions", async ({ page }) => {
  await gotoApp(page);
  await addArtwork(page);
  await placeArtworkOnWall(page);

  await switchView(page, "Plan");
  const plan = page.locator("svg:has(.plan-object-hit)").first();
  await expect(plan).toBeVisible();
  const inspector = page.getByRole("complementary", { name: "Inspector" });

  // Where it hangs now — reused below as the drag-back target, so the return
  // trip lands inside the wall's capture radius without guessing at padding.
  const onWall = (await plan.locator(".plan-object-hit").first().boundingBox())!;
  const planBox = (await plan.boundingBox())!;
  const center = { x: planBox.x + planBox.width / 2, y: planBox.y + planBox.height / 2 };

  async function dragObjectTo(target: { x: number; y: number }) {
    const from = (await plan.locator(".plan-object-hit").first().boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.mouse.up();
    // The drag suppresses the trailing select, so re-select from the checklist.
    await page.locator("li.checklist-row").first().click();
  }

  await dragObjectTo(center);
  await expect(inspector).toContainText("Position on floor");

  await dragObjectTo({ x: onWall.x + onWall.width / 2, y: onWall.y + onWall.height / 2 });
  await expect(inspector).toContainText(/Position on .* wall/);
});
