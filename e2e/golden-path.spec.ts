import { expect, test, addArtwork, gotoApp, switchView } from "./fixtures";

test("moves through the core artwork placement workflow", async ({ page }) => {
  await gotoApp(page);

  await expect(page.getByRole("radio", { name: "Plan", exact: true })).toBeChecked();

  // Unplaced rows carry no tag; placement is signalled by the wall tag appearing.
  const artwork = await addArtwork(page);
  const placedTag = artwork.locator(".checklist-tag.placed");
  await expect(placedTag).toHaveCount(0);

  await switchView(page, "Elevation");
  const elevation = page.locator("svg:has(rect.wall-fill)").first();
  await expect(elevation).toBeVisible();
  await artwork.dragTo(elevation, { targetPosition: { x: 450, y: 400 } });

  await expect(placedTag).toHaveCount(1);
  await expect(elevation.locator("rect.artwork-outline")).toHaveCount(1);

  await artwork.click();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toContainText(
    /Position on .* wall/
  );

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(placedTag).toHaveCount(0);

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(placedTag).toHaveCount(1);

  await switchView(page, "3D");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
});
