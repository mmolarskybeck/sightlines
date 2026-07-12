// The help dialog's control inventory, per view x input mode, as plain data.
// Every entry mirrors a real binding — the source of truth is cited per group
// so drift is checkable: useUndoRedoShortcuts / useDeleteAndEscapeShortcuts /
// useArrangeNudgeShortcuts / useToolbarShortcuts (keyboard),
// useSvgViewportGestures (2D pan/zoom), PlanView's draw/reshape/marquee
// handlers, ChecklistPanel's drag sources, and ThreeDView's CursorZoom /
// KeyboardTravel / OrbitControls bindings.

export type HelpInputMode = "keyboard" | "touch";
export type HelpViewTab = "plan" | "elevation" | "3d";

export type HelpHint = { action: string; keys: string[] };
export type HelpGroup = { title: string; hints: HelpHint[] };

// Single-key toolbar accelerators (useToolbarShortcuts) — keyboard only; touch
// users tap the same toolbar buttons directly. Plan owns Partition and the
// room-draw tools (R rectangle, ⇧R outline), Elevation owns Eyeline; the
// opening tools and Grid/Snap/Overlap are shared.
function toolbarKeyboardGroup(view: "plan" | "elevation"): HelpGroup {
  return {
    title: "Toolbar",
    hints: [
      { action: "Insert a door", keys: ["D"] },
      { action: "Insert a window", keys: ["W"] },
      { action: "Mark a blocked zone", keys: ["B"] },
      ...(view === "plan"
        ? [
            { action: "Draw a partition", keys: ["P"] },
            { action: "Draw a rectangular room", keys: ["R"] },
            { action: "Draw a room outline", keys: ["⇧ R"] }
          ]
        : []),
      { action: "Toggle grid", keys: ["G"] },
      { action: "Toggle snap", keys: ["S"] },
      { action: "Toggle overlap", keys: ["O"] },
      ...(view === "elevation" ? [{ action: "Toggle eyeline", keys: ["E"] }] : [])
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
        { action: "Pan", keys: ["Drag empty space"] },
        { action: "Zoom", keys: ["Pinch"] },
        { action: "Deselect", keys: ["Tap empty space"] }
      ]
    };
  }
  return {
    title: "Navigate",
    hints: [
      { action: "Pan", keys: ["Space + drag", "Scroll"] },
      { action: "Zoom", keys: [`${mod} scroll`, "Pinch"] },
      { action: "Zoom to fit", keys: [`${mod} 0`] }
    ]
  };
}

function planGroups(inputMode: HelpInputMode, mod: string): HelpGroup[] {
  if (inputMode === "touch") {
    return [
      {
        title: "Edit",
        hints: [
          { action: "Select", keys: ["Tap"] },
          { action: "Move a room or object", keys: ["Drag it"] }
        ]
      },
      canvas2dNavigation(inputMode, mod)
    ];
  }
  return [
    {
      title: "Edit",
      hints: [
        { action: "Select", keys: ["Click"] },
        { action: "Select several", keys: ["Drag empty floor", "⇧ keeps existing"] },
        { action: "Move a room or object", keys: ["Drag it"] },
        {
          action: "Draw a rectangular room (toolbar)",
          keys: ["Drag corner to corner", "Esc cancels"]
        },
        {
          action: "Draw a room outline (toolbar)",
          keys: ["Click corners", "Enter closes", "⌫ undoes one", "Esc cancels"]
        },
        { action: "Edit a room's shape", keys: ["Double-click it", "Esc done"] },
        { action: "Draw a partition (toolbar)", keys: ["Drag inside a room"] },
        { action: "Place a door or window (toolbar)", keys: ["Click a wall"] }
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
          { action: "Hang a work", keys: ["Hold in the checklist, then drag"] },
          { action: "Move a work", keys: ["Drag it"] },
          { action: "Switch walls", keys: ["Chevrons on the wall label"] }
        ]
      },
      canvas2dNavigation(inputMode, mod)
    ];
  }
  return [
    {
      title: "Hang & arrange",
      hints: [
        { action: "Hang a work", keys: ["Drag it from the checklist"] },
        { action: "Move a work", keys: ["Drag it", "Arrow keys"] },
        { action: "Nudge in larger steps", keys: ["⇧ arrow"] },
        { action: "Nudge in fine steps", keys: ["⌥ arrow"] },
        { action: "Apply a group nudge", keys: ["Enter"] },
        { action: "Select several", keys: ["Drag the wall background", "⇧ keeps existing"] },
        { action: "Switch walls", keys: ["Chevrons on the wall label"] }
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
          { action: "Pan", keys: ["One-finger drag"] },
          { action: "Zoom & orbit", keys: ["Pinch and twist two fingers"] },
          { action: "Focus a spot", keys: ["Double-tap it"] },
          { action: "Presets", keys: ["Overview", "Eye level", "Focus selection"] }
        ]
      }
    ];
  }
  return [
    {
      title: "Move the camera",
      hints: [
        { action: "Orbit", keys: ["Drag"] },
        { action: "Pan along the floor", keys: ["Right-drag"] },
        { action: "Zoom toward the cursor", keys: ["Scroll", "Pinch"] },
        { action: "Walk around", keys: ["W A S D", "Arrow keys"] },
        { action: "Walk faster", keys: ["⇧ held"] },
        { action: "Focus a spot", keys: ["Double-click it"] },
        { action: "Presets", keys: ["Overview", "Eye level", "Focus selection"] }
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
        { action: "Undo / redo", keys: ["Toolbar arrows"] },
        { action: "Remove a placement", keys: ["Remove in the inspector"] }
      ]
    };
  }
  const mod = isMac ? "⌘" : "Ctrl";
  return {
    title: "Everywhere",
    hints: [
      { action: "Undo / redo", keys: [`${mod} Z`, isMac ? "⇧ ⌘ Z" : `${mod} Y`] },
      { action: "Delete selection", keys: [isMac ? "⌫" : "Del"] },
      { action: "Deselect / cancel tool", keys: ["Esc"] }
    ]
  };
}
