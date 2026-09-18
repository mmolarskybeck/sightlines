import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtworkFloorObject, FloorSupport } from "../../../domain/project";
import { BONNET_HEADROOM_MM } from "../../../domain/geometry/supportGlyphs";
import { TooltipProvider } from "../ui/tooltip";
import { FloorSupportFields } from "./FloorSupportFields";

afterEach(cleanup);

// 400 × 400 footprint, 600 tall.
const floorArtwork: ArtworkFloorObject = {
  id: "floor-a",
  kind: "artwork",
  artworkId: "art-a",
  xMm: 1000,
  yMm: 1000,
  widthMm: 400,
  depthMm: 400,
  heightMm: 600,
  wallYMm: 1450,
  rotationDeg: 0
};

// Contains the work with a 100mm reveal per side, so the offsets have a ±100mm
// bound to play with.
const pedestal: FloorSupport = {
  kind: "pedestal",
  widthMm: 600,
  depthMm: 600,
  heightMm: 1100
};

// The bonnet-height lock is a tooltipped Toggle, which needs a TooltipProvider
// ancestor — same wrapper FloorArtworkImageSizeNote's and RoomInspector's
// suites use.
function renderFields(support: FloorSupport, object: ArtworkFloorObject = floorArtwork) {
  const onChange = vi.fn();
  const result = render(
    <TooltipProvider>
      <FloorSupportFields
        floorObject={object}
        support={support}
        unit="cm"
        onChange={onChange}
      />
    </TooltipProvider>
  );
  return { onChange, container: result.container };
}

describe("FloorSupportFields", () => {
  it("commits the support box's own size", async () => {
    const { onChange } = renderFields(pedestal);

    const width = screen.getByLabelText("Support width");
    fireEvent.change(width, { target: { value: "90" } });
    fireEvent.blur(width);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ widthMm: 900 }));
  });

  // THE negation boundary. The document stores the SUPPORT's center relative to
  // the WORK's; the inspector states it the way a curator sees it — where the
  // work sits on the support — and flips the sign at this one place.
  it("shows the work's position as the NEGATION of the stored support offset", () => {
    renderFields({ ...pedestal, offsetXMm: 80, offsetYMm: -40 });

    // 80mm support-right of the work means the work sits 8cm left of center.
    expect(screen.getByLabelText("Work X (on support)")).toHaveValue("-8 cm");
    expect(screen.getByLabelText("Work Y (on support)")).toHaveValue("4 cm");
  });

  it("negates a typed work position back into a support offset", async () => {
    const { onChange } = renderFields(pedestal);

    const workX = screen.getByLabelText("Work X (on support)");
    fireEvent.change(workX, { target: { value: "-8" } });
    fireEvent.blur(workX);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ offsetXMm: 80 }));
  });

  // A work that exactly fills the support top has nowhere to slide: the field
  // is disabled rather than hidden, so widening the support brings it back
  // instead of making it appear out of nowhere.
  it("disables the work-position fields when the clamp bound is 0", () => {
    renderFields({ ...pedestal, widthMm: 400, depthMm: 400 });

    expect(screen.getByLabelText("Work X (on support)")).toBeDisabled();
    expect(screen.getByLabelText("Work Y (on support)")).toBeDisabled();
  });

  it("keeps the work-position fields live while the support is bigger than the work", () => {
    renderFields(pedestal);

    expect(screen.getByLabelText("Work X (on support)")).not.toBeDisabled();
    expect(screen.getByLabelText("Work Y (on support)")).not.toBeDisabled();
  });

  it("offers overhang while there is no bonnet", () => {
    const { onChange } = renderFields(pedestal);

    const overhang = screen.getByRole("switch", { name: "Allow overhang" });
    expect(overhang).not.toBeDisabled();
    fireEvent.click(overhang);

    expect(onChange).toHaveBeenCalledWith({ overhangAllowed: true });
  });

  // Normaliser rule 1: a bonnet CLEARS overhang. Disabled with the reason on
  // screen rather than hidden, so the rule is visible where a curator would go
  // looking for it.
  it("disables the overhang switch while a bonnet is on, and says why", () => {
    renderFields({ ...pedestal, bonnetHeightMm: 675 });

    expect(screen.getByRole("switch", { name: "Allow overhang" })).toBeDisabled();
    expect(
      screen.getByText("A bonnet keeps the work inside the support.")
    ).toBeInTheDocument();
  });

  it("turns the bonnet on at the derived height, unlocked", () => {
    const { onChange } = renderFields(pedestal);

    fireEvent.click(screen.getByRole("switch", { name: "Plexi bonnet" }));

    expect(onChange).toHaveBeenCalledWith({
      bonnetHeightMm: floorArtwork.heightMm + BONNET_HEADROOM_MM
    });
    // NOT locked: the enable write must leave the height tracking the work.
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("bonnetHeightLocked");
  });

  // Explicit undefined is the only way to express "delete the key"; a 0 would
  // fail the schema and a missing key would mean "change nothing".
  it("turns the bonnet off by deleting the height", () => {
    const { onChange } = renderFields({ ...pedestal, bonnetHeightMm: 675 });

    fireEvent.click(screen.getByRole("switch", { name: "Plexi bonnet" }));

    expect(onChange).toHaveBeenCalledWith({ bonnetHeightMm: undefined });
    expect("bonnetHeightMm" in (onChange.mock.calls[0][0] as object)).toBe(true);
  });

  it("hides the bonnet height and its lock until there is a bonnet", () => {
    renderFields(pedestal);

    expect(screen.queryByLabelText("Bonnet height")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Lock the bonnet height" })
    ).not.toBeInTheDocument();
  });

  it("shows the bonnet height muted while it tracks the work", () => {
    const { container } = renderFields({ ...pedestal, bonnetHeightMm: 675 });

    expect(screen.getByLabelText("Bonnet height")).toHaveValue("67.5 cm");
    expect(container.querySelector(".support-bonnet-height.derived")).not.toBeNull();
  });

  it("locks and unlocks the bonnet height through the lock toggle", () => {
    const { onChange } = renderFields({ ...pedestal, bonnetHeightMm: 675 });

    fireEvent.click(screen.getByRole("button", { name: "Lock the bonnet height" }));
    expect(onChange).toHaveBeenCalledWith({ bonnetHeightLocked: true });

    cleanup();
    const locked = renderFields({
      ...pedestal,
      bonnetHeightMm: 900,
      bonnetHeightLocked: true
    });
    fireEvent.click(screen.getByRole("button", { name: "Lock the bonnet height" }));
    expect(locked.onChange).toHaveBeenCalledWith({ bonnetHeightLocked: false });
  });

  // "Fit to work" only exists as an escape from a locked number — an unlocked
  // height is already fitted, so the action would be a no-op button.
  it("offers Fit to work only while the height is locked", () => {
    renderFields({ ...pedestal, bonnetHeightMm: 675 });
    expect(screen.queryByRole("button", { name: "Fit to work" })).not.toBeInTheDocument();
    cleanup();

    const { onChange } = renderFields({
      ...pedestal,
      bonnetHeightMm: 900,
      bonnetHeightLocked: true
    });
    fireEvent.click(screen.getByRole("button", { name: "Fit to work" }));

    expect(onChange).toHaveBeenCalledWith({ bonnetHeightLocked: false });
  });

  // A locked bonnet shorter than the work is never grown (USER DECISION
  // 2026-09-17) — the inspector says so instead.
  it("warns by how much the work outgrows a locked bonnet", () => {
    renderFields({
      ...pedestal,
      bonnetHeightMm: 300,
      bonnetHeightLocked: true
    });

    // 600mm work − 300mm glass = 300mm = 30cm.
    expect(screen.getByText("Work is 30 cm taller than the bonnet.")).toBeInTheDocument();
  });

  it("says nothing about height when the bonnet clears the work", () => {
    renderFields({
      ...pedestal,
      bonnetHeightMm: 900,
      bonnetHeightLocked: true
    });

    expect(screen.queryByText(/taller than the bonnet/)).not.toBeInTheDocument();
  });

  it("never warns about an unlocked bonnet, which tracks the work by construction", () => {
    renderFields({ ...pedestal, bonnetHeightMm: 100 });

    expect(screen.queryByText(/taller than the bonnet/)).not.toBeInTheDocument();
  });
});
