import { useEffect } from "react";

import type { OpeningKind } from "../../domain/placement/createOpening";
import type { ViewMode } from "../store";
import { isEditableTarget } from "./isEditableTarget";

export type UseToolbarShortcutsParams = {
  viewMode: ViewMode;
  // True while any workspace dialog owns the keyboard (help, import, settings,
  // delete-confirm). App tracks each of these; the caller ORs them together.
  suspended: boolean;
  // The insert tools are disabled when Elevation has no selected wall — D/W/B
  // become no-ops there, mirroring the disabled buttons.
  insertDisabled: boolean;
  activeTool: OpeningKind | null;
  armOpeningTool: (tool: OpeningKind | null) => void;
  togglePartitionTool: () => void;
  toggleDrawRoom: () => void;
  toggleShowGrid: () => void;
  toggleSnapToGrid: () => void;
  toggleAllowOverlappingPlacement: () => void;
  toggleShowCenterline: () => void;
};

// Single-key toolbar accelerators, live only in the two 2D views — never 3D,
// where WASD owns the letter keys for camera travel. Each key mirrors a
// toolbar control's click exactly (arm/disarm via the same toggle the button
// calls), so a tooltip's "— D" hint always tells the truth. Same window-level
// idiom as the other shortcut hooks: guard editable targets, stand down when a
// dialog is up (suspended) or a modifier is held (⌘/Ctrl/Alt reserve their own
// chords), and ignore auto-repeat so a held key can't strobe a toggle. Plan
// owns Partition/Draw-room (R), Elevation owns Eyeline (E); Grid/Snap/Overlap
// and the opening tools work in both. Deliberately no sticky repeat-placement
// modifier — arming is a plain toggle here, same as the buttons.
export function useToolbarShortcuts({
  viewMode,
  suspended,
  insertDisabled,
  activeTool,
  armOpeningTool,
  togglePartitionTool,
  toggleDrawRoom,
  toggleShowGrid,
  toggleSnapToGrid,
  toggleAllowOverlappingPlacement,
  toggleShowCenterline
}: UseToolbarShortcutsParams) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (suspended) return;
      if (viewMode !== "plan" && viewMode !== "elevation") return;
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.repeat) return;
      if (isEditableTarget(event.target)) return;

      const armOpening = (kind: OpeningKind) => {
        // A no-op when the tools are disabled (Elevation with no selected
        // wall), matching the buttons that ignore the click there.
        if (insertDisabled) return;
        event.preventDefault();
        armOpeningTool(activeTool === kind ? null : kind);
      };

      switch (event.key.toLowerCase()) {
        case "d":
          armOpening("door");
          break;
        case "w":
          armOpening("window");
          break;
        case "b":
          armOpening("blocked-zone");
          break;
        case "p":
          if (viewMode !== "plan") return;
          event.preventDefault();
          togglePartitionTool();
          break;
        case "r":
          if (viewMode !== "plan") return;
          event.preventDefault();
          toggleDrawRoom();
          break;
        case "g":
          event.preventDefault();
          toggleShowGrid();
          break;
        case "s":
          event.preventDefault();
          toggleSnapToGrid();
          break;
        case "o":
          event.preventDefault();
          toggleAllowOverlappingPlacement();
          break;
        case "e":
          if (viewMode !== "elevation") return;
          event.preventDefault();
          toggleShowCenterline();
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    viewMode,
    suspended,
    insertDisabled,
    activeTool,
    armOpeningTool,
    togglePartitionTool,
    toggleDrawRoom,
    toggleShowGrid,
    toggleSnapToGrid,
    toggleAllowOverlappingPlacement,
    toggleShowCenterline
  ]);
}
