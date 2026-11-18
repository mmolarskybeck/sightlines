import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui/tooltip";
import { ArtworkBulkBar, type ArtworkBulkBarProps } from "./ArtworkBulkBar";

afterEach(cleanup);

const base: ArtworkBulkBarProps = {
  scope: "checklist",
  checkedCount: 2,
  hiddenCount: 0,
  onClear: vi.fn(),
  onEdit: vi.fn(),
  onDuplicate: vi.fn()
};
const renderBar = (props: Partial<ArtworkBulkBarProps>) =>
  render(<TooltipProvider><ArtworkBulkBar {...base} {...props} /></TooltipProvider>);

describe("ArtworkBulkBar", () => {
  it("arms an inline confirm and removes only on confirm", () => {
    const onRemove = vi.fn();
    renderBar({ hiddenCount: 2, onRemove, placedCheckedCount: 1 });
    expect(screen.getByText("2 selected (2 hidden)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove 2 works from the checklist\?.*\(2 not shown\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("cancel disarms without removing", () => {
    const onRemove = vi.fn();
    renderBar({ onRemove });
    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Select on canvas/ })).toBeTruthy();
  });

  it("disables Select on canvas when nothing checked is placed", () => {
    renderBar({ placedCheckedCount: 0, onSelectOnCanvas: vi.fn() });
    expect(screen.getByRole("button", { name: /Select on canvas/ })).toBeDisabled();
  });

  it("library scope shows Add to checklist and Delete, not Remove", () => {
    renderBar({ scope: "library", onAddToChecklist: vi.fn(), onDelete: vi.fn() });
    expect(screen.getByRole("button", { name: /Add to checklist/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Delete/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});
