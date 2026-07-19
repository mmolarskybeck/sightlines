import { test, expect, gotoApp } from "./fixtures";

// Regression guard: the topbar view-switcher's sliding underline used to
// break when a Radix TooltipTrigger (asChild) wrapping each radio item
// clobbered the item's data-state attribute with "closed"/"open". The fix
// (src/app/components/ui/segmented.tsx useSlidingIndicator) matches on
// aria-checked/aria-selected first, falling back to data-state only for
// triggers that aren't also wrapped in a tooltip. This spec exercises only
// the public contract: the underline's geometry vs. the currently-checked
// radio item, including while a tooltip is open (the exact moment the old
// code broke).

test("topbar underline tracks the checked view tab, even while a tooltip is open", async ({
  page
}) => {
  await gotoApp(page);

  const group = page.locator('[aria-label="Workspace view"]');
  await expect(group).toBeVisible();
  const underline = group.locator(".seg-underline");
  await expect(underline).toBeAttached();

  const planTab = page.getByRole("radio", { name: "Plan", exact: true });
  const elevationTab = page.getByRole("radio", { name: "Elevation", exact: true });

  await expect(planTab).toHaveAttribute("aria-checked", "true");

  // Baseline: the underline sits under "Plan" (the default view) once
  // layout settles.
  await expect
    .poll(async () => {
      const underlineBox = await underline.boundingBox();
      const planBox = await planTab.boundingBox();
      if (!underlineBox || !planBox) return null;
      return {
        x: Math.abs(underlineBox.x - planBox.x) <= 1.5,
        width: Math.abs(underlineBox.width - planBox.width) <= 1.5
      };
    })
    .toEqual({ x: true, width: true });

  // Hover "Elevation" and wait for its tooltip to open. This is the exact
  // moment TooltipTrigger used to clobber data-state on the trigger — the
  // underline must not react to it (only the checked-state attributes
  // should move it).
  await elevationTab.hover();
  const tooltip = page.getByRole("tooltip", { name: "View one wall straight on" });
  await expect(tooltip).toBeVisible({ timeout: 5000 });

  const planBoxAfterHover = await planTab.boundingBox();
  const underlineBoxAfterHover = await underline.boundingBox();
  expect(planBoxAfterHover).not.toBeNull();
  expect(underlineBoxAfterHover).not.toBeNull();
  expect(Math.abs(underlineBoxAfterHover!.x - planBoxAfterHover!.x)).toBeLessThanOrEqual(1.5);
  expect(
    Math.abs(underlineBoxAfterHover!.width - planBoxAfterHover!.width)
  ).toBeLessThanOrEqual(1.5);

  // Click "Elevation" while its tooltip is still open — the underline must
  // slide to (and settle under) the newly-checked item.
  await elevationTab.click();
  await expect(elevationTab).toHaveAttribute("aria-checked", "true");

  await expect
    .poll(async () => {
      const underlineBox = await underline.boundingBox();
      const elevationBox = await elevationTab.boundingBox();
      if (!underlineBox || !elevationBox) return null;
      return {
        x: Math.abs(underlineBox.x - elevationBox.x) <= 1.5,
        width: Math.abs(underlineBox.width - elevationBox.width) <= 1.5
      };
    })
    .toEqual({ x: true, width: true });
});
