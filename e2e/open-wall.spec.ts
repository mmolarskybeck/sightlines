import type { Page } from "playwright/test";
import { expect, gotoApp, switchView, test } from "./fixtures";

// Removing a wall's surface, in the real browser. The unit suite covers the
// cascade; what only a browser can prove is the INTERACTION contract — that a
// destructive key fires for a wall you clicked and stays inert for the one the
// inspector merely defaults to.

const planSvg = (page: Page) => page.locator("svg.plan-svg").first();
const wallLines = (page: Page) => page.locator("svg.plan-svg line.wall-line");
const openWalls = (page: Page) => page.locator("svg.plan-svg line.wall-line.open");
const activeWalls = (page: Page) => page.locator("svg.plan-svg line.wall-line.active");

// The hit strokes paint after every room-hit polygon, so the whole 14px band
// belongs to the wall — clicking its centre is enough. (Before that split the
// polygon ate the inner half, and a shared wall had no clickable pixels at all.)
async function clickWall(page: Page, index = 0) {
  const hit = page.locator("svg.plan-svg line.wall-hit").nth(index);
  const box = await hit.boundingBox();
  if (!box) throw new Error("wall hit stroke has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe("open walls", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await switchView(page, "Plan");
    await expect(wallLines(page)).toHaveCount(4);
  });

  // THE safety test. getSelectedWall falls back to walls[0], so the wall
  // inspector always displays a wall — even on a fresh project nobody has
  // clicked. Nothing destructive may key off that.
  test("Delete does nothing when no wall has been picked", async ({ page }) => {
    await planSvg(page).click({ position: { x: 40, y: 40 } });

    // The canvas must not imply a selection that does not exist.
    await expect(activeWalls(page)).toHaveCount(0);

    await page.keyboard.press("Delete");

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(openWalls(page)).toHaveCount(0);
  });

  test("Escape disarms the key while the inspector keeps showing the wall", async ({
    page
  }) => {
    await clickWall(page);
    await expect(activeWalls(page)).toHaveCount(1);

    await page.keyboard.press("Escape");

    await expect(activeWalls(page)).toHaveCount(0);
    // Still displayed — only the pick was dropped.
    await expect(page.locator(".inspector")).toContainText("Wall");

    await page.keyboard.press("Delete");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a picked wall confirms, opens, and undoes", async ({ page }) => {
    await clickWall(page);
    await page.keyboard.press("Delete");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("This will delete the wall and open");
    await expect(dialog).toContainText("Undo will revert this");

    await dialog.getByRole("button", { name: "Open wall" }).click();

    await expect(openWalls(page)).toHaveCount(1);
    // The wall record stays in the loop — only its surface went away.
    await expect(wallLines(page)).toHaveCount(4);
    // At rest an open wall draws nothing: the gap is the signal.
    await expect(openWalls(page).first()).toHaveCSS("stroke", "none");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(openWalls(page)).toHaveCount(0);
  });

  test("cancelling the confirm changes nothing", async ({ page }) => {
    await clickWall(page);
    await page.keyboard.press("Delete");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(openWalls(page)).toHaveCount(0);
  });

  test("the rooms panel marks it Open and the inspector offers Restore", async ({
    page
  }) => {
    await clickWall(page);
    await page.keyboard.press("Delete");
    await page.getByRole("dialog").getByRole("button", { name: "Open wall" }).click();
    await expect(openWalls(page)).toHaveCount(1);

    // The plan draws nothing at rest, so the list is where the state is
    // unambiguous.
    await page.getByRole("button", { name: "Show rooms & walls" }).click();
    const openRow = page.locator('.wall-row[data-open="true"]');
    await expect(openRow).toHaveCount(1);
    await expect(openRow).toContainText("Open");

    // Wall context is preserved through the open, so Restore is already here.
    const restore = page.getByRole("button", { name: "Restore wall" });
    await expect(restore).toBeVisible();
    // Nothing can hang on an open wall, so the whole add category is gone.
    // Scoped to the inspector — the Insert toolbar has its own Door button.
    const inspector = page.locator(".inspector");
    await expect(inspector.getByRole("button", { name: "Door" })).toHaveCount(0);
    await expect(inspector.getByRole("button", { name: "Wall case" })).toHaveCount(0);
    await expect(inspector).not.toContainText("Centerline");

    await restore.click();
    await expect(openWalls(page)).toHaveCount(0);
  });

  test("navigating the wall list does not arm Delete", async ({ page }) => {
    await page.getByRole("button", { name: "Show rooms & walls" }).click();
    await page.locator(".wall-row").first().click();

    // Context moved (the inspector follows), but no wall is picked.
    await expect(page.locator(".inspector")).toContainText("Wall");
    await expect(activeWalls(page)).toHaveCount(0);

    await page.keyboard.press("Delete");

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(openWalls(page)).toHaveCount(0);
  });

  test("an open wall is excluded from PDF elevations but still listed", async ({
    page
  }) => {
    await clickWall(page);
    await page.keyboard.press("Delete");
    await page.getByRole("dialog").getByRole("button", { name: "Open wall" }).click();
    await expect(openWalls(page)).toHaveCount(1);

    // Name-based lookup also matches a 36px icon button, so target the
    // dropdown trigger specifically.
    await page
      .locator('button[aria-haspopup="menu"]')
      .filter({ hasText: "Export" })
      .first()
      .click();
    await page.getByRole("menuitem").filter({ hasText: /Export PDF/i }).first().click();

    const row = page.locator('.export-tree-wall[data-open="true"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Open");
    // Listed but never selectable — a wall the user knows exists must not
    // silently vanish from the tree.
    await expect(row.locator('button[role="checkbox"]')).toBeDisabled();
  });
});
