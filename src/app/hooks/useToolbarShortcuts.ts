import { useEffect } from "react";

import type { InsertToolKind } from "../../domain/placement/createOpening";
import type { ViewMode } from "../store";
import { isEditableTarget } from "./isEditableTarget";

export type UseToolbarShortcutsParams = {
  viewMode: ViewMode;
  // True while a workspace dialog owns the keyboard.
  suspended: boolean;
  // Mirrors disabled insert buttons, such as Elevation without a selected wall.
  insertDisabled: boolean;
  activeTool: InsertToolKind | null;
  armOpeningTool: (tool: InsertToolKind | null) => void;
  togglePartitionTool: () => void;
  toggleDrawRect: () => void;
  toggleDrawRoom: () => void;
  // Optional during the staged canvas integration; once App supplies it, M
  // participates in the same guarded shortcut system as the existing tools.
  toggleMeasure?: () => void;
  toggleShowGrid: () => void;
  toggleSnapToGrid: () => void;
  toggleAllowOverlappingPlacement: () => void;
  toggleShowCenterline: () => void;
};

// Single-key 2D toolbar accelerators. They stand down for editable targets,
// dialogs, modifiers, and repeats; 3D reserves letters for camera controls.
export function useToolbarShortcuts({
  viewMode,
  suspended,
  insertDisabled,
  activeTool,
  armOpeningTool,
  togglePartitionTool,
  toggleDrawRect,
  toggleDrawRoom,
  toggleMeasure,
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

      const armOpening = (kind: InsertToolKind) => {
        // Match disabled insert buttons.
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
        case "t":
          armOpening("wall-text");
          break;
        case "c":
          // The display case is plan-only (it decides wall-vs-floor from where
          // the click lands, which elevation's single wall can't offer).
          if (viewMode !== "plan") return;
          armOpening("case");
          break;
        case "p":
          if (viewMode !== "plan") return;
          event.preventDefault();
          togglePartitionTool();
          break;
        case "m":
          event.preventDefault();
          toggleMeasure?.();
          break;
        case "r":
          if (viewMode !== "plan") return;
          event.preventDefault();
          // R draws rectangles; Shift+R draws polygon outlines.
          if (event.shiftKey) toggleDrawRoom();
          else toggleDrawRect();
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
    toggleDrawRect,
    toggleDrawRoom,
    toggleMeasure,
    toggleShowGrid,
    toggleSnapToGrid,
    toggleAllowOverlappingPlacement,
    toggleShowCenterline
  ]);
}
