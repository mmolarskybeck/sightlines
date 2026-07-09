import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomContentsSummary } from "../roomDeletion";
import { DeleteRoomDialog } from "./DeleteRoomDialog";

afterEach(cleanup);

const occupied: RoomContentsSummary = {
  artworks: 4,
  doors: 2,
  windows: 0,
  blockedZones: 0,
  partitions: 0,
  isEmpty: false
};

function renderDialog(overrides: Partial<Parameters<typeof DeleteRoomDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <DeleteRoomDialog
      roomName="East Gallery"
      summary={occupied}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      {...overrides}
    />
  );
  return { onConfirm, onOpenChange };
}

describe("DeleteRoomDialog", () => {
  it("names the room and its contents", () => {
    renderDialog();
    expect(screen.getByText("Delete East Gallery?")).toBeTruthy();
    expect(screen.getByText(/It contains 4 artworks and 2 doors\./)).toBeTruthy();
  });

  it("confirm fires onConfirm; cancel only closes", () => {
    const { onConfirm, onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete room" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Escape closes without confirming (Radix owns the key while open)", () => {
    const { onConfirm, onOpenChange } = renderDialog();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing while summary is null", () => {
    renderDialog({ summary: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
