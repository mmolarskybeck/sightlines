import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inchesToMm } from "../../domain/units/length";
import { BulkMatFrameDialog } from "./BulkMatFrameDialog";

afterEach(cleanup);

function renderDialog(overrides: Partial<Parameters<typeof BulkMatFrameDialog>[0]> = {}) {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <BulkMatFrameDialog
      open
      targetCount={3}
      skippedCount={0}
      unit="in"
      onApply={onApply}
      onOpenChange={onOpenChange}
      {...overrides}
    />
  );
  return { onApply, onOpenChange };
}

describe("BulkMatFrameDialog", () => {
  it("names the target count and the everywhere-applies scope", () => {
    renderDialog();
    expect(screen.getByText(/Applies to 3 works\./)).toBeTruthy();
    expect(screen.getByText(/Changes apply everywhere these artworks are used\./)).toBeTruthy();
  });

  it("applying with empty fields clears both bands", () => {
    const { onApply, onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ matWidthMm: undefined, frame: undefined });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("committing a mat width applies it as millimetres", () => {
    const { onApply } = renderDialog();

    const mat = screen.getByRole("textbox", { name: "Mat" });
    fireEvent.change(mat, { target: { value: "2" } });
    fireEvent.blur(mat);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const changes = onApply.mock.calls[0][0];
    expect(changes.matWidthMm).toBeCloseTo(inchesToMm(2));
    expect(changes.frame).toBeUndefined();
  });

  it("counts frame-inclusive works that will be skipped", () => {
    renderDialog({ skippedCount: 2 });
    expect(
      screen.getByText("2 selected works include the frame in their size and will be skipped.")
    ).toBeTruthy();
  });

  it("shows no skip note when none are skipped", () => {
    renderDialog({ skippedCount: 0 });
    expect(screen.queryByText(/will be skipped/)).toBeNull();
  });

  it("cancel closes without applying", () => {
    const { onApply, onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
