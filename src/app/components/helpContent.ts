// The help dialog's control inventory, per view x input mode, as plain data.
// This dialog is a reference for keyboard shortcuts and the less-discoverable
// commands — self-evident mouse/touch actions (click to select, drag to move,
// scroll to zoom) are intentionally omitted, since the toolbar buttons already
// carry tooltips and those gestures reveal themselves on the first try.
//
// Every entry mirrors a real binding — the source of truth is cited per group
// so drift is checkable: useUndoRedoShortcuts / useDeleteAndEscapeShortcuts /
// useArrangeNudgeShortcuts / useToolbarShortcuts (keyboard),
// useSvgViewportGestures (2D pan/zoom), PlanView's draw/reshape/marquee
// handlers, ChecklistPanel's drag sources, and ThreeDView's CursorZoom /
// KeyboardTravel / OrbitControls bindings.

export type HelpInputMode = "keyboard" | "touch";
export type HelpViewTab = "plan" | "elevation" | "3d";

// A hint's input column is one or more alternatives (e.g. "⌘ Z" or "⇧ ⌘ Z").
// Each alternative is an ordered run of tokens: a `key` renders as a boxed
// <Kbd> chip, a `text` token renders as an un-boxed gesture/connector word
// ("drag", "scroll", "keeps existing"). This keeps real keys visually distinct
// from instructions instead of boxing everything the same way.
export type HelpKeyToken =
  | { kind: "key"; label: string }
  | { kind: "text"; label: string };
export type HelpInput = HelpKeyToken[];

export type HelpHint = { action: string; inputs: HelpInput[] };
export type HelpGroup = { title: string; hints: HelpHint[] };

// Pure-data token constructors (no JSX) so the content tables below stay terse.
const k = (label: string): HelpKeyToken => ({ kind: "key", label });
const t = (label: string): HelpKeyToken => ({ kind: "text", label });
const arrowKeys = (): HelpInput => [k("←"), k("↑"), k("↓"), k("→")];

// Single-key toolbar accelerators (useToolbarShortcuts) — keyboard only; touch
// users tap the same toolbar buttons directly. Plan owns Partition and the
// room-draw tools (R rectangle, ⇧R outline), Elevation owns Eyeline; the
// opening tools and Grid/Snap/Overlap are shared. Exactly the kind of thing
// this dialog exists to surface, so every accelerator stays.
function toolbarKeyboardGroup(view: "plan" | "elevation"): HelpGroup {
  return {
    title: "Toolbar",
    hints: [
      { action: "Insert a door", inputs: [[k("D")]] },
      { action: "Insert a window", inputs: [[k("W")]] },
      { action: "Mark a blocked zone", inputs: [[k("B")]] },
      { action: "Measure distance", inputs: [[k("M")]] },
      ...(view === "plan"
        ? [
            { action: "Draw a partition", inputs: [[k("P")]] },
            { action: "Draw a rectangular room", inputs: [[k("R")]] },
            { action: "Draw a room outline", inputs: [[k("⇧"), k("R")]] }
          ]
        : []),
      { action: "Toggle grid", inputs: [[k("G")]] },
      { action: "Toggle snap", inputs: [[k("S")]] },
      { action: "Toggle overlap", inputs: [[k("O")]] },
      ...(view === "elevation" ? [{ action: "Toggle eyeline", inputs: [[k("E")]] }] : [])
    ]
  };
}

// The 2D canvases (Plan and Elevation) share one gesture engine
// (useSvgViewportGestures), so their navigation hints are identical.
function canvas2dNavigation(inputMode: HelpInputMode, mod: string): HelpGroup {
  if (inputMode === "touch") {
    return {
      title: "Navigate",
      hints: [
        { action: "Pan", inputs: [[t("drag empty space")]] },
        { action: "Deselect", inputs: [[t("tap empty space")]] }
      ]
    };
  }
  return {
    title: "Navigate",
    hints: [
      { action: "Pan", inputs: [[k("Space"), t("drag")], [t("scroll")]] },
      { action: "Zoom", inputs: [[k(mod), t("scroll")]] },
      { action: "Zoom to fit", inputs: [[k(mod), k("0")]] }
    ]
  };
}

function planGroups(inputMode: HelpInputMode, mod: string): HelpGroup[] {
  if (inputMode === "touch") {
    return [
      {
        title: "Edit",
        hints: [{ action: "Move a room or object", inputs: [[t("drag it")]] }]
      },
      canvas2dNavigation(inputMode, mod)
    ];
  }
  return [
    {
      title: "Edit",
      hints: [
        {
          action: "Select several",
          inputs: [[t("drag empty floor")], [k("⇧"), t("keeps existing")]]
        },
        {
          action: "Draw a room outline",
          inputs: [
            [t("click corners")],
            [k("Enter"), t("closes")],
            [k("⌫"), t("undoes a corner")],
            [k("Esc"), t("cancels")]
          ]
        },
        { action: "Edit a room's shape", inputs: [[t("double-click it")], [k("Esc"), t("done")]] }
      ]
    },
    toolbarKeyboardGroup("plan"),
    canvas2dNavigation(inputMode, mod)
  ];
}

function elevationGroups(inputMode: HelpInputMode, mod: string): HelpGroup[] {
  if (inputMode === "touch") {
    return [
      {
        title: "Hang & arrange",
        hints: [
          { action: "Hang a work", inputs: [[t("hold in the checklist, then drag")]] },
          { action: "Switch walls", inputs: [[t("chevrons on the wall label")]] }
        ]
      },
      canvas2dNavigation(inputMode, mod)
    ];
  }
  return [
    {
      title: "Hang & arrange",
      hints: [
        { action: "Nudge a work", inputs: [arrowKeys()] },
        { action: "Nudge in larger steps", inputs: [[k("⇧"), t("arrow")]] },
        { action: "Nudge in fine steps", inputs: [[k("⌥"), t("arrow")]] },
        { action: "Apply a group nudge", inputs: [[k("Enter")]] },
        {
          action: "Select several",
          inputs: [[t("drag the wall background")], [k("⇧"), t("keeps existing")]]
        },
        { action: "Switch walls", inputs: [[t("chevrons on the wall label")]] }
      ]
    },
    toolbarKeyboardGroup("elevation"),
    canvas2dNavigation(inputMode, mod)
  ];
}

function threeDGroups(inputMode: HelpInputMode): HelpGroup[] {
  if (inputMode === "touch") {
    return [
      {
        title: "Move the camera",
        hints: [
          { action: "Pan", inputs: [[t("one-finger drag")]] },
          { action: "Zoom & orbit", inputs: [[t("pinch and twist two fingers")]] },
          { action: "Focus a spot", inputs: [[t("double-tap it")]] }
        ]
      }
    ];
  }
  return [
    {
      title: "Move the camera",
      hints: [
        { action: "Pan along the floor", inputs: [[t("right-drag")]] },
        { action: "Walk around", inputs: [[k("W"), k("A"), k("S"), k("D")], arrowKeys()] },
        { action: "Walk faster", inputs: [[k("⇧"), t("held")]] },
        { action: "Focus a spot", inputs: [[t("double-click it")]] }
      ]
    }
  ];
}

export function viewHelpGroups(
  view: HelpViewTab,
  inputMode: HelpInputMode,
  isMac: boolean
): HelpGroup[] {
  const mod = isMac ? "⌘" : "Ctrl";
  if (view === "plan") return planGroups(inputMode, mod);
  if (view === "elevation") return elevationGroups(inputMode, mod);
  return threeDGroups(inputMode);
}

// View-independent actions. The keyboard rows work in every view (window-level
// listeners); the touch rows point at the always-present toolbar buttons.
export function generalHelpGroup(inputMode: HelpInputMode, isMac: boolean): HelpGroup {
  if (inputMode === "touch") {
    return {
      title: "Everywhere",
      hints: [
        { action: "Undo / redo", inputs: [[t("toolbar arrows")]] },
        { action: "Remove a placement", inputs: [[t("Remove in the inspector")]] }
      ]
    };
  }
  const mod = isMac ? "⌘" : "Ctrl";
  return {
    title: "Everywhere",
    hints: [
      {
        action: "Undo / redo",
        inputs: isMac
          ? [[k("⌘"), k("Z")], [k("⇧"), k("⌘"), k("Z")]]
          : [[k("Ctrl"), k("Z")], [k("Ctrl"), k("Y")]]
      },
      { action: "Delete selection", inputs: [[k(isMac ? "⌫" : "Del")]] },
      { action: "Deselect / cancel tool", inputs: [[k("Esc")]] }
    ]
  };
}
