import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { GridFourIcon } from "@phosphor-icons/react/dist/csr/GridFour";
import { MagnetIcon } from "@phosphor-icons/react/dist/csr/Magnet";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/csr/MapTrifold";
import { PresentationIcon } from "@phosphor-icons/react/dist/csr/Presentation";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import {
  getPlacedRoomBounds,
  getRectangleRoomDimensions,
  getWallsWithGeometry,
  getOrthogonalQuadWallPair,
} from "../domain/geometry/walls";
import {
  getArrangeReadoutDetailed,
  getOpenSpaceBounds,
  getSpacingSegments,
  solveEqualArrangement,
  solveEqualArrangementInZone
} from "../domain/placement/arrangeOnWall";
import { getOpeningKindLabel } from "../domain/placement/createOpening";
import { getGroupBounds } from "../domain/placement/groupBounds";
import {
  quantizeXToCleanIncrement,
  quantizeYToCleanIncrement
} from "../domain/snapping/cleanIncrement";
import type {
  Artwork,
  ArtworkFloorObject,
  ArtworkWallObject,
  BlockedZoneFloorObject,
  DisplayUnit,
  OpeningWallObject,
  Project
} from "../domain/project";
import { IndexedDbAssetRepository } from "../domain/repositories/indexedDbAssetRepository";
import { formatLength } from "../domain/units/length";
import { getGridPrecisionFloorOptionsMm } from "../domain/units/precision";
import {
  displayUnitForSystem,
  getScopeUnits,
  unitSystemFromDisplayUnit,
  type UnitSystem
} from "../domain/units/unitSystem";
import { AppRail } from "./components/AppRail";
import { ArtworkInspector } from "./components/ArtworkInspector";
import { PanelResizeHandle } from "./components/PanelResizeHandle";
import { ChecklistPanel } from "./components/ChecklistPanel";
import { ElevationEmptyState } from "./components/ElevationEmptyState";
import { FloorObjectInspector, FloorPlacementFields } from "./components/FloorObjectInspector";
import { OpeningInspector } from "./components/OpeningInspector";
import { PlanEmptyState } from "./components/PlanEmptyState";
import { PlanView } from "./components/PlanView";
import { TooltipProvider } from "./components/ui/tooltip";
import { ProjectPicker } from "./components/ProjectPicker";
import { RoomInspector } from "./components/RoomInspector";
import { RoomsPanel } from "./components/RoomsPanel";
import { SelectionInspector } from "./components/SelectionInspector";
import {
  WallPlacementFields,
  getWallPlacementNeighborEdges
} from "./components/WallPlacementFields";
import { WallInspector, type WallDimensionLink } from "./components/WallInspector";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Toggle } from "./components/ui/toggle";
import {
  useStoragePersistence,
  type StoragePersistenceState
} from "./hooks/useStoragePersistence";
import {
  useViewPreferences,
  LEFT_PANEL_MIN_WIDTH,
  LEFT_PANEL_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_MAX_WIDTH
} from "./hooks/useViewPreferences";
import {
  exportProjectJson,
  getProjectWalls,
  getSelectedWall,
  useAppStore
} from "./store";

const DataView = lazy(() =>
  import("./components/DataView").then((module) => ({ default: module.DataView }))
);
const ElevationView = lazy(() =>
  import("./components/ElevationView").then((module) => ({ default: module.ElevationView }))
);

// A second, independent IndexedDbAssetRepository instance dedicated to
// reads (thumbnail lookups for the checklist). It talks to the same
// IndexedDB database as the one store.ts constructs for writes — the
// repository is a stateless wrapper around the browser API, not something
// that needs a single shared instance — so this avoids exporting store.ts's
// internals just to hand a `getBlob` down to one panel. getBlob is declared
// at module scope (not inside the component) so it's a stable function
// reference across renders, which keeps useAssetImageUrls from refetching
// on every App re-render.
const assetRepository = new IndexedDbAssetRepository();
function getAssetBlob(key: string): Promise<Blob> {
  return assetRepository.getBlob(key);
}

export function App() {
  const {
    project,
    selectedWallId,
    selectedArtworkId,
    selectedOpeningId,
    selectedObjectIds,
    selectedRoomId,
    arrangeSession,
    lastArrangeMode,
    lastInsetAnchor,
    lastEvenZone,
    viewMode,
    saveState,
    error,
    placementWarnings,
    lastGeometryEdit,
    undoStack,
    redoStack,
    libraryArtworks,
    intakeState,
    boot,
    setViewMode,
    selectWall,
    selectArtwork,
    selectOpening,
    selectRoom,
    selectObject,
    setObjectSelection,
    clearObjectSelection,
    addRectangleRoom,
    renameProject,
    renameRoom,
    deleteRoom,
    setUnit,
    resizeSelectedWall,
    resizeWall,
    moveRoom,
    undo,
    redo,
    importProjectJson,
    listProjectSummaries,
    openProject,
    createProject,
    deleteProject,
    addArtworksFromFiles,
    removeArtworkFromChecklist,
    updateArtwork,
    placeArtwork,
    moveArtworkPlacement,
    removePlacement,
    addOpening,
    moveOpening,
    resizeOpening,
    placeOpeningFromPlan,
    placeArtworkOnFloor,
    commitPlanMove,
    updateFloorObject,
    moveWallObjectsGroup,
    movePlanObjectsGroup,
    removeSelectedPlacements,
    beginArrangeSession,
    setArrangeAnchor,
    setArrangeEvenZone,
    updateArrangeSession,
    setArrangeSessionPreview,
    commitArrangeSession,
    cancelArrangeSession
  } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draggingArtworkId, setDraggingArtworkId] = useState<string | null>(null);
  const {
    showGrid,
    snapToGrid,
    gridPrecisionFloorMm,
    allowOverlappingPlacement,
    leftPanel,
    leftPanelWidth,
    inspectorWidth,
    inspectorCollapsed,
    setLeftPanel,
    setLeftPanelWidth,
    setInspectorWidth,
    toggleInspectorCollapsed,
    toggleShowGrid,
    toggleSnapToGrid,
    setGridPrecisionFloorMm,
    toggleAllowOverlappingPlacement
  } = useViewPreferences();
  const storagePersistence = useStoragePersistence();

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
      } else if (key === "y") {
        event.preventDefault();
        void redo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  // Delete/Backspace removes whichever placement is currently selected — a
  // wall opening, a floor blocked zone (both live in the selectedOpeningId
  // slot, and removePlacement is generic over wall/floor ids so one call
  // covers either), or a placed artwork (selectedArtworkId resolved against
  // wallObjects/floorObjects). An unplaced checklist selection is left
  // alone — there's no placement id to remove. Guarded against editable
  // targets (LengthFields use Backspace for text editing) and an in-flight
  // checklist drag, the same idiom as the undo/redo effect above.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Escape first reverts a live arrange session (leaving the selection
      // intact so a second Escape can then clear it), then clears the multi-
      // selection (the single-selection slots have no clear-on-Escape
      // convention to preserve). PlanView's own Escape listener disarms an
      // armed placement tool; both firing together is harmless.
      if (event.key === "Escape") {
        if (isEditableTarget(event.target)) return;
        if (arrangeSession) {
          cancelArrangeSession();
          return;
        }
        if (selectedObjectIds.length > 0) clearObjectSelection();
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isEditableTarget(event.target)) return;
      if (draggingArtworkId) return;
      if (!project) return;

      // A multi-selection takes precedence over the legacy single slots —
      // one keypress removes every selected placement in one undo entry.
      if (selectedObjectIds.length > 0) {
        event.preventDefault();
        void removeSelectedPlacements();
        return;
      }

      if (selectedOpeningId) {
        event.preventDefault();
        void removePlacement(selectedOpeningId);
        return;
      }

      if (selectedArtworkId) {
        const placement =
          project.wallObjects.find(
            (wallObject): wallObject is ArtworkWallObject =>
              wallObject.kind === "artwork" && wallObject.artworkId === selectedArtworkId
          ) ??
          project.floorObjects.find(
            (floorObject): floorObject is ArtworkFloorObject =>
              floorObject.kind === "artwork" && floorObject.artworkId === selectedArtworkId
          );
        if (!placement) return;

        event.preventDefault();
        void removePlacement(placement.id);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    project,
    selectedArtworkId,
    selectedOpeningId,
    selectedObjectIds,
    draggingArtworkId,
    removePlacement,
    removeSelectedPlacements,
    clearObjectSelection,
    arrangeSession,
    cancelArrangeSession
  ]);

  // Arrange keyboard shortcuts, scoped to the elevation view: Enter commits a
  // live arrange session, and arrow keys nudge the whole selected group (a
  // series of nudges auto-opens one session so they commit as a single undo
  // entry). Both stay out of the way of text editing (isEditableTarget) and of
  // an in-flight checklist drag. Eligibility mirrors the arrange readout — 2+
  // wall objects, no floor member, all on one wall.
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

      event.preventDefault();

      // A single selected placement nudges directly, one store commit per press
      // (per-press undo entries — deliberately NOT an arrange session: its
      // guards need 2+ artwork members, and an invisible single-work session
      // would have no Apply/Cancel affordance). Artworks move via
      // moveArtworkPlacement, openings via moveOpening, matching the single-
      // object pointer-drag split — a lone opening still nudges here.
      if (selectedWallObjects.length === 1) {
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

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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

  const selectedWall = project ? getSelectedWall(project, selectedWallId) : null;
  const wallDimensionLink =
    project && selectedWall
      ? getWallDimensionLink(project, selectedWall.id)
      : null;
  const artworksById = useMemo(
    () => new Map(libraryArtworks.map((artwork) => [artwork.id, artwork])),
    [libraryArtworks]
  );

  // The flat wall inventory (room order) that feeds the elevation chip's wall
  // switcher — the navigation that used to live in the right-panel wall list.
  const wallsForSwitcher = useMemo(
    () =>
      project
        ? project.floor.rooms.flatMap((placement) =>
            getWallsWithGeometry(placement.room).map((wall) => ({
              id: wall.id,
              name: wall.name,
              roomName: placement.room.name
            }))
          )
        : [],
    [project]
  );

  if (!project) {
    return (
      <main className="loading-shell">
        <div className="skeleton-panel" />
      </main>
    );
  }

  // Scoped display units for read-only labels: a length reads in the unit
  // natural to what it measures (walls in ft/m) rather than one global unit.
  // The inspectors keep receiving project.unit and derive their own scopes.
  const unitSystem = unitSystemFromDisplayUnit(project.unit);
  const wallUnit = getScopeUnits(unitSystem, "wall").displayUnit;
  const selectedRoomPlacement = selectedRoomId
    ? (project.floor.rooms.find((placement) => placement.roomId === selectedRoomId) ?? null)
    : null;
  const selectedRoomDimensions = selectedRoomPlacement
    ? getRectangleRoomDimensions(selectedRoomPlacement.room)
    : null;
  const selectedRoomWallIds = new Set(
    selectedRoomPlacement?.room.walls.map((wall) => wall.id) ?? []
  );
  const selectedRoomBounds = selectedRoomPlacement
    ? getPlacedRoomBounds(selectedRoomPlacement)
    : null;
  const selectedRoomWallObjects = selectedRoomPlacement
    ? project.wallObjects.filter((wallObject) => selectedRoomWallIds.has(wallObject.wallId))
    : [];
  const selectedRoomFloorObjects = selectedRoomBounds
    ? project.floorObjects.filter(
        (floorObject) =>
          floorObject.xMm >= selectedRoomBounds.minX &&
          floorObject.xMm <= selectedRoomBounds.maxX &&
          floorObject.yMm >= selectedRoomBounds.minY &&
          floorObject.yMm <= selectedRoomBounds.maxY
      )
    : [];
  const selectedRoomObjectCount =
    selectedRoomWallObjects.length + selectedRoomFloorObjects.length;
  const selectedRoomArtworkCount =
    selectedRoomWallObjects.filter((wallObject) => wallObject.kind === "artwork").length +
    selectedRoomFloorObjects.filter((floorObject) => floorObject.kind === "artwork").length;

  // A dangling selectedArtworkId (library record deleted out from under the
  // project) resolves to nothing here, so the inspector falls back to the
  // wall view below rather than rendering a dead end.
  const selectedArtwork: Artwork | null =
    (selectedArtworkId ? artworksById.get(selectedArtworkId) : undefined) ?? null;
  const placedWallObject: ArtworkWallObject | null = selectedArtwork
    ? (project.wallObjects.find(
        (wallObject): wallObject is ArtworkWallObject =>
          wallObject.kind === "artwork" && wallObject.artworkId === selectedArtwork.id
      ) ?? null)
    : null;
  // An artwork placed on the floor (dragged off a wall, or dropped straight
  // onto open floor) — ids/artworkId survive wall↔floor conversion, so the
  // same selectedArtworkId resolves here when it isn't on a wall.
  const placedFloorArtwork: ArtworkFloorObject | null = selectedArtwork
    ? (project.floorObjects.find(
        (floorObject): floorObject is ArtworkFloorObject =>
          floorObject.kind === "artwork" && floorObject.artworkId === selectedArtwork.id
      ) ?? null)
    : null;
  const isArtworkPlaced = placedWallObject !== null || placedFloorArtwork !== null;
  // The placement to remove when the artwork inspector's action fires —
  // whichever surface it currently lives on.
  const artworkPlacementId = placedWallObject?.id ?? placedFloorArtwork?.id ?? null;

  // The wall a wall-placed work hangs on (for its "Position on wall" section's
  // length + header) and the nearest artwork neighbours on each side — both
  // derived here from the live project so the section stays purely
  // presentational. Neighbours are artwork-kind wall objects only; openings and
  // blocked zones are not "works".
  const placedWallObjectWall = placedWallObject
    ? (getProjectWalls(project).find((wall) => wall.id === placedWallObject.wallId) ?? null)
    : null;
  const wallPlacementNeighbors = placedWallObject
    ? getWallPlacementNeighborEdges(
        placedWallObject,
        project.wallObjects.filter(
          (wallObject): wallObject is ArtworkWallObject => wallObject.kind === "artwork"
        )
      )
    : { leftNeighborRightEdgeMm: undefined, rightNeighborLeftEdgeMm: undefined };

  // A dangling selectedOpeningId (the opening was just deleted) resolves to
  // nothing here too, the same fallback shape as selectedArtwork above.
  const selectedOpening: OpeningWallObject | null = selectedOpeningId
    ? (project.wallObjects.find(
        (wallObject): wallObject is OpeningWallObject =>
          wallObject.kind !== "artwork" && wallObject.id === selectedOpeningId
      ) ?? null)
    : null;
  // selectedOpeningId doubles as the slot for a floor-placed blocked zone
  // (no separate selection slot — ids are unique across both arrays), so a
  // selection that isn't a wall opening may resolve to a floor blocked zone.
  const selectedFloorBlockedZone: BlockedZoneFloorObject | null =
    selectedOpeningId && !selectedOpening
      ? (project.floorObjects.find(
          (floorObject): floorObject is BlockedZoneFloorObject =>
            floorObject.kind === "blocked-zone" && floorObject.id === selectedOpeningId
        ) ?? null)
      : null;

  // The multi-selection resolved against the live project — stale ids (undo/
  // redo or a document swap can orphan them) simply drop out here rather than
  // ever reaching an action. The arrange readout only exists when the whole
  // selection is 2+ wall objects on a single wall — the same guard the
  // arrange-session actions enforce, computed here so the inspector can show
  // the current spacing (or a hint) instead of failing on commit.
  const isMultiSelect = selectedObjectIds.length > 1;
  // Arranging operates on ARTWORKS only — a selected opening (door/window/
  // blocked zone) is architecture, never a member. So the readout, the panel's
  // eligibility, and the keyboard nudges all derive from artwork members;
  // openings in the selection are ignored rather than blocking arrangement.
  const selectedArtworkMembers = project.wallObjects.filter(
    (wallObject) =>
      wallObject.kind === "artwork" && selectedObjectIds.includes(wallObject.id)
  );
  const selectionHasFloorMember = project.floorObjects.some((floorObject) =>
    selectedObjectIds.includes(floorObject.id)
  );
  const arrangeWall =
    !selectionHasFloorMember &&
    selectedArtworkMembers.length >= 2 &&
    selectedArtworkMembers.every(
      (member) => member.wallId === selectedArtworkMembers[0]?.wallId
    )
      ? (getProjectWalls(project).find(
          (wall) => wall.id === selectedArtworkMembers[0]?.wallId
        ) ?? null)
      : null;
  // A live session ties itself to the current selection (the store auto-
  // accepts on any selection/view change), so its previewById describes these
  // very members — override their committed positions with it before reading
  // the layout back, so the panel and its Apply/Cancel reflect the preview.
  const activeArrangeSession =
    arrangeWall && arrangeSession && arrangeSession.wallId === arrangeWall.id
      ? arrangeSession
      : null;
  const arrangeMembers = activeArrangeSession
    ? selectedArtworkMembers.map((member) => {
        const preview = activeArrangeSession.previewById[member.id];
        return preview ? { ...member, xMm: preview.xMm, yMm: preview.yMm } : member;
      })
    : selectedArtworkMembers;
  const arrangeReadout = arrangeWall
    ? (() => {
        const detailed = getArrangeReadoutDetailed(
          arrangeMembers,
          arrangeWall.lengthMm
        );
        const equal = solveEqualArrangement(arrangeMembers, arrangeWall.lengthMm);
        // The open-space span the "Open space" zone spreads within. Live, use
        // the session's fixed bounds so previews don't move it; idle, derive it
        // from the committed members and the unselected same-wall objects (the
        // same "others" filter the session uses at begin).
        const openBounds = activeArrangeSession
          ? activeArrangeSession.openZoneBoundsMm
          : getOpenSpaceBounds(
              selectedArtworkMembers,
              project.wallObjects.filter(
                (wallObject) =>
                  wallObject.wallId === arrangeWall.id &&
                  !selectedObjectIds.includes(wallObject.id)
              ),
              arrangeWall.lengthMm
            );
        const equalOpen = solveEqualArrangementInZone(
          arrangeMembers,
          openBounds.startMm,
          openBounds.endMm
        );
        // The two single-sided distances the left/right anchors edit and read
        // back: getSpacingSegments returns n+1 segments with segment[0] the
        // left-edge distance and the last the right-edge distance — reuse it
        // rather than re-deriving edges here.
        const segments = getSpacingSegments(arrangeMembers, arrangeWall.lengthMm);
        const leftEdgeDistanceMm = segments[0].toMm - segments[0].fromMm;
        const lastSegment = segments[segments.length - 1];
        const rightEdgeDistanceMm = lastSegment.toMm - lastSegment.fromMm;
        // The anchor follows the session when one is open, else the remembered
        // default — the mirror of how `mode` resolves just below.
        const insetAnchor = activeArrangeSession
          ? activeArrangeSession.insetAnchor
          : lastInsetAnchor;
        // Does the idle layout already read as evenly spaced? Whole-wall equal
        // wants uniform gaps AND symmetric insets. Open-zone equal wants uniform
        // gaps and the leftmost left edge at (zone start + zone inset) — its
        // insets are asymmetric by design, so insetIsMixed is NOT required here.
        const matchesWholeWallEqual =
          !detailed.gapIsMixed &&
          !detailed.insetIsMixed &&
          Math.abs(detailed.insetMm - equal.insetMm) < 0.5 &&
          Math.abs(detailed.gapMm - equal.gapMm) < 0.5;
        const matchesOpenZoneEqual =
          !detailed.gapIsMixed &&
          Math.abs(detailed.insetMm - (openBounds.startMm + equalOpen.insetMm)) < 0.5 &&
          Math.abs(detailed.gapMm - equalOpen.gapMm) < 0.5;
        // Which zone (if either) the idle layout matches — whole wall wins ties
        // (the unbounded case, where the two solves are identical).
        const idleEqualZone: "wall" | "open" | null = matchesWholeWallEqual
          ? "wall"
          : matchesOpenZoneEqual
            ? "open"
            : null;
        // The smart default used when nothing has been chosen and no layout
        // matches: open when the group is boxed in by neighbours, else whole
        // wall — the same rule beginArrangeSession applies.
        const smartDefaultZone: "wall" | "open" =
          openBounds.startMm > 0 || openBounds.endMm < arrangeWall.lengthMm
            ? "open"
            : "wall";
        // The panel always shows an active mode — never a blank "choose one"
        // state. With a session open the segment follows the session's mode;
        // idle, a freeform layout reads as "Space evenly" when it matches either
        // the whole-wall or the open-zone equal solve; otherwise it falls back
        // to the last mode the curator used (default "From wall edges"). Showing
        // a mode idle never moves anything — inset/gap seed their field from the
        // current layout readout, and only an edit begins a session.
        const mode: "equal" | "inset" | "gap" = activeArrangeSession
          ? activeArrangeSession.mode
          : idleEqualZone !== null
            ? "equal"
            : lastArrangeMode;
        // Displayed zone: the session's when active, else the idle-matched zone,
        // else the remembered choice or the smart default.
        const evenZone: "wall" | "open" = activeArrangeSession
          ? activeArrangeSession.evenZone
          : idleEqualZone ?? lastEvenZone ?? smartDefaultZone;
        return {
          mode,
          insetAnchor,
          evenZone,
          insetMm: detailed.insetMm,
          gapMm: detailed.gapMm,
          leftEdgeDistanceMm,
          rightEdgeDistanceMm,
          insetIsMixed: detailed.insetIsMixed,
          gapIsMixed: detailed.gapIsMixed,
          // The "Equal distance" readout reflects the displayed zone.
          equalSpacingMm: evenZone === "open" ? equalOpen.insetMm : equal.insetMm,
          sessionActive: activeArrangeSession !== null
        };
      })()
    : null;

  // Why the arrange panel is disabled, named specifically — the static "select
  // two objects" line read as nonsense to a user who already had three objects
  // selected but only one work among them. Branch order mirrors the arrangeWall
  // guard above (floor members block first, then the works count, then the
  // single-wall rule) so the hint always names the actual blocker.
  const arrangeDisabledReason = selectionHasFloorMember
    ? "Arranging is for works hung on a wall — this selection includes floor-placed objects."
    : selectedArtworkMembers.length === 0
      ? "Arranging is for works only — doors, windows, and blocked zones stay where they are."
      : selectedArtworkMembers.length === 1
        ? "Arranging is for works only — select at least two works on the same wall to arrange them."
        : "Select works on a single wall to arrange them — this selection spans more than one wall.";
  // When the selection IS arrangeable but also contains openings, arranging
  // silently ignores them (see selectedArtworkMembers above) — surface that
  // explicitly rather than let the curator wonder why a door didn't move.
  const arrangeIgnoredNote =
    arrangeWall && selectedObjectIds.length > selectedArtworkMembers.length
      ? "Only the works are arranged — doors, windows, and blocked zones stay put."
      : undefined;

  // Warnings carry a wallObjectId, but a raw id means nothing to a curator —
  // resolve it to the artwork's title, or the opening's human-readable kind
  // label ("Door"/"Window"/"Blocked zone", never a raw `kind` string), for
  // display.
  const labeledPlacementWarnings = placementWarnings.map((warning) => {
    const wallObject = project.wallObjects.find(
      (candidate) => candidate.id === warning.wallObjectId
    );
    const subject =
      wallObject?.kind === "artwork"
        ? (artworksById.get(wallObject.artworkId)?.title ?? "Untitled artwork")
        : wallObject
          ? getOpeningKindLabel(wallObject.kind)
          : undefined;
    return { ...warning, subject };
  });

  // The rail's Issues button jumps to the first warning's wall object so the
  // inspector reveals it — an artwork placement selects its artwork, any
  // other kind (door/window/blocked zone) selects the opening.
  const selectFirstWarningObject = () => {
    const first = placementWarnings[0];
    if (!first) return;

    const wallObject = project.wallObjects.find(
      (candidate) => candidate.id === first.wallObjectId
    );
    if (!wallObject) return;

    if (wallObject.kind === "artwork") {
      selectArtwork(wallObject.artworkId);
    } else {
      selectOpening(wallObject.id);
    }
  };

  // Rail toggle semantic: clicking the active panel's icon collapses the
  // column (null), clicking the other switches to it.
  const selectLeftPanel = (panel: "checklist" | "rooms") =>
    setLeftPanel(leftPanel === panel ? null : panel);

  // Whether the inspector currently has anything to show — a resolved single
  // subject, a multi-selection, or a placement warning. Drives the contextual
  // "reopen inspector" tab that surfaces only when the panel is collapsed AND
  // there's something in it worth reopening for (a bare rail toggle is always
  // available, but this makes the hidden content discoverable in the moment).
  const hasInspectorContent =
    isMultiSelect ||
    selectedArtwork !== null ||
    selectedOpening !== null ||
    selectedFloorBlockedZone !== null ||
    selectedRoomPlacement !== null ||
    selectedWall !== null ||
    labeledPlacementWarnings.length > 0;

  // The grid tracks are driven by CSS custom properties (see .workspace in
  // global.css) rather than an inline grid-template-columns, so the narrow-
  // viewport media query can still override to a single stacked column — an
  // inline template would win over the stylesheet and defeat requirement 7.
  const workspaceStyle = {
    "--left-panel-width": `${leftPanelWidth}px`,
    "--inspector-width": `${inspectorWidth}px`
  } as React.CSSProperties;
  const workspaceClassName = [
    "workspace",
    leftPanel ? null : "left-collapsed",
    inspectorCollapsed ? "right-collapsed" : null
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // One provider for every hover tooltip in the app (plan/elevation
    // placements), so they share a single warm-up delay and skip-delay window.
    <TooltipProvider delayDuration={400}>
    <main className="app-shell">
      <AppRail
        leftPanel={leftPanel}
        onSelectLeftPanel={selectLeftPanel}
        inspectorCollapsed={inspectorCollapsed}
        onToggleInspector={toggleInspectorCollapsed}
        isDataView={viewMode === "data"}
        onOpenDataView={() => setViewMode("data")}
        issueCount={placementWarnings.length}
        onSelectFirstIssue={selectFirstWarningObject}
      />
      <div className="app-main">
      <header className="topbar">
        <div className="topbar-left">
          <p className="app-name">Sightlines</p>
          <div className="brand-divider" aria-hidden="true" />
          <div className="project-switcher">
            <ProjectTitleInput title={project.title} onCommit={renameProject} />
            <ProjectPicker
              currentProjectId={project.id}
              listProjectSummaries={listProjectSummaries}
              onCreateProject={createProject}
              onDeleteProject={deleteProject}
              onOpenProject={openProject}
            />
          </div>
        </div>

        <Tabs
          className="view-tabs topbar-center"
          value={viewMode}
          onValueChange={(value) => {
            if (value === "plan" || value === "elevation") setViewMode(value);
          }}
        >
          <TabsList aria-label="Workspace view" className="view-tabs">
            <TabsTrigger className="tab-button" value="plan">
              <MapTrifoldIcon aria-hidden="true" size={16} />
              <span>Plan</span>
            </TabsTrigger>
            <TabsTrigger className="tab-button" value="elevation">
              <PresentationIcon aria-hidden="true" size={16} />
              <span>Elevation</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="topbar-right" aria-label="Project actions">
          <StatusBadge state={saveState} />
          <div className="toolbar-group">
            <Button
              className="icon-button"
              title="Undo"
              aria-label="Undo"
              disabled={undoStack.length === 0}
              size="icon"
              variant="ghost"
              onClick={() => void undo()}
            >
              <ArrowCounterClockwiseIcon aria-hidden="true" size={18} />
            </Button>
            <Button
              className="icon-button"
              title="Redo"
              aria-label="Redo"
              disabled={redoStack.length === 0}
              size="icon"
              variant="ghost"
              onClick={() => void redo()}
            >
              <ArrowClockwiseIcon aria-hidden="true" size={18} />
            </Button>
          </div>
          <div className="toolbar-divider" aria-hidden="true" />
          <Button
            className="icon-button"
            title="Import project JSON"
            aria-label="Import project JSON"
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadSimpleIcon aria-hidden="true" size={18} />
          </Button>
          <Button
            className="topbar-button"
            title="Export project JSON"
            aria-label="Export project JSON"
            size="default"
            variant="outline"
            onClick={() => downloadProject(project)}
          >
            <DownloadSimpleIcon aria-hidden="true" size={18} />
            <span>Export</span>
          </Button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then(importProjectJson);
              event.target.value = "";
            }}
          />
        </div>
      </header>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className={workspaceClassName} style={workspaceStyle}>
        {leftPanel ? (
          <PanelResizeHandle
            side="left"
            width={leftPanelWidth}
            min={LEFT_PANEL_MIN_WIDTH}
            max={LEFT_PANEL_MAX_WIDTH}
            label="Resize left panel"
            onResize={setLeftPanelWidth}
          />
        ) : null}
        {!inspectorCollapsed ? (
          <PanelResizeHandle
            side="right"
            width={inspectorWidth}
            min={INSPECTOR_MIN_WIDTH}
            max={INSPECTOR_MAX_WIDTH}
            label="Resize inspector"
            onResize={setInspectorWidth}
          />
        ) : null}
        {inspectorCollapsed && hasInspectorContent ? (
          <button
            type="button"
            className="inspector-reopen"
            title="Show inspector"
            aria-label="Show inspector"
            onClick={toggleInspectorCollapsed}
          >
            <CaretLeftIcon aria-hidden="true" size={16} />
          </button>
        ) : null}
        {leftPanel === "checklist" ? (
          <ChecklistPanel
            getBlob={getAssetBlob}
            intakeState={intakeState}
            libraryArtworks={libraryArtworks}
            project={project}
            selectedArtworkId={selectedArtworkId}
            onAddArtworksFromFiles={addArtworksFromFiles}
            onArtworkDragStateChange={setDraggingArtworkId}
            onRemoveArtworkFromChecklist={removeArtworkFromChecklist}
            onRemovePlacement={removePlacement}
            onSelectArtwork={selectArtwork}
          />
        ) : leftPanel === "rooms" ? (
          <RoomsPanel
            project={project}
            selectedWallId={selectedWall?.id ?? null}
            onAddRectangleRoom={() => void addRectangleRoom()}
            onDeleteRoom={deleteRoom}
            onRenameRoom={renameRoom}
            onResizeWall={resizeWall}
            onSelectWall={selectWall}
          />
        ) : null}

        <section className="canvas-column">
          <div className="view-toolbar">
            <div className="view-options" aria-label="View options">
              <ViewOptionButton
                active={showGrid}
                disabled={viewMode === "data"}
                icon={<GridFourIcon aria-hidden="true" size={16} />}
                label="Grid"
                title={showGrid ? "Hide grid" : "Show grid"}
                onClick={toggleShowGrid}
              />
              <ViewOptionButton
                active={snapToGrid}
                disabled={viewMode === "data"}
                icon={<MagnetIcon aria-hidden="true" size={16} />}
                label="Snap"
                title={snapToGrid ? "Disable snap to grid" : "Enable snap to grid"}
                onClick={toggleSnapToGrid}
              />
              <PrecisionSelect
                disabled={viewMode === "data"}
                floorMm={gridPrecisionFloorMm}
                unit={project.unit}
                onChange={setGridPrecisionFloorMm}
              />
              {viewMode === "elevation" ? (
                <ViewOptionButton
                  active={allowOverlappingPlacement}
                  disabled={false}
                  icon={<StackIcon aria-hidden="true" size={16} />}
                  label="Overlap"
                  title={
                    allowOverlappingPlacement
                      ? "Prevent overlapping placement"
                      : "Allow overlapping placement"
                  }
                  onClick={toggleAllowOverlappingPlacement}
                />
              ) : null}
              <UnitSystemToggle
                disabled={viewMode === "data"}
                system={unitSystem}
                onChange={(system) => setUnit(displayUnitForSystem(system))}
              />
            </div>
          </div>

          {viewMode === "plan" ? (
            project.floor.rooms.length === 0 ? (
              <PlanEmptyState onAddRoom={() => void addRectangleRoom()} />
            ) : (
              <PlanView
                artworksById={artworksById}
                draggingArtworkId={draggingArtworkId}
                getBlob={getAssetBlob}
                gridPrecisionFloorMm={gridPrecisionFloorMm}
                gridVisible={showGrid}
                project={project}
                selectedArtworkId={selectedArtworkId}
                selectedOpeningId={selectedOpeningId}
                selectedRoomId={selectedRoomId}
                selectedWallId={selectedWall?.id ?? null}
                snapToGrid={snapToGrid}
                onCommitPlanMove={(objectId, placement) =>
                  void commitPlanMove(objectId, placement, allowOverlappingPlacement)
                }
                onCommitWallLength={resizeWall}
                onMoveRoom={moveRoom}
                onPlaceArtwork={(artworkId, wallId, xMm, yMm) =>
                  void placeArtwork(artworkId, wallId, xMm, yMm, allowOverlappingPlacement)
                }
                onPlaceArtworkOnFloor={(artworkId, xMm, yMm) =>
                  void placeArtworkOnFloor(artworkId, xMm, yMm)
                }
                onPlaceOpeningFromPlan={placeOpeningFromPlan}
                onSelectArtwork={selectArtwork}
                onSelectOpening={selectOpening}
                onSelectRoom={selectRoom}
                onSelectWall={selectWall}
                selectedObjectIds={selectedObjectIds}
                onSelectObject={selectObject}
                onClearSelection={clearObjectSelection}
                onCommitPlanMoveGroup={(moves) =>
                  void movePlanObjectsGroup(moves, allowOverlappingPlacement)
                }
                onMarqueeSelect={(ids, additive) =>
                  // An additive (shift) marquee extends the selection; a plain
                  // one replaces it. The union preserves already-selected ids'
                  // order so repeated shift-marquees stay stable.
                  setObjectSelection(
                    additive ? [...new Set([...selectedObjectIds, ...ids])] : ids
                  )
                }
              />
            )
          ) : null}
          {viewMode === "elevation" ? (
            selectedWall ? (
              <Suspense fallback={<div className="skeleton-panel" />}>
                <ElevationView
                  artworksById={artworksById}
                  centerlineMm={
                    selectedWall.defaultCenterlineHeightMm ??
                    project.defaultCenterlineHeightMm
                  }
                  draggingArtworkId={draggingArtworkId}
                  getBlob={getAssetBlob}
                  gridPrecisionFloorMm={gridPrecisionFloorMm}
                  gridVisible={showGrid}
                  selectedArtworkId={selectedArtworkId}
                  selectedOpeningId={selectedOpeningId}
                  snapToGrid={snapToGrid}
                  unit={wallUnit}
                  wallHeightMm={selectedWall.heightMm}
                  wallId={selectedWall.id}
                  wallLengthMm={selectedWall.lengthMm}
                  wallName={selectedWall.name}
                  wallObjects={project.wallObjects}
                  walls={wallsForSwitcher}
                  onSelectWall={selectWall}
                  previewPositionsById={arrangeSession?.previewById}
                  arrangeSessionActive={arrangeSession !== null}
                  onMoveOpening={(wallObjectId, xMm, yMm) => {
                    // A move of a session member (alt-drag of one work in the
                    // group) stays inside the live preview — the session's
                    // single commit will carry it; everything else commits
                    // directly as before.
                    if (arrangeSession?.memberIds.includes(wallObjectId)) {
                      setArrangeSessionPreview([{ id: wallObjectId, xMm, yMm }]);
                      return;
                    }
                    void moveOpening(wallObjectId, xMm, yMm, allowOverlappingPlacement);
                  }}
                  onMovePlacement={(wallObjectId, xMm, yMm) => {
                    if (arrangeSession?.memberIds.includes(wallObjectId)) {
                      setArrangeSessionPreview([{ id: wallObjectId, xMm, yMm }]);
                      return;
                    }
                    void moveArtworkPlacement(wallObjectId, xMm, yMm, allowOverlappingPlacement);
                  }}
                  onPlaceArtwork={(artworkId, wallId, xMm, yMm) =>
                    void placeArtwork(artworkId, wallId, xMm, yMm, allowOverlappingPlacement)
                  }
                  onSelectArtwork={selectArtwork}
                  onSelectOpening={selectOpening}
                  selectedObjectIds={selectedObjectIds}
                  onSelectObject={selectObject}
                  onClearSelection={clearObjectSelection}
                  onMoveWallObjects={(moves) => {
                    // With a session open, a group drag becomes more live
                    // preview (one undo entry on session commit); without one
                    // it keeps committing directly as "Move N objects".
                    if (arrangeSession) {
                      setArrangeSessionPreview(moves);
                      return;
                    }
                    void moveWallObjectsGroup(moves, allowOverlappingPlacement);
                  }}
                  onMarqueeSelect={(ids, additive) =>
                    // An additive (shift) marquee extends the selection; a plain
                    // one replaces it. The union preserves already-selected ids'
                    // order so repeated shift-marquees stay stable.
                    setObjectSelection(
                      additive ? [...new Set([...selectedObjectIds, ...ids])] : ids
                    )
                  }
                />
              </Suspense>
            ) : (
              <ElevationEmptyState hasRooms={project.floor.rooms.length > 0} />
            )
          ) : null}
          {viewMode === "data" ? (
            <Suspense fallback={<div className="skeleton-panel" />}>
              <DataView json={exportProjectJson(project)} />
            </Suspense>
          ) : null}
        </section>

        {!inspectorCollapsed ? (
        <aside className="inspector" aria-label="Inspector">
          <div className="inspector-zone">
            {labeledPlacementWarnings.length > 0 ? (
              <div className="warning-panel" role="status" aria-live="polite">
                <WarningIcon aria-hidden="true" size={18} />
                <div>
                  <h3>Placement needs review</h3>
                  <ul>
                    {labeledPlacementWarnings.map((warning) => (
                      <li key={warning.id}>
                        {warning.message}
                        {warning.subject ? <span>{warning.subject}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {!isMultiSelect &&
            (selectedArtwork ||
              selectedOpening ||
              selectedFloorBlockedZone ||
              selectedRoomPlacement ||
              selectedWall) ? (
              <div className="panel-heading inspector-subject">
                <h2>
                  {selectedArtwork
                    ? selectedArtwork.title ?? "Untitled"
                    : selectedOpening
                      ? getOpeningKindLabel(selectedOpening.kind)
                      : selectedFloorBlockedZone
                        ? getOpeningKindLabel(selectedFloorBlockedZone.kind)
                        : selectedRoomPlacement
                          ? selectedRoomPlacement.room.name
                          : selectedWall?.name}
                </h2>
                <span>
                  {selectedArtwork
                    ? "Artwork"
                    : selectedOpening
                      ? "Opening"
                      : selectedFloorBlockedZone
                        ? "Floor object"
                        : selectedRoomPlacement
                          ? "Room"
                          : "Wall"}
                </span>
              </div>
            ) : null}

            {isMultiSelect ? (
              // A multi-selection replaces the whole single-subject chain —
              // the legacy inspector slots are already null (the store clears
              // them whenever more than one object is selected), so nothing
              // below could render meaningfully anyway.
              <SelectionInspector
                arrange={arrangeReadout}
                arrangeDisabledReason={arrangeDisabledReason}
                arrangeIgnoredNote={arrangeIgnoredNote}
                count={selectedObjectIds.length}
                unit={project.unit}
                wallName={arrangeWall?.name ?? null}
                onSetMode={(mode) => {
                  // A "Space evenly" click both opens the session and snaps to
                  // the equal solution; switching to "From wall edges"/"Between
                  // works" opens the session but moves nothing until a value is
                  // typed (a bare mode switch must never jump the works).
                  beginArrangeSession(mode);
                  if (mode === "equal") updateArrangeSession({ equal: true });
                }}
                onSetAnchor={setArrangeAnchor}
                onSetEvenZone={setArrangeEvenZone}
                onArrangeValue={(params) => {
                  if (!arrangeSession) {
                    beginArrangeSession("insetMm" in params ? "inset" : "gap");
                  }
                  updateArrangeSession(params);
                }}
                onAcceptArrange={() =>
                  commitArrangeSession(allowOverlappingPlacement)
                }
                onCancelArrange={cancelArrangeSession}
                onRemoveAll={() => void removeSelectedPlacements()}
              />
            ) : selectedArtwork ? (
              <>
                <ArtworkInspector
                  artwork={selectedArtwork}
                  isPlaced={isArtworkPlaced}
                  unit={project.unit}
                  onCommitDimensions={(dimensions) =>
                    void updateArtwork(selectedArtwork.id, { dimensions })
                  }
                  onCommitField={(changes) => void updateArtwork(selectedArtwork.id, changes)}
                  onRemovePlacement={
                    artworkPlacementId
                      ? () => void removePlacement(artworkPlacementId)
                      : undefined
                  }
                />
                {placedWallObject && placedWallObjectWall ? (
                  <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
                    <WallPlacementFields
                      placement={placedWallObject}
                      wallLengthMm={placedWallObjectWall.lengthMm}
                      wallName={placedWallObjectWall.name}
                      leftNeighborRightEdgeMm={wallPlacementNeighbors.leftNeighborRightEdgeMm}
                      rightNeighborLeftEdgeMm={wallPlacementNeighbors.rightNeighborLeftEdgeMm}
                      unit={project.unit}
                      onCommit={(xMm, yMm) =>
                        void moveArtworkPlacement(
                          placedWallObject.id,
                          xMm,
                          yMm,
                          allowOverlappingPlacement
                        )
                      }
                    />
                  </form>
                ) : null}
                {placedFloorArtwork ? (
                  <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
                    <p className="field-hint">Floor-placed in plan view.</p>
                    <FloorPlacementFields
                      floorObject={placedFloorArtwork}
                      unit={project.unit}
                      onCommitPosition={(xMm, yMm) =>
                        void updateFloorObject(placedFloorArtwork.id, { xMm, yMm })
                      }
                      onCommitSize={(widthMm, depthMm) =>
                        void updateFloorObject(placedFloorArtwork.id, { widthMm, depthMm })
                      }
                    />
                  </form>
                ) : null}
              </>
          ) : selectedFloorBlockedZone ? (
            <FloorObjectInspector
              floorObject={selectedFloorBlockedZone}
              unit={project.unit}
              onCommitPosition={(xMm, yMm) =>
                void updateFloorObject(selectedFloorBlockedZone.id, { xMm, yMm })
              }
              onCommitSize={(widthMm, depthMm) =>
                void updateFloorObject(selectedFloorBlockedZone.id, { widthMm, depthMm })
              }
              onDelete={() => void removePlacement(selectedFloorBlockedZone.id)}
            />
          ) : selectedOpening ? (
            <OpeningInspector
              opening={selectedOpening}
              unit={project.unit}
              onCommitPosition={(xMm, yMm) =>
                void moveOpening(selectedOpening.id, xMm, yMm, allowOverlappingPlacement)
              }
              onCommitSize={(widthMm, heightMm) =>
                void resizeOpening(selectedOpening.id, widthMm, heightMm, allowOverlappingPlacement)
              }
              onDelete={() => void removePlacement(selectedOpening.id)}
            />
          ) : selectedRoomPlacement ? (
            <RoomInspector
              artworkCount={selectedRoomArtworkCount}
              objectCount={selectedRoomObjectCount}
              rectangleDimensions={selectedRoomDimensions}
              roomHeightMm={selectedRoomPlacement.room.heightMm}
              roomName={selectedRoomPlacement.room.name}
              unit={project.unit}
              wallCount={selectedRoomPlacement.room.walls.length}
              onCommitWidth={(lengthMm) =>
                selectedRoomDimensions
                  ? resizeWall(selectedRoomDimensions.widthWallId, lengthMm)
                  : Promise.resolve()
              }
              onCommitDepth={(lengthMm) =>
                selectedRoomDimensions
                  ? resizeWall(selectedRoomDimensions.depthWallId, lengthMm)
                  : Promise.resolve()
              }
            />
          ) : selectedWall ? (
            <WallInspector
              centerlineMm={project.defaultCenterlineHeightMm}
              changedWallNames={getWallNames(
                project,
                lastGeometryEdit?.changedWallIds ?? []
              )}
              dimensionLink={wallDimensionLink}
              lastGeometryEdit={lastGeometryEdit}
              onAddOpening={(kind) => void addOpening(selectedWall.id, kind)}
              onCommitLength={resizeSelectedWall}
              unit={project.unit}
              wallHeightMm={selectedWall.heightMm}
              wallLengthMm={selectedWall.lengthMm}
              wallName={selectedWall.name}
            />
            ) : (
              <p className="empty-copy">
                Select a room, wall, artwork, or opening to inspect it.
              </p>
            )}
          </div>

          <div className="storage-note">
            <FloppyDiskIcon aria-hidden="true" size={16} />
            <span>{getStorageNoteCopy(storagePersistence)}</span>
          </div>
        </aside>
        ) : null}
      </section>
      </div>
    </main>
    </TooltipProvider>
  );
}

function ProjectTitleInput({
  title,
  onCommit
}: {
  title: string;
  onCommit: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState(title);

  useEffect(() => {
    setValue(title);
  }, [title]);

  const commit = () => {
    if (value.trim().length === 0) {
      setValue(title);
      return;
    }

    void onCommit(value);
  };

  return (
    <Input
      className="project-title"
      value={value}
      aria-label="Project title"
      size="title"
      // Sized to the text so the picker chevron sits right beside the title
      // instead of at the far end of a fixed-width field. The CSS clamp
      // still bounds it on both ends.
      style={{ width: `${Math.max(value.length, 8) + 2}ch` }}
      variant="title"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
    />
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

function ViewOptionButton({
  active,
  disabled,
  icon,
  label,
  title,
  onClick
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <Toggle
      aria-label={label}
      className="view-option-button"
      disabled={disabled}
      pressed={active}
      title={title}
      variant="default"
      onPressedChange={onClick}
    >
      {icon}
      <span>{label}</span>
    </Toggle>
  );
}

function UnitSystemToggle({
  disabled,
  system,
  onChange
}: {
  disabled: boolean;
  system: UnitSystem;
  onChange: (system: UnitSystem) => void;
}) {
  // Re-clicking the already-active side is a no-op: it must never fire
  // onChange, or a legacy project stored as "in"/"cm" would get rewritten to
  // "ft"/"m" and land a redundant entry on the undo stack.
  const select = (next: UnitSystem) => {
    if (next === system) return;
    onChange(next);
  };

  // A traditional slide switch with the two unit systems as flanking words —
  // one small track, no label-inside-track nesting. The words are pointer
  // shortcuts to a specific side (routed through select(), so clicking the
  // already-active side stays inert); the switch itself is the single
  // accessible control, so the words stay out of the tab order and the
  // accessibility tree rather than announcing as three separate controls.
  return (
    <div className="unit-switch" role="group" aria-label="Units">
      <button
        aria-hidden="true"
        className="unit-switch-side"
        data-active={system === "imperial"}
        disabled={disabled}
        tabIndex={-1}
        type="button"
        onClick={() => select("imperial")}
      >
        Imperial
      </button>
      <Switch
        aria-labelledby="unit-system-label unit-system-value"
        checked={system === "metric"}
        className="unit-switch-control"
        disabled={disabled}
        onCheckedChange={(checked) => select(checked ? "metric" : "imperial")}
      >
        <span className="visually-hidden" id="unit-system-label">
          Units
        </span>
        <span className="visually-hidden" id="unit-system-value">
          {system === "metric" ? "Metric" : "Imperial"}
        </span>
      </Switch>
      <button
        aria-hidden="true"
        className="unit-switch-side"
        data-active={system === "metric"}
        disabled={disabled}
        tabIndex={-1}
        type="button"
        onClick={() => select("metric")}
      >
        Metric
      </button>
    </div>
  );
}

function PrecisionSelect({
  disabled,
  floorMm,
  unit,
  onChange
}: {
  disabled: boolean;
  floorMm: number | null;
  unit: DisplayUnit;
  onChange: (floorMm: number | null) => void;
}) {
  // Options are a curated subset of the active unit family's own grid
  // interval table (domain/units/precision.ts), so a floor picked here is
  // guaranteed to line up with an actual grid step rather than an arbitrary
  // value. Always formatted with the family's "natural" unit (feet-and-
  // inches for imperial, cm for metric) regardless of the project's current
  // display unit, since the stored value is mm and clamps to the nearest
  // table entry if the project unit later changes.
  const labelUnit: DisplayUnit = unit === "cm" || unit === "m" ? "cm" : "ft";
  const options = getGridPrecisionFloorOptionsMm(unit);

  return (
    <div className="unit-select">
      <span className="unit-select-label">Precision</span>
      <Select
        disabled={disabled}
        value={floorMm === null ? "auto" : String(floorMm)}
        onValueChange={(value) =>
          onChange(value === "auto" ? null : Number(value))
        }
      >
        <SelectTrigger className="precision-select-trigger" aria-label="Grid precision">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Auto</SelectItem>
        {options.map((optionMm) => (
          <SelectItem key={optionMm} value={String(optionMm)}>
            {formatLength(optionMm, { unit: labelUnit })}
          </SelectItem>
        ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StatusBadge({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  const label =
    state === "saving"
      ? "Saving"
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? "Save issue"
          : "Idle";

  return (
    <span className={`status-badge ${state}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

// "granted" covers both an already-durable store and a fresh grant this
// session; either way the browser has committed not to evict it under
// storage pressure, so the note can say so instead of just nudging toward
// a backup. "pending" (the check hasn't resolved yet) keeps the original
// neutral copy rather than flashing a stronger warning that may immediately
// flip to reassurance.
function getStorageNoteCopy(state: StoragePersistenceState): string {
  if (state === "granted") {
    return "Saved locally in this browser with durable storage — the browser won't clear it under storage pressure. Export a backup for long-term safekeeping.";
  }

  if (state === "denied" || state === "unsupported") {
    return "Saved locally in this browser, which may clear it under storage pressure. Export a backup regularly for long-term safekeeping.";
  }

  return "Saved locally in this browser. Export a backup for long-term safekeeping.";
}

function getWallDimensionLink(
  project: Project,
  wallId: string
): WallDimensionLink | null {
  for (const placement of project.floor.rooms) {
    const pair = getOrthogonalQuadWallPair(placement.room, wallId);
    if (!pair) continue;

    return {
      pairedWallName: pair.pairedWall.name,
      roomName: placement.room.name
    };
  }

  return null;
}

function getWallNames(project: Project, wallIds: string[]): string[] {
  if (wallIds.length === 0) return [];

  const namesById = new Map(
    project.floor.rooms.flatMap((placement) =>
      placement.room.walls.map((wall) => [wall.id, wall.name])
    )
  );

  return wallIds.map((wallId) => namesById.get(wallId) ?? wallId);
}

function downloadProject(project: Project) {
  const blob = new Blob([exportProjectJson(project)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
