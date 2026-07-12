import { describe, expect, it } from "vitest";
import { generalHelpGroup, viewHelpGroups, type HelpViewTab } from "./helpContent";

const VIEWS: HelpViewTab[] = ["plan", "elevation", "3d"];

describe("viewHelpGroups", () => {
  it("returns non-empty groups with non-empty hints for every view x input mode", () => {
    for (const view of VIEWS) {
      for (const inputMode of ["keyboard", "touch"] as const) {
        const groups = viewHelpGroups(view, inputMode, true);
        expect(groups.length).toBeGreaterThan(0);
        for (const group of groups) {
          expect(group.title).not.toBe("");
          expect(group.hints.length).toBeGreaterThan(0);
          for (const hint of group.hints) {
            expect(hint.action).not.toBe("");
            expect(hint.keys.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("spells the modifier per platform in the 2D navigation hints", () => {
    const macKeys = viewHelpGroups("plan", "keyboard", true)
      .flatMap((group) => group.hints)
      .flatMap((hint) => hint.keys);
    const pcKeys = viewHelpGroups("plan", "keyboard", false)
      .flatMap((group) => group.hints)
      .flatMap((hint) => hint.keys);
    expect(macKeys).toContain("⌘ 0");
    expect(pcKeys).toContain("Ctrl 0");
  });

  it("describes the 3D keyboard travel and focus bindings", () => {
    const keys = viewHelpGroups("3d", "keyboard", true)
      .flatMap((group) => group.hints)
      .flatMap((hint) => hint.keys);
    expect(keys).toContain("W A S D");
    expect(keys).toContain("Double-click it");
    expect(keys).toContain("Right-drag");
  });

  it("describes the 3D touch gestures, not keys", () => {
    const hints = viewHelpGroups("3d", "touch", true).flatMap((group) => group.hints);
    const keys = hints.flatMap((hint) => hint.keys);
    expect(keys).toContain("One-finger drag");
    expect(keys).toContain("Double-tap it");
    expect(keys).not.toContain("W A S D");
  });

  it("lists the toolbar accelerators per view on keyboard, but not on touch", () => {
    const planKeys = viewHelpGroups("plan", "keyboard", true)
      .flatMap((group) => group.hints)
      .flatMap((hint) => hint.keys);
    expect(planKeys).toEqual(expect.arrayContaining(["D", "W", "B", "P", "R", "G", "S", "O"]));
    expect(planKeys).not.toContain("E"); // Eyeline is elevation-only

    const elevationKeys = viewHelpGroups("elevation", "keyboard", true)
      .flatMap((group) => group.hints)
      .flatMap((hint) => hint.keys);
    expect(elevationKeys).toEqual(expect.arrayContaining(["D", "W", "B", "G", "S", "O", "E"]));
    expect(elevationKeys).not.toContain("R"); // Draw room / Partition are plan-only

    const touchTitles = viewHelpGroups("plan", "touch", true).map((group) => group.title);
    expect(touchTitles).not.toContain("Toolbar");
  });

  it("keeps the elevation nudge family together on keyboard", () => {
    const actions = viewHelpGroups("elevation", "keyboard", true)
      .flatMap((group) => group.hints)
      .map((hint) => hint.action);
    expect(actions).toContain("Nudge in larger steps");
    expect(actions).toContain("Apply a group nudge");
  });
});

describe("generalHelpGroup", () => {
  it("renders the platform's undo/redo chord", () => {
    expect(generalHelpGroup("keyboard", true).hints[0]?.keys).toEqual(["⌘ Z", "⇧ ⌘ Z"]);
    expect(generalHelpGroup("keyboard", false).hints[0]?.keys).toEqual([
      "Ctrl Z",
      "Ctrl Y"
    ]);
  });

  it("points touch users at on-screen affordances instead of keys", () => {
    const keys = generalHelpGroup("touch", true).hints.flatMap((hint) => hint.keys);
    expect(keys.some((key) => key.includes("Toolbar"))).toBe(true);
  });
});
