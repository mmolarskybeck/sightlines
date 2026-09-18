import { expect, gotoApp, switchView, test } from "./fixtures";

// Wall names are editable text now, and every label consumer reads the stored
// name live. What only a browser can prove is that the rename actually reaches
// all of them at once — the rooms panel, the elevation chip and the inspector
// heading — and that relabelling the compass is a single, reversible step that
// asks first when it would destroy something typed.

const ROOMS_BUTTON = "Show rooms & walls";

test.describe("wall names", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: ROOMS_BUTTON }).click();
  });

  test("a rename in the rooms panel reaches every label at once", async ({ page }) => {
    await page.getByRole("button", { name: "Rename North wall" }).click();
    const field = page.getByRole("textbox", { name: "Rename North wall" });
    await field.fill("Entrance wall");
    await page.getByRole("button", { name: "Save wall name" }).click();

    const row = page.locator(".wall-row").first();
    await expect(row).toContainText("Entrance wall");

    // The inspector heading names the wall it is inspecting.
    await row.click();
    await expect(page.locator(".inspector-subject h2")).toHaveText("Entrance wall");
    // And the inspector's own Name field is seeded from it.
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true })
    ).toHaveValue("Entrance wall");

    // The elevation chip is the third consumer — the switcher trigger, since
    // the sample project has walls to switch between.
    await switchView(page, "Elevation");
    await expect(page.locator(".surface-label-select-wall")).toHaveText("Entrance wall");
  });

  test("the inspector's Name field commits on Enter", async ({ page }) => {
    await page.locator(".wall-row").first().click();
    const field = page.getByRole("textbox", { name: "Name", exact: true });
    await field.fill("Window wall");
    await field.press("Enter");

    await expect(page.locator(".wall-row").first()).toContainText("Window wall");
    await expect(page.locator(".inspector-subject h2")).toHaveText("Window wall");
  });

  test("Use as North wall relabels all four, with no confirm for default names", async ({
    page
  }) => {
    await page.getByRole("button", { name: "Use East wall as North wall" }).click();

    // Nothing was typed, so nothing is at stake and nothing asks.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const rows = page.locator(".wall-row");
    await expect(rows.nth(0)).toContainText("West wall");
    await expect(rows.nth(1)).toContainText("North wall");
    await expect(rows.nth(2)).toContainText("East wall");
    await expect(rows.nth(3)).toContainText("South wall");
  });

  test("a custom name raises the confirm, and undo restores it in one step", async ({
    page
  }) => {
    await page.getByRole("button", { name: "Rename North wall" }).click();
    await page.getByRole("textbox", { name: "Rename North wall" }).fill("Entrance wall");
    await page.getByRole("button", { name: "Save wall name" }).click();
    await expect(page.locator(".wall-row").first()).toContainText("Entrance wall");

    await page.getByRole("button", { name: "Use East wall as North wall" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("rename all four walls");
    await expect(dialog).toContainText("“Entrance wall” will be replaced.");
    await expect(dialog).toContainText("Undo will revert this.");

    // Cancelling changes nothing.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".wall-row").first()).toContainText("Entrance wall");

    await page.getByRole("button", { name: "Use East wall as North wall" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Relabel walls" }).click();

    const rows = page.locator(".wall-row");
    await expect(rows.nth(0)).toContainText("West wall");
    await expect(rows.nth(1)).toContainText("North wall");

    // One undo step brings back every name, the custom one included.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(rows.nth(0)).toContainText("Entrance wall");
    await expect(rows.nth(1)).toContainText("East wall");
    await expect(rows.nth(2)).toContainText("South wall");
    await expect(rows.nth(3)).toContainText("West wall");
  });
});
