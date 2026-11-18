import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright/test";
import { expect, gotoApp, placeArtworkOnWall, switchView, test } from "./fixtures";

// Checklist bulk tools: real checkboxes in the pane, shift ranges in visible
// order, a bulk bar that replaces the filter row, the shared checked set across
// the full-window editor, duplicate, and image-less works.

const IMAGES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/artworks/rijks-aic/images"
);
const FILES = [
  "aic-assumption-of-the-virgin.jpg",
  "aic-at-the-moulin-rouge.jpg",
  "aic-great-wave-off-kanagawa.jpg"
].map((name) => path.join(IMAGES, name));

const rows = (page: Page) => page.locator("li.checklist-row");
const rowCheckbox = (page: Page, index: number) =>
  rows(page).nth(index).locator(".checklist-check [role=checkbox]");

async function addThreeWorks(page: Page) {
  await page.locator('input[type="file"][aria-label="Add artwork images"]').setInputFiles(FILES);
  await expect(rows(page)).toHaveCount(3);
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("shift-range checks, bulk remove, and undo restores the works", async ({ page }) => {
  await addThreeWorks(page);

  await rowCheckbox(page, 0).click();
  await rowCheckbox(page, 2).click({ modifiers: ["Shift"] });
  await expect(page.locator("li.checklist-row[data-checked]")).toHaveCount(3);

  // The bulk bar takes the filter row's place while anything is checked.
  const bar = page.getByRole("toolbar", { name: "Selected works" });
  await expect(bar).toContainText("3 selected");
  await expect(page.getByRole("group", { name: "Filter checklist" })).toHaveCount(0);

  await bar.getByRole("button", { name: "Remove" }).click();
  await expect(bar).toContainText("Remove 3 works from the checklist?");
  await bar.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(rows(page)).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(rows(page)).toHaveCount(3);
  // Restored works come back unchecked: stored checks were pruned on removal.
  await expect(page.locator("li.checklist-row[data-checked]")).toHaveCount(0);
});

test("checked works survive Expand/Back and the inspector bulk-edits them", async ({ page }) => {
  await addThreeWorks(page);
  await rowCheckbox(page, 0).click();
  await rowCheckbox(page, 1).click();

  await page.getByRole("button", { name: "Open checklist editor" }).click();
  const editor = page.locator(".checklist-editor-view");
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("toolbar", { name: "Selected works" })).toContainText(
    "2 selected"
  );

  // Bulk edit lives in the inspector: checked works replace its content, and a
  // field commits to every checked work on blur.
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toContainText("2 checked works");
  await expect(inspector).toBeVisible();
  const artist = inspector.getByLabel("Artist");
  await artist.fill("Agnes Martin");
  await artist.press("Enter");
  await expect(editor.locator("tbody tr").nth(0)).toContainText("Agnes Martin");
  await expect(editor.locator("tbody tr").nth(1)).toContainText("Agnes Martin");
  await expect(editor.locator("tbody tr").nth(2)).not.toContainText("Agnes Martin");

  // Selection mode: while works are checked, a title click toggles its check.
  await editor.locator("tbody tr").nth(2).locator(".artwork-table-edit").click();
  await expect(editor.getByRole("toolbar", { name: "Selected works" })).toContainText(
    "3 selected"
  );
  await editor.locator("tbody tr").nth(2).locator(".artwork-table-edit").click();

  await editor.getByRole("button", { name: "Back" }).click();
  await expect(page.locator("li.checklist-row[data-checked]")).toHaveCount(2);
  // Escape clears only while focus is in the pane.
  await rowCheckbox(page, 0).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("li.checklist-row[data-checked]")).toHaveCount(0);
});

test("duplicate from the row menu inserts the copy after its source", async ({ page }) => {
  await addThreeWorks(page);
  const firstTitle = (await rows(page).nth(0).locator(".checklist-title").innerText()).trim();

  await rows(page).nth(0).getByRole("button", { name: /More actions for/ }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();

  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(1).locator(".checklist-title")).toHaveText(`${firstTitle} (copy)`);
});

test("Escape cancels a bulk draft and later edits and undo still work", async ({ page }) => {
  await addThreeWorks(page);
  await rowCheckbox(page, 0).click();
  await rowCheckbox(page, 1).click();
  await page.getByRole("button", { name: "Open checklist editor" }).click();
  const editor = page.locator(".checklist-editor-view");
  const artist = page.getByRole("complementary", { name: "Inspector" }).getByLabel("Artist", { exact: true });

  await artist.fill("Original artist");
  await artist.press("Enter");
  await expect(editor.locator("tbody tr").nth(0)).toContainText("Original artist");
  await expect(editor.locator("tbody tr").nth(1)).toContainText("Original artist");

  await artist.fill("Discard this");
  await artist.press("Escape");
  await expect(artist).toHaveValue("Original artist");
  await expect(editor.locator("tbody tr").nth(0)).toContainText("Original artist");
  await expect(editor.locator("tbody tr").nth(1)).toContainText("Original artist");

  await artist.fill("Keep this");
  await artist.press("Enter");
  await expect(editor.locator("tbody tr").nth(0)).toContainText("Keep this");
  await expect(editor.locator("tbody tr").nth(1)).toContainText("Keep this");
  await editor.getByRole("button", { name: "Back", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.locator("tbody tr").nth(0)).toContainText("Original artist");
  await expect(editor.locator("tbody tr").nth(1)).toContainText("Original artist");
});

test("checklist editor suspends canvas nudge and delete until Back", async ({ page }) => {
  await addThreeWorks(page);
  const elevation = await placeArtworkOnWall(page);
  const outline = elevation.locator("rect.artwork-outline");
  await outline.click();
  const beforeX = (await outline.getAttribute("x"))!;
  const beforeY = (await outline.getAttribute("y"))!;

  await page.getByRole("button", { name: "Open checklist editor" }).click();
  const editor = page.locator(".checklist-editor-view");
  await editor.locator("tbody [role=checkbox]").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await expect(editor.locator("tbody tr").first()).toContainText("Placed");

  await editor.getByRole("button", { name: "Back", exact: true }).click();
  await expect(outline).toHaveCount(1);
  await expect(outline).toHaveAttribute("x", beforeX);
  await expect(outline).toHaveAttribute("y", beforeY);
  // Returning to the canvas reinstalls its shortcuts and preserves its pick.
  await page.keyboard.press("ArrowRight");
  await expect(outline).not.toHaveAttribute("x", beforeX);
  await page.keyboard.press("Delete");
  await expect(outline).toHaveCount(0);
});

test("a work without an image places as a sized placeholder", async ({ page }) => {
  await page.locator(".checklist-add").click();
  await page.getByRole("menuitem", { name: /New work without image/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Loan TBC");
  await dialog.getByRole("textbox", { name: /Width/ }).fill('20"');
  await dialog.getByRole("textbox", { name: /Height/ }).fill('30"');
  // Clicked straight from a typed size field: the blur commit must not cost a
  // second press.
  await dialog.getByRole("button", { name: "Add work" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Add image/ })).toBeVisible();

  const elevation = await placeArtworkOnWall(page);
  await expect(elevation.locator("rect.artwork-outline")).toHaveCount(1);
  await expect(elevation.locator("image")).toHaveCount(0);
  await switchView(page, "Plan");
});
