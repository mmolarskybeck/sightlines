import { describe, expect, it } from "vitest";
import {
  generalHelpGroup,
  viewHelpGroups,
  type HelpGroup,
  type HelpViewTab
} from "./helpContent";

const VIEWS: HelpViewTab[] = ["plan", "elevation", "3d"];

function keyLabels(groups: HelpGroup[]): string[] {
  return groups
    .flatMap((group) => group.hints)
    .flatMap((hint) => hint.inputs)
    .flat()
    .filter((token) => token.kind === "key")
    .map((token) => token.label);
}

function textLabels(groups: HelpGroup[]): string[] {
  return groups
    .flatMap((group) => group.hints)
    .flatMap((hint) => hint.inputs)
    .flat()
    .filter((token) => token.kind === "text")
    .map((token) => token.label);
}

describe("viewHelpGroups", () => {
  it("returns non-empty groups whose hints each carry at least one input token", () => {
    for (const view of VIEWS) {
      for (const inputMode of ["keyboard", "touch"] as const) {
        const groups = viewHelpGroups(view, inputMode, true);
        expect(groups.length).toBeGreaterThan(0);
        for (const group of groups) {
          expect(group.title).not.toBe("");
          expect(group.hints.length).toBeGreaterThan(0);
          for (const hint of group.hints) {
            expect(hint.action).not.toBe("");
            expect(hint.inputs.length).toBeGreaterThan(0);
            for (const input of hint.inputs) {
              expect(input.length).toBeGreaterThan(0);
              for (const token of input) {
                expect(token.label).not.toBe("");
              }
            }
          }
        }
      }
    }
  });

  it("spells the modifier per platform as a key chip in the 2D navigation hints", () => {
    const macKeys = keyLabels(viewHelpGroups("plan", "keyboard", true));
    const pcKeys = keyLabels(viewHelpGroups("plan", "keyboard", false));
    expect(macKeys).toContain("⌘");
    expect(macKeys).toContain("0"); // Zoom to fit: ⌘ 0
    expect(pcKeys).toContain("Ctrl");
    expect(pcKeys).not.toContain("⌘");
  });

  it("renders gesture words as plain text, not key chips", () => {
    const planText = textLabels(viewHelpGroups("plan", "keyboard", true));
    // "Space + drag": Space is a chip, "drag" is a plain-text token.
    expect(keyLabels(viewHelpGroups("plan", "keyboard", true))).toContain("Space");
    expect(planText).toContain("drag");
    expect(keyLabels(viewHelpGroups("plan", "keyboard", true))).not.toContain("drag");
  });

  it("describes the 3D keyboard travel and focus bindings", () => {
    const groups = viewHelpGroups("3d", "keyboard", true);
    const keys = keyLabels(groups);
    const text = textLabels(groups);
    expect(keys).toEqual(expect.arrayContaining(["W", "A", "S", "D", "Arrow keys"]));
    expect(text).toContain("double-click it");
    expect(text).toContain("right-drag");
  });

  it("describes the 3D touch gestures as text, not keys", () => {
    const groups = viewHelpGroups("3d", "touch", true);
    const text = textLabels(groups);
    expect(text).toContain("one-finger drag");
    expect(text).toContain("double-tap it");
    expect(text).toContain("pinch and twist two fingers");
    expect(keyLabels(groups)).not.toContain("W");
  });

  it("prunes the self-evident plan gestures but keeps the marquee + outline commands", () => {
    const actions = viewHelpGroups("plan", "keyboard", true)
      .flatMap((group) => group.hints)
      .map((hint) => hint.action);
    // Discoverable rows are gone.
    expect(actions).not.toContain("Select");
    expect(actions).not.toContain("Move a room or object");
    // Non-discoverable rows stay.
    expect(actions).toContain("Select several");
    expect(actions).toContain("Draw a room outline");
    expect(actions).toContain("Edit a room's shape");
  });

  it("lists the toolbar accelerators per view on keyboard, but not on touch", () => {
    const planKeys = keyLabels(viewHelpGroups("plan", "keyboard", true));
    expect(planKeys).toEqual(
      expect.arrayContaining(["D", "W", "B", "P", "R", "⇧", "G", "S", "O"])
    );
    expect(planKeys).not.toContain("E"); // Eyeline is elevation-only

    const elevationKeys = keyLabels(viewHelpGroups("elevation", "keyboard", true));
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
  it("renders the platform's undo/redo chord as key chips", () => {
    expect(generalHelpGroup("keyboard", true).hints[0]?.inputs).toEqual([
      [
        { kind: "key", label: "⌘" },
        { kind: "key", label: "Z" }
      ],
      [
        { kind: "key", label: "⇧" },
        { kind: "key", label: "⌘" },
        { kind: "key", label: "Z" }
      ]
    ]);
    expect(generalHelpGroup("keyboard", false).hints[0]?.inputs).toEqual([
      [
        { kind: "key", label: "Ctrl" },
        { kind: "key", label: "Z" }
      ],
      [
        { kind: "key", label: "Ctrl" },
        { kind: "key", label: "Y" }
      ]
    ]);
  });

  it("points touch users at on-screen affordances instead of keys", () => {
    const text = textLabels([generalHelpGroup("touch", true)]);
    expect(text.some((label) => label.toLowerCase().includes("toolbar"))).toBe(true);
    expect(keyLabels([generalHelpGroup("touch", true)])).toHaveLength(0);
  });
});
