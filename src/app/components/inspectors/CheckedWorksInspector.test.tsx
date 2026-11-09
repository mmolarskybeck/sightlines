import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artwork } from "../../../domain/project";
import { TooltipProvider } from "../ui/tooltip";
import { CheckedWorksInspector } from "./CheckedWorksInspector";

afterEach(cleanup);

const make = (id: string, artist?: string, extra: Partial<Artwork> = {}): Artwork => ({
  id,
  schemaVersion: 1,
  title: id,
  artist,
  dimensions: { widthMm: 500, heightMm: 700, status: "known" },
  metadata: {},
  ...extra
});

const matFrame = {
  targetCount: 2,
  skippedCount: 0,
  currentValues: [],
  onApply: vi.fn(async () => ({ updated: 0, skipped: 0 }))
};

function setup(
  artworks: Artwork[],
  onCommit = vi.fn(async () => ({ updated: artworks.length, placementTypeSkipped: 0 }))
) {
  const ui = (list: Artwork[]) => (
    <TooltipProvider>
      <CheckedWorksInspector
        artworks={list}
        unit="in"
        onCommit={onCommit}
        matFrame={matFrame}
        onClear={() => {}}
      />
    </TooltipProvider>
  );
  const view = render(ui(artworks));
  return { onCommit, rerender: (list: Artwork[]) => view.rerender(ui(list)) };
}

const artist = () => screen.getByLabelText("Artist") as HTMLInputElement;

describe("CheckedWorksInspector", () => {
  it("shows the shared artist", () => {
    setup([make("a", "Ana"), make("b", "Ana")]);
    expect(artist().value).toBe("Ana");
    expect(screen.getByText("2 checked works")).toBeTruthy();
  });

  it("shows Mixed when artists differ", () => {
    setup([make("a", "Ana"), make("b", "Bo")]);
    expect(artist().value).toBe("");
    expect(artist().placeholder).toBe("Mixed");
  });

  it("commits a new artist on blur once", () => {
    const { onCommit } = setup([make("a", "Ana"), make("b", "Bo")]);
    fireEvent.focus(artist());
    fireEvent.change(artist(), { target: { value: " X " } });
    fireEvent.blur(artist());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ artist: "X" });
  });

  it("does not commit unchanged or empty-mixed blurs", () => {
    const shared = setup([make("a", "Ana"), make("b", "Ana")]);
    fireEvent.focus(artist());
    fireEvent.blur(artist());
    expect(shared.onCommit).not.toHaveBeenCalled();
    cleanup();
    const mixed = setup([make("a", "Ana"), make("b", "Bo")]);
    fireEvent.focus(artist());
    fireEvent.blur(artist());
    expect(mixed.onCommit).not.toHaveBeenCalled();
  });

  it("clearing a shared field commits undefined", () => {
    const { onCommit } = setup([make("a", "Ana"), make("b", "Ana")]);
    fireEvent.focus(artist());
    fireEvent.change(artist(), { target: { value: "" } });
    fireEvent.blur(artist());
    expect(onCommit).toHaveBeenCalledWith({ artist: undefined });
  });

  it.each([
    ["shared", [make("a", "Ana"), make("b", "Ana")], "Ana"],
    ["mixed", [make("a", "Ana"), make("b", "Bo")], ""]
  ] as const)("Escape cancels a %s draft, then a later edit still commits", (_name, works, original) => {
    const { onCommit } = setup([...works]);
    act(() => artist().focus());
    fireEvent.change(artist(), { target: { value: "Discard this" } });
    fireEvent.keyDown(artist(), { key: "Escape" });
    expect(artist().value).toBe(original);
    expect(onCommit).not.toHaveBeenCalled();

    act(() => artist().focus());
    fireEvent.change(artist(), { target: { value: "Keep this" } });
    fireEvent.keyDown(artist(), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith({ artist: "Keep this" });
  });

  it("commits placement type and reports skipped placed works", async () => {
    const onCommit = vi.fn(async () => ({ updated: 2, placementTypeSkipped: 1 }));
    setup([make("a", "Ana"), make("b", "Bo")], onCommit);
    fireEvent.click(screen.getByRole("radio", { name: "Floor" }));
    expect(onCommit).toHaveBeenCalledWith({ placementForm: "floor" });
    await waitFor(() =>
      expect(screen.getByText(/1 placed work kept its placement type/)).toBeTruthy()
    );
  });

  it("resets drafts when the selection changes", () => {
    const { rerender } = setup([make("a", "Ana"), make("b", "Ana")]);
    fireEvent.change(artist(), { target: { value: "typing" } });
    expect(artist().value).toBe("typing");
    rerender([make("c", "Cy"), make("d", "Cy")]);
    expect(artist().value).toBe("Cy");
  });
});
