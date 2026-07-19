import { test, expect, gotoApp, addArtwork } from "./fixtures";

// Regression guard: inside BulkMatFrameDialog, focusing then blurring a
// LengthField (e.g. "Mat") used to toggle a focus-only accepted-formats hint
// paragraph, resizing the dialog and shifting the Apply button between
// mousedown and mouseup — so a real, well-aimed click could land on empty
// space instead of the button. The fix is the `hideFocusHint` prop on the
// bulk dialog's LengthFields (src/app/components/library/BulkMatFrameDialog.tsx,
// src/app/components/shared/LengthField.tsx). This spec drives one raw
// mouse gesture (move -> down -> up) at a position recorded while the field
// is still focused, so a layout shift on blur would make it miss.

test("clicking Apply in BulkMatFrameDialog survives the Mat field's blur", async ({
  page
}) => {
  await gotoApp(page);
  await addArtwork(page);

  await page.getByRole("button", { name: "Artwork library" }).click();

  const selectAll = page.getByRole("checkbox", { name: "Select all shown artworks" });
  await expect(selectAll).toBeVisible();
  await selectAll.check();

  const selectionBar = page.getByRole("status").filter({ hasText: "selected" });
  await expect(selectionBar).toBeVisible();
  await selectionBar.getByRole("button", { name: "Set mat & frame" }).click();

  const dialog = page.getByRole("dialog", { name: "Set mat & frame" });
  await expect(dialog).toBeVisible();

  const matInput = dialog.getByLabel("Mat", { exact: true });
  await matInput.click();
  await expect(matInput).toBeFocused();

  const applyButton = dialog.getByRole("button", { name: "Apply" });
  await expect(applyButton).toBeEnabled();
  const box = await applyButton.boundingBox();
  if (!box) throw new Error("Apply button has no bounding box.");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // One raw gesture: mousedown blurs the Mat field first (same order a real
  // click produces), then mouseup completes at the SAME recorded point. If a
  // hideFocusHint regression reintroduces a layout shift on blur, this
  // misses the (now-moved) button.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();

  await expect(dialog).not.toBeVisible();
});
