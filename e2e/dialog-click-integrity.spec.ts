import { test, expect, gotoApp, addArtwork } from "./fixtures";

// Regression guard: in the bulk mat & frame section, focusing then blurring a
// LengthField (e.g. "Mat") used to toggle a focus-only accepted-formats hint
// paragraph, resizing the layout and shifting the Apply button between
// mousedown and mouseup — so a real, well-aimed click could land on empty
// space instead of the button. The fix is the `hideFocusHint` prop on the bulk
// LengthFields (src/app/components/inspectors/SelectionInspector.tsx
// MatFrameSection, src/app/components/shared/LengthField.tsx). Bulk mat & frame
// moved from a Library dialog into the checked-works inspector on 2026-11-09;
// this spec follows it there. It drives one raw mouse gesture (move -> down
// -> up) at a position recorded while the field is still focused, so a layout
// shift on blur would make it miss.

test("clicking Apply in the bulk mat & frame section survives the Mat field's blur", async ({
  page
}) => {
  await gotoApp(page);
  // The first-use privacy notice floats over the inspector's lower right,
  // where Apply sits; settle it so the recorded point hits the button.
  await page.getByRole("button", { name: "No thanks" }).click();
  await addArtwork(page);

  await page.getByRole("button", { name: "Artwork library" }).click();

  const selectAll = page.getByRole("checkbox", { name: "Select all shown artworks" });
  await expect(selectAll).toBeVisible();
  await selectAll.check();

  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toContainText("1 checked work");
  await inspector.getByRole("button", { name: "Mat & frame" }).click();
  // Let the section finish opening: focusing a field inside a still-animating
  // collapsible scrolls its clipped content, which unwinds when the animation
  // ends — a shift no real (slower) user meets, and not the one guarded here.
  const matInput = inspector.getByLabel("Mat", { exact: true });
  await expect
    .poll(() =>
      matInput.evaluate((field) => {
        const content = field.closest(".collapsible-content");
        return content?.getAttribute("data-state") === "open" && content.getAnimations().length === 0;
      })
    )
    .toBe(true);
  await matInput.click();
  await expect(matInput).toBeFocused();
  await matInput.fill('2"');

  // Still disabled here: the typed band commits on blur. The gesture below
  // must both commit it (mousedown blurs) and land the click.
  const applyButton = inspector.getByRole("button", { name: /^Apply to 1 work/ });
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

  await expect(inspector.getByRole("button", { name: /^Applied to 1 work/ })).toBeVisible();
});
