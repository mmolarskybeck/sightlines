// Guards the SVG live preview that exports consume (`buildPlanScene`/
// `buildElevationScene`). Regenerate with
// `npx playwright test e2e/pdf-preview-visual.spec.ts --update-snapshots`
// only after a deliberate rendering change.
import { test, expect, gotoApp, addArtwork, placeArtworkOnWall } from "./fixtures";
import type { Page } from "playwright/test";

async function openExportPdfDialog(page: Page) {
  await gotoApp(page);
  await addArtwork(page);
  await placeArtworkOnWall(page);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: /Export PDF/ }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("svg.export-preview-svg")).toBeVisible();

  // Room plan pages are opt-in per room; check every "Include … room plan"
  // checkbox so the room-plan test has a page to navigate to.
  const roomPlanCheckboxes = page.getByRole("checkbox", { name: /room plan$/ });
  const roomPlanCount = await roomPlanCheckboxes.count();
  for (let i = 0; i < roomPlanCount; i += 1) {
    const checkbox = roomPlanCheckboxes.nth(i);
    if ((await checkbox.getAttribute("aria-checked")) !== "true") {
      await checkbox.click();
    }
  }
}

async function navigateToPage(page: Page, captionPattern: RegExp) {
  const caption = page.locator(".export-preview-caption");
  const nextButton = page.getByRole("button", { name: "Next page" });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const text = await caption.innerText();
    if (captionPattern.test(text)) return text;
    await nextButton.click();
  }

  const text = await caption.innerText();
  expect(text).toMatch(captionPattern);
  return text;
}

test("PDF preview: room plan page", async ({ page }) => {
  await openExportPdfDialog(page);

  await navigateToPage(page, /plan/i);

  // The preview redraws on a debounce after each page navigation; give it a
  // moment to settle before capturing.
  await page.waitForTimeout(300);

  await expect(page.locator(".export-preview-card")).toHaveScreenshot("room-plan.png", {
    mask: [page.locator(".export-preview-card svg text")]
  });
});

test("PDF preview: elevation page", async ({ page }) => {
  await openExportPdfDialog(page);

  await navigateToPage(page, /elevation/i);

  await page.waitForTimeout(300);

  await expect(page.locator(".export-preview-card")).toHaveScreenshot("elevation.png", {
    mask: [page.locator(".export-preview-card svg text")]
  });
});
