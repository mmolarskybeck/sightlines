import { useEffect } from "react";

import { getGroupBounds } from "../../domain/placement/groupBounds";
import {
  quantizeXToCleanIncrement,
  quantizeYToCleanIncrement
} from "../../domain/snapping/cleanIncrement";
import type { Project } from "../../domain/project";
import { unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { getProjectWalls, type ArrangeSession, type ViewMode } from "../store";
import { isEditableTarget } from "./isEditableTarget";

export type UseArrangeNudgeShortcutsParams = {
  project: Project | null;
  viewMode: ViewMode;
  selectedObjectIds: string[];
  draggingArtworkId: string | null;
  arrangeSession: ArrangeSession | null;
  allowOverlappingPlacement: boolean;
  snapToGrid: boolean;
  gridPrecisionFloorMm: number | null;
  beginArrangeSession: (mode: ArrangeSession["mode"]) => void;
  setArrangeSessionPreview: (moves: { id: string; xMm: number; yMm: number }[]) => void;
  commitArrangeSession: (allowOverlap?: boolean) => void;
  moveArtworkPlacement: (
    wallObjectId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  moveOpening: (
    wallObjectId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
};

// Arrange keyboard shortcuts, scoped to the elevation view: Enter commits a
// live arrange session, and arrow keys nudge the whole selected group (a
// series of nudges auto-opens one session so they commit as a single undo
// entry). Both stay out of the way of text editing (isEditableTarget) and of
// an in-flight checklist drag. Eligibility mirrors the arrange readout — 2+
// wall objects, no floor member, all on one wall.
export function useArrangeNudgeShortcuts({
  project,
  viewMode,
  selectedObjectIds,
  draggingArtworkId,
  arrangeSession,
  allowOverlappingPlacement,
  snapToGrid,
  gridPrecisionFloorMm,
  beginArrangeSession,
  setArrangeSessionPreview,
  commitArrangeSession,
  moveArtworkPlacement,
  moveOpening
}: UseArrangeNudgeShortcutsParams) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (!project) return;

      if (event.key === "Enter") {
        if (!arrangeSession) return;
        event.preventDefault();
        commitArrangeSession(allowOverlappingPlacement);
        return;
      }

      const isArrow =
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown";
      if (!isArrow) return;
      if (viewMode !== "elevation") return;
      if (draggingArtworkId) return;

      const selectedWallObjects = project.wallObjects.filter((wallObject) =>
        selectedObjectIds.includes(wallObject.id)
      );
      const hasFloorMember = project.floorObjects.some((floorObject) =>
        selectedObjectIds.includes(floorObject.id)
      );
      // A pure wall selection with no stale/floor ids: 1 object nudges directly
      // (below), 2+ go through the arrange session over its ARTWORK members. A
      // cross-wall or partly-stale selection bails.
      if (hasFloorMember) return;
      if (
        selectedWallObjects.length === 0 ||
        selectedWallObjects.length !== selectedObjectIds.length
      ) {
        return;
      }

      // Nudge steps under the "default movement lands on clean values,
      // precision movement is opt-in" rule:
      //  • snapToGrid OFF → today's raw deltas exactly (½″/1cm fine, 2″/50mm
      //    Shift), no quantization at all.
      //  • snapToGrid ON, no modifier → step = the precision floor (or 1″/1cm
      //    when Auto), Shift = 4× that; the moved axis is then cleaned via
      //    quantize* below, so a first press off a messy spot lands clean in the
      //    travel direction and later presses stay clean (the §1 invariant).
      //  • Alt/Option → honest fine precision (1/16″ / 1mm), NEVER quantized —
      //    the deliberate opt-in to unclean values.
      // Typed inputs and the arrange inset/gap steppers are untouched.
      const system = unitSystemFromDisplayUnit(project.unit);
      const autoStepMm = system === "metric" ? 10 : 12.7;
      const useQuantize = snapToGrid && !event.altKey;
      let stepMm: number;
      if (!snapToGrid) {
        stepMm = event.shiftKey ? (system === "metric" ? 50 : 50.8) : autoStepMm;
      } else if (event.altKey) {
        stepMm = system === "metric" ? 1 : 1.5875;
      } else {
        const normalMm = gridPrecisionFloorMm ?? autoStepMm;
        stepMm = event.shiftKey ? normalMm * 4 : normalMm;
      }
      // The quantizer's period is always the normal (non-Shift) increment, so a
      // 4× Shift press still lands on the same clean lattice.
      const incrementMm = gridPrecisionFloorMm ?? autoStepMm;

      // ArrowUp raises the works (higher yMm = higher on the wall = up on
      // screen); ArrowRight moves them along +x.
      const dxMm =
        event.key === "ArrowRight" ? stepMm : event.key === "ArrowLeft" ? -stepMm : 0;
      const dyMm =
        event.key === "ArrowUp" ? stepMm : event.key === "ArrowDown" ? -stepMm : 0;

      // A single selected placement nudges directly, one store commit per press
      // (per-press undo entries — deliberately NOT an arrange session: its
      // guards need 2+ artwork members, and an invisible single-work session
      // would have no Apply/Cancel affordance). Artworks move via
      // moveArtworkPlacement, openings via moveOpening, matching the single-
      // object pointer-drag split — a lone opening still nudges here.
      if (selectedWallObjects.length === 1) {
        event.preventDefault();
        event.stopPropagation();
        const member = selectedWallObjects[0];
        let nextXMm = member.xMm + dxMm;
        let nextYMm = member.yMm + dyMm;
        if (useQuantize) {
          const wall = getProjectWalls(project).find((candidate) => candidate.id === member.wallId);
          if (wall) {
            const size = { widthMm: member.widthMm, heightMm: member.heightMm };
            const neighbors = project.wallObjects.filter(
              (object) => object.wallId === member.wallId && object.id !== member.id
            );
            if (dxMm !== 0) {
              nextXMm = quantizeXToCleanIncrement(
                { xMm: nextXMm, yMm: nextYMm },
                size,
                incrementMm,
                wall.lengthMm,
                neighbors
              );
            }
            if (dyMm !== 0) {
              nextYMm = quantizeYToCleanIncrement({ xMm: nextXMm, yMm: nextYMm }, size, incrementMm);
            }
          }
        }
        if (member.kind === "artwork") {
          void moveArtworkPlacement(member.id, nextXMm, nextYMm, allowOverlappingPlacement);
        } else {
          void moveOpening(member.id, nextXMm, nextYMm, allowOverlappingPlacement);
        }
        return;
      }

      // A multi-selection nudges through the arrange session, which moves ARTWORK
      // members only (a selected opening is architecture — it stays put). Needs
      // 2+ artwork members on one wall, mirroring the session's own guards.
      const members = selectedWallObjects.filter((member) => member.kind === "artwork");
      if (members.length < 2) return;
      const sameWall = members.every((member) => member.wallId === members[0].wallId);
      if (!sameWall) return;

      event.preventDefault();
      event.stopPropagation();

      // Nudge from the current preview if a session is already open, else from
      // the committed layout. beginArrangeSession is a synchronous set(), so
      // the freshly-begun session is in place before setArrangeSessionPreview
      // reads it below.
      const based = members.map((member) => {
        const preview = arrangeSession?.previewById[member.id];
        return preview ? { ...member, xMm: preview.xMm, yMm: preview.yMm } : member;
      });

      // Quantize the group as ONE virtual object (its union box) and apply the
      // resulting common delta to every member, so the rigid group lands on a
      // clean measurement without disturbing interior spacing.
      const box = getGroupBounds(based);
      let centerXMm = box.centerXMm + dxMm;
      let centerYMm = box.centerYMm + dyMm;
      if (useQuantize) {
        const wall = getProjectWalls(project).find((candidate) => candidate.id === members[0].wallId);
        if (wall) {
          const size = { widthMm: box.widthMm, heightMm: box.heightMm };
          const memberIds = new Set(members.map((member) => member.id));
          const neighbors = project.wallObjects.filter(
            (object) => object.wallId === members[0].wallId && !memberIds.has(object.id)
          );
          if (dxMm !== 0) {
            centerXMm = quantizeXToCleanIncrement(
              { xMm: centerXMm, yMm: centerYMm },
              size,
              incrementMm,
              wall.lengthMm,
              neighbors
            );
          }
          if (dyMm !== 0) {
            centerYMm = quantizeYToCleanIncrement({ xMm: centerXMm, yMm: centerYMm }, size, incrementMm);
          }
        }
      }
      const deltaXMm = centerXMm - box.centerXMm;
      const deltaYMm = centerYMm - box.centerYMm;
      const moves = based.map((member) => ({
        id: member.id,
        xMm: member.xMm + deltaXMm,
        yMm: member.yMm + deltaYMm
      }));

      if (!arrangeSession) beginArrangeSession("inset");
      setArrangeSessionPreview(moves);
    }

    // Capture phase lets workspace nudges win over focused topbar/menu widgets
    // that implement their own arrow-key roving focus. We only stop propagation
    // after proving a nudge will happen, so real focused controls still keep
    // their keys.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    project,
    viewMode,
    selectedObjectIds,
    draggingArtworkId,
    arrangeSession,
    allowOverlappingPlacement,
    snapToGrid,
    gridPrecisionFloorMm,
    beginArrangeSession,
    setArrangeSessionPreview,
    commitArrangeSession,
    moveArtworkPlacement,
    moveOpening
  ]);
}
