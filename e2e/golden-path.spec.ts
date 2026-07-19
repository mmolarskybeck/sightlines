import { expect, test, addArtwork, gotoApp, switchView } from "./fixtures";

test("moves through the core artwork placement workflow", async ({ page }) => {
  await gotoApp(page);

  await expect(page.getByRole("radio", { name: "Plan", exact: true })).toBeChecked();

  const artwork = await addArtwork(page);
  await expect(artwork).toContainText("Unplaced");

  await switchView(page, "Elevation");
  const elevation = page.locator("svg:has(rect.wall-fill)").first();
  await expect(elevation).toBeVisible();
  await artwork.dragTo(elevation, { targetPosition: { x: 450, y: 400 } });

  await expect(artwork).not.toContainText("Unplaced");
  await expect(elevation.locator("rect.artwork-outline")).toHaveCount(1);

  await artwork.click();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toContainText(
    /Position on .* wall/
  );

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(artwork).toContainText("Unplaced");

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(artwork).not.toContainText("Unplaced");

  await switchView(page, "3D");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
});
