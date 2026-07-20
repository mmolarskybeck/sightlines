import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelpDialog } from "./HelpDialog";

// jsdom has no matchMedia; the component treats that as "not touch-primary".
// Install a controllable stub so the coarse-pointer default is testable.
let coarsePointer = false;
beforeEach(() => {
  coarsePointer = false;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(pointer: coarse)" && coarsePointer,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }));
});

afterEach(() => {
  cleanup();
});

function renderHelp(viewMode: "plan" | "elevation" | "library" | "3d" = "plan") {
  return render(
    <HelpDialog open viewMode={viewMode} onOpenChange={() => {}} />
  );
}

describe("HelpDialog", () => {
  it("preselects the tab for the active view", () => {
    renderHelp("3d");
    expect(screen.getByRole("tab", { name: "3D" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
  });

  it("falls back to the Plan tab for non-canvas views", () => {
    renderHelp("library");
    expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("defaults to keyboard hints and flips to touch via the toggle", () => {
    renderHelp("3d");
    // Keyboard variant: WASD travel is listed (each key is its own chip).
    expect(screen.getByText("Walk around")).toBeInTheDocument();
    expect(screen.getByText("W")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Touch" }));
    expect(screen.queryByText("Walk around")).not.toBeInTheDocument();
    expect(screen.getByText("pinch and twist two fingers")).toBeInTheDocument();
  });

  it("defaults to touch hints on a coarse-pointer device", () => {
    coarsePointer = true;
    renderHelp("3d");
    expect(screen.getByText("one-finger drag")).toBeInTheDocument();
    expect(screen.queryByText("Walk around")).not.toBeInTheDocument();
  });

  it("renders the platform modifier as a key chip in the general shortcuts", () => {
    // jsdom's navigator.platform is not mac-like, so the Ctrl chord renders.
    renderHelp();
    // The chord is split into separate chips now; Ctrl appears in both Z and Y.
    expect(screen.getAllByText("Ctrl").length).toBeGreaterThan(0);
    expect(screen.getByText("Del")).toBeInTheDocument();
  });

  it("keeps the general group visible on every tab", () => {
    renderHelp("plan");
    expect(screen.getByText("Everywhere")).toBeInTheDocument();
    // Radix tabs activate on mousedown (automatic activation), not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Elevation" }), { button: 0 });
    expect(screen.getByRole("tab", { name: "Elevation" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("Everywhere")).toBeInTheDocument();
  });

  it("keeps the privacy note and trust links", () => {
    renderHelp();
    expect(screen.getByText(/stay on this device/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "https://sightlines.art/privacy"
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      "https://sightlines.art/about"
    );
  });
});
