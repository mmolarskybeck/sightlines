import { useMemo } from "react";
import {
  getPlacedRoomBounds,
  getRectangleRoomDimensions,
} from "../../../domain/geometry/walls";
import { getPlaceableFloorWalls } from "../../../domain/geometry/planObjects";
import {
  effectivePlacementForm,
  type PlacementForm
} from "../../../domain/placement/artworkForm";
import {
  getSharedOpeningStatus,
  sharedOpeningResolutions
} from "../../../domain/geometry/sharedOpeningStatus";
import { getOpeningKindLabel } from "../../../domain/placement/createOpening";
import { derivePartitionNeighborShimsForFloorWall } from "../../../domain/placement/partitionNeighbors";
import { getShelfRiders } from "../../../domain/placement/shelfRiders";
import { withArtworkFootprintFromMap } from "../../../domain/framing";
import type {
  Artwork,
  ArtworkFloorObject,
  ArtworkWallObject,
  BlockedZoneFloorObject,
  CaseFloorObject,
  CaseWallObject,
  DisplayUnit,
  FreestandingWall,
  OpeningWallObject,
  ShelfWallObject,
  WallTextWallObject
} from "../../../domain/project";
import { shelfCenterYMmForTop } from "../../../domain/geometry/shelfGlyphs";
import { faceWallId, parseFaceWallId } from "../../../domain/geometry/freestandingWalls";
import { getPartitionClearances } from "../../../domain/geometry/partitionSpacing";
import { isMonitorArtwork } from "../../../domain/geometry/monitorGlyphs";
import { resolveFloorSupport } from "../../../domain/geometry/supportGlyphs";
import { COMPASS_WALL_NAMES } from "../../../domain/geometry/createRoom";
import { ArtworkInspector } from "./ArtworkInspector";
import {
  PlacementWarnings,
  type LabeledDocumentIssue
} from "../placement/PlacementWarnings";
import {
  describeSharedConnection,
  describeSharedOpeningConflict,
  describeSharedOpeningDrift,
  describeSharedOpeningTarget
} from "../placement/sharedOpeningIssueCopy";
import { FloorCaseInspector, WallCaseInspector } from "./CaseInspector";
import { ShelfInspector } from "./ShelfInspector";
import { ShelfGlyph } from "../toolbar/toolbarGlyphs";
import { Button } from "../ui/button";
import { FloorObjectInspector, FloorPlacementFields } from "./FloorObjectInspector";
import { FloorArtworkImageFacesField } from "./FloorArtworkImageFacesField";
import { StandsOnField } from "./StandsOnField";
import { FloorSupportFields } from "./FloorSupportFields";
import { FloorArtworkImageSizeNote } from "./FloorArtworkImageSizeNote";
import { FreestandingWallInspector } from "./FreestandingWallInspector";
import {
  OpeningInspector,
  type OpeningSharedSection
} from "./OpeningInspector";
import { RoomInspector } from "./RoomInspector";
import { SelectionInspector } from "./SelectionInspector";
import { MeasurementInspector, ReferenceMeasurementInspector } from "./MeasurementInspector";
import {
  WallPlacementFields,
  getWallPlacementCenterTarget,
  getWallPlacementNeighborEdges
} from "./WallPlacementFields";
import { InspectorSummaryRow } from "./InspectorSummaryRow";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { WallInspector } from "./WallInspector";
import { WallTextInspector } from "./WallTextInspector";
import { useArtworksById } from "../../hooks/useArtworksById";
import type { useDialogs } from "../../hooks/useDialogs";
import type { useMeasurementTool } from "../../hooks/useMeasurementTool";
import { deriveArrangeReadout } from "../../hooks/arrangeReadout";
import {
  freestandingWallIdOf,
  getProjectWalls,
  getSelectedArtworkId,
  getSelectedOpeningId,
  getSelectedWallTextId,
  objectIdsOf,
  roomIdOf,
  useAppStore
} from "../../store";
import { getSelectedWall, getWallDimensionLink, getWallNames } from "../../projectWalls";
import { getArrangeEligibility } from "../../store/arrangeEligibility";

type InspectorPaneProps = {
  measurement: ReturnType<typeof useMeasurementTool>;
  measurementActive: boolean;
  elevationUnit: DisplayUnit;
  selectedWall: ReturnType<typeof getSelectedWall> | null;
  reshapeRoomId: string | null;
  dialogs: ReturnType<typeof useDialogs>;
  sharedOpeningIssues: LabeledDocumentIssue[];
  allowOverlappingPlacement: boolean;
  inspectorSections: Record<string, boolean>;
  setInspectorSectionOpen: (sectionId: string, open: boolean) => void;
  toggleReshapeRoom: (roomId: string | null) => void;
  armDuplicatePartition: (sourceWallId: string | null) => void;
  // "Use as North wall" raises a confirm only when the room carries typed wall
  // names — App owns that branch (it owns the dialog), so the inspector asks.
  requestSetNorthWall: (roomId: string, wallId: string) => void;
};

export function InspectorPane({
  measurement,
  measurementActive,
  elevationUnit,
  selectedWall,
  reshapeRoomId,
  dialogs,
  sharedOpeningIssues,
  allowOverlappingPlacement,
  inspectorSections,
  setInspectorSectionOpen,
  toggleReshapeRoom,
  armDuplicatePartition,
  requestSetNorthWall
}: InspectorPaneProps) {
  const project = useAppStore((state) => state.project);
  const selection = useAppStore((state) => state.selection);
  const viewMode = useAppStore((state) => state.viewMode);
  const arrangeSession = useAppStore((state) => state.arrangeSession);
  const lastArrangeMode = useAppStore((state) => state.lastArrangeMode);
  const lastInsetAnchor = useAppStore((state) => state.lastInsetAnchor);
  const lastEvenZone = useAppStore((state) => state.lastEvenZone);
  const placementWarnings = useAppStore((state) => state.placementWarnings);
  const lastGeometryEdit = useAppStore((state) => state.lastGeometryEdit);
  const selectOpening = useAppStore((state) => state.selectOpening);
  const setObjectSelection = useAppStore((state) => state.setObjectSelection);
  const addReferenceMeasurement = useAppStore((state) => state.addReferenceMeasurement);
  const updateReferenceMeasurement = useAppStore((state) => state.updateReferenceMeasurement);
  const deleteReferenceMeasurement = useAppStore((state) => state.deleteReferenceMeasurement);
  const viewFreestandingFace = useAppStore((state) => state.viewFreestandingFace);
  const rotateFreestandingWall = useAppStore((state) => state.rotateFreestandingWall);
  const centerFreestandingWall = useAppStore((state) => state.centerFreestandingWall);
  const setFreestandingWallThickness = useAppStore((state) => state.setFreestandingWallThickness);
  const setFreestandingWallLength = useAppStore((state) => state.setFreestandingWallLength);
  const setFreestandingWallHeight = useAppStore((state) => state.setFreestandingWallHeight);
  const setFreestandingWallClearance = useAppStore((state) => state.setFreestandingWallClearance);
  const deleteFreestandingWall = useAppStore((state) => state.deleteFreestandingWall);
  const restoreWall = useAppStore((state) => state.restoreWall);
  const resizeSelectedWall = useAppStore((state) => state.resizeSelectedWall);
  const resizeRoomHeight = useAppStore((state) => state.resizeRoomHeight);
  const resizeWall = useAppStore((state) => state.resizeWall);
  const setPolygonWallLength = useAppStore((state) => state.setPolygonWallLength);
  const updateArtwork = useAppStore((state) => state.updateArtwork);
  const updateArtworksMatFrame = useAppStore((state) => state.updateArtworksMatFrame);
  const setArtworkPlacementForm = useAppStore((state) => state.setArtworkPlacementForm);
  const moveArtworkPlacement = useAppStore((state) => state.moveArtworkPlacement);
  const removePlacement = useAppStore((state) => state.removePlacement);
  const addOpening = useAppStore((state) => state.addOpening);
  const addWallCase = useAppStore((state) => state.addWallCase);
  const addShelfUnderWallArtwork = useAppStore((state) => state.addShelfUnderWallArtwork);
  const moveOpening = useAppStore((state) => state.moveOpening);
  const resizeOpening = useAppStore((state) => state.resizeOpening);
  const fitOpeningToAvailableSpan = useAppStore((state) => state.fitOpeningToAvailableSpan);
  const updateDoorLeaf = useAppStore((state) => state.updateDoorLeaf);
  // The five shared-opening resolutions. Each one re-derives its own guard from
  // the current project inside the store — the inspector only ever asks.
  const resolveSharedOpening = useAppStore((state) => state.resolveSharedOpening);
  const completeSharedOpening = useAppStore((state) => state.completeSharedOpening);
  const realignSharedOpening = useAppStore((state) => state.realignSharedOpening);
  const splitSharedOpening = useAppStore((state) => state.splitSharedOpening);
  const keepThisOpeningOnly = useAppStore((state) => state.keepThisOpeningOnly);
  const renameWallText = useAppStore((state) => state.renameWallText);
  const renameWall = useAppStore((state) => state.renameWall);
  const updateFloorObject = useAppStore((state) => state.updateFloorObject);
  const setFloorArtworkImageFaces = useAppStore((state) => state.setFloorArtworkImageFaces);
  const setFloorArtworkStandsOn = useAppStore((state) => state.setFloorArtworkStandsOn);
  const updateFloorArtworkSupport = useAppStore(
    (state) => state.updateFloorArtworkSupport
  );
  const pairFloorArtworksBackToBack = useAppStore(
    (state) => state.pairFloorArtworksBackToBack
  );
  const updateWallCase = useAppStore((state) => state.updateWallCase);
  const updateShelf = useAppStore((state) => state.updateShelf);
  const removeSelectedPlacements = useAppStore((state) => state.removeSelectedPlacements);
  const beginArrangeSession = useAppStore((state) => state.beginArrangeSession);
  const setArrangeAnchor = useAppStore((state) => state.setArrangeAnchor);
  const setArrangeEvenZone = useAppStore((state) => state.setArrangeEvenZone);
  const updateArrangeSession = useAppStore((state) => state.updateArrangeSession);
  const commitArrangeSession = useAppStore((state) => state.commitArrangeSession);
  const cancelArrangeSession = useAppStore((state) => state.cancelArrangeSession);
  const centerSelectionBetweenBoundaries = useAppStore(
    (state) => state.centerSelectionBetweenBoundaries
  );
  const artworksById = useArtworksById();

  // Selection union is the source of truth; single-subject ids resolve live.
  const selectedObjectIds = objectIdsOf(selection);
  const selectedRoomId = roomIdOf(selection);
  const selectedFreestandingWallId = freestandingWallIdOf(selection);
  const selectedArtworkId = getSelectedArtworkId(project, selection);
  const selectedOpeningId = getSelectedOpeningId(project, selection);
  const selectedWallTextId = getSelectedWallTextId(project, selection);
  const selectedReferenceMeasurement = selection.kind === "measurement"
    ? project?.referenceMeasurements?.find((item) => item.id === selection.measurementId) ?? null
    : null;

  // Everything the opening inspector needs to say about the wall this opening
  // shares — assembled here so the component stays a renderer and the words
  // stay in the app's copy layer.
  const sharedOpeningSection: OpeningSharedSection | null = useMemo(() => {
    if (!project || !selectedOpeningId) return null;
    const opening = project.wallObjects.find((object) => object.id === selectedOpeningId);
    // Blocked zones never pair, so they get no section at all.
    if (!opening || (opening.kind !== "door" && opening.kind !== "window")) return null;

    const status = getSharedOpeningStatus(project, opening.id);
    const message =
      status.kind === "exposed"
        ? null
        : status.kind === "shared"
          ? describeSharedConnection(project, opening.id, status.partnerId)
          : status.kind === "drifted"
            ? describeSharedOpeningDrift(project, opening.id)
            : describeSharedOpeningConflict(status.conflict, project).message;

    return {
      status,
      resolutions: sharedOpeningResolutions(status),
      message,
      candidates:
        status.kind === "conflict"
          ? status.candidates.map((target) => ({
              key:
                target.kind === "opening"
                  ? `opening:${target.openingId}`
                  : `wall:${target.wallId}`,
              label: describeSharedOpeningTarget(project, target),
              target
            }))
          : [],
      onResolve: (target) => void resolveSharedOpening(opening.id, target),
      onComplete: () => void completeSharedOpening(opening.id),
      onRealign: () => void realignSharedOpening(opening.id),
      onSplit: () => void splitSharedOpening(opening.id),
      onKeepThisOnly: () => void keepThisOpeningOnly(opening.id)
    };
  }, [
    project,
    selectedOpeningId,
    resolveSharedOpening,
    completeSharedOpening,
    realignSharedOpening,
    splitSharedOpening,
    keepThisOpeningOnly
  ]);

  if (!project) return null;

  const selectedWallRoomPlacement =
    selectedWall
      ? (project.floor.rooms.find((placement) =>
          placement.room.walls.some((wall) => wall.id === selectedWall.id)
        ) ?? null)
      : null;
  const wallDimensionLink =
    selectedWall
      ? getWallDimensionLink(project, selectedWall.id)
      : null;
  const selectedRoomPlacement = selectedRoomId
    ? (project.floor.rooms.find((placement) => placement.roomId === selectedRoomId) ?? null)
    : null;
  // Stale partition ids from undo/redo resolve to null.
  const selectedFreestandingWall: FreestandingWall | null = selectedFreestandingWallId
    ? (project.floor.rooms
        .flatMap((placement) => placement.room.freestandingWalls)
        .find((wall) => wall.id === selectedFreestandingWallId) ?? null)
    : null;
  const selectedFreestandingWallPlacement = selectedFreestandingWallId
    ? project.floor.rooms.find((placement) =>
        placement.room.freestandingWalls.some((wall) => wall.id === selectedFreestandingWallId)
      ) ?? null
    : null;
  const selectedFreestandingWallClearances =
    selectedFreestandingWall && selectedFreestandingWallPlacement
      ? getPartitionClearances(selectedFreestandingWallPlacement.room, selectedFreestandingWall)
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

  // Dangling library selections fall through to the wall inspector.
  const selectedArtwork: Artwork | null =
    (selectedArtworkId ? artworksById.get(selectedArtworkId) : undefined) ?? null;
  const placedWallObject: ArtworkWallObject | null = selectedArtwork
    ? (project.wallObjects.find(
        (wallObject): wallObject is ArtworkWallObject =>
          wallObject.kind === "artwork" && wallObject.artworkId === selectedArtwork.id
      ) ?? null)
    : null;
  // Artwork ids survive wall↔floor conversion.
  const placedFloorArtwork: ArtworkFloorObject | null = selectedArtwork
    ? (project.floorObjects.find(
        (floorObject): floorObject is ArtworkFloorObject =>
          floorObject.kind === "artwork" && floorObject.artworkId === selectedArtwork.id
      ) ?? null)
    : null;
  // Whether the selected work is displayed on a CRT / box monitor. Read from
  // the RECORD (the display type travels with the work, not the placement), so
  // it is answerable for an unplaced work too.
  const selectedArtworkIsMonitor = isMonitorArtwork(selectedArtwork ?? undefined);
  // The pedestal/plinth under the selected floor placement, resolved the one
  // correct way (an untouched box monitor still stands on its implicit 800mm
  // pedestal — see resolveFloorSupport). Drives both the support fields and the
  // withheld "Height off floor": a support and a suspension height are
  // mutually exclusive states, and with a support present every renderer
  // ignores baseHeightMm, so offering the field would be offering a number
  // nothing draws.
  const placedFloorArtworkSupport = placedFloorArtwork
    ? resolveFloorSupport(placedFloorArtwork, selectedArtwork ?? undefined)
    : null;
  const isArtworkPlaced = placedWallObject !== null || placedFloorArtwork !== null;
  // Remove the artwork from whichever surface currently owns it.
  const artworkPlacementId = placedWallObject?.id ?? placedFloorArtwork?.id ?? null;
  // The inspector's Wall|Floor Type row shows where the object ACTUALLY is once
  // it's placed, never the library's placementForm — reading the flag for a
  // placed work is what let "Position on floor" render under "Type: Wall". The
  // flag speaks only while nothing is placed, which is the one case it still
  // decides anything (see store.setArtworkPlacementForm).
  const artworkPlacementForm: PlacementForm = placedWallObject
    ? "wall"
    : placedFloorArtwork
      ? "floor"
      : selectedArtwork
        ? effectivePlacementForm(selectedArtwork)
        : "wall";
  // Open walls have no surface, so a project made entirely of them offers a
  // standing work nowhere to go. The store refuses that conversion anyway; this
  // disables the segment so the refusal is never the way a curator finds out.
  const noWallToHangSelectedArtworkOn =
    placedFloorArtwork !== null && getPlaceableFloorWalls(project.floor).length === 0;

  // Placement readouts measure the same outer footprint the elevation paints.
  // Keep persisted image dimensions untouched and adapt only this geometry
  // boundary; openings and unresolved artwork records pass through unchanged.
  const wallPlacementGeometryObjects = project.wallObjects.map((wallObject) =>
    withArtworkFootprintFromMap(wallObject, artworksById)
  );
  const placedWallObjectFootprint: ArtworkWallObject | null = placedWallObject
    ? (wallPlacementGeometryObjects.find(
        (wallObject): wallObject is ArtworkWallObject =>
          wallObject.kind === "artwork" && wallObject.id === placedWallObject.id
      ) ?? null)
    : null;

  // Position fields consider artwork neighbors only, not openings.
  const placedWallObjectWall = placedWallObject
    ? (getProjectWalls(project).find((wall) => wall.id === placedWallObject.wallId) ?? null)
    : null;
  // What this work rests on: the first shelf whose derived riders include it.
  // Riders are geometry-derived (getShelfRiders), never stored, so this reads
  // the live relationship instead of any membership the work might have had a
  // moment ago.
  const standingShelf: ShelfWallObject | null = placedWallObject
    ? (project.wallObjects.find(
        (wallObject): wallObject is ShelfWallObject =>
          wallObject.kind === "shelf" &&
          getShelfRiders(wallObject, project.wallObjects, artworksById).some(
            (rider) => rider.id === placedWallObject.id
          )
      ) ?? null)
    : null;
  // A partition standing at a wall bounds that wall's hanging zone, so the
  // inspector's numeric affordances (neighbor distances, the Center button) have
  // to see it as a neighbor exactly like the elevation's dimension lines do.
  // Explicit actions are never gated on the canvas "Ghosts" toggle — see
  // derivePartitionNeighborShimsForFloorWall.
  const partitionNeighborShimsForWall = (wallId: string | null | undefined) =>
    wallId ? derivePartitionNeighborShimsForFloorWall(project.floor, wallId) : [];
  const placedWallObjectPartitions = partitionNeighborShimsForWall(placedWallObject?.wallId);
  const wallPlacementNeighbors = placedWallObjectFootprint
    ? getWallPlacementNeighborEdges(
        placedWallObjectFootprint,
        wallPlacementGeometryObjects.filter(
          (wallObject): wallObject is ArtworkWallObject => wallObject.kind === "artwork"
        ),
        placedWallObjectPartitions
      )
    : { leftNeighborRightEdgeMm: undefined, rightNeighborLeftEdgeMm: undefined };
  // Centering boundaries include every wall-object kind. A rider centers on
  // the shelf slab it stands on instead — that reading beats every other
  // boundary because standing on a shelf is the more specific relationship.
  const wallPlacementCenterTarget = standingShelf
    ? { xMm: standingShelf.xMm, boundaryKind: "shelf" as const }
    : placedWallObjectFootprint && placedWallObjectWall
      ? getWallPlacementCenterTarget(
          placedWallObjectFootprint,
          wallPlacementGeometryObjects,
          placedWallObjectWall.lengthMm,
          placedWallObjectPartitions
        )
      : { xMm: 0, boundaryKind: "wall" as const };

  // Deleted opening selections resolve to null. Wall text is a non-artwork
  // wall object too, so it is excluded here (it has its own inspector).
  const selectedOpening: OpeningWallObject | null = selectedOpeningId
    ? (project.wallObjects.find(
        (wallObject): wallObject is OpeningWallObject =>
          wallObject.kind !== "artwork" &&
          wallObject.kind !== "wall-text" &&
          wallObject.kind !== "case" &&
          wallObject.kind !== "shelf" &&
          wallObject.id === selectedOpeningId
      ) ?? null)
    : null;

  // The opening inspector reads and edits both jamb clearances, so it needs the
  // run of the wall the opening sits on (same lookup as selectedWallCaseWall).
  const selectedOpeningWall = selectedOpening
    ? (getProjectWalls(project).find((wall) => wall.id === selectedOpening.wallId) ?? null)
    : null;

  // Display cases share the opening-selection id space (ids are globally unique),
  // but have their own inspector, so they are resolved out of `selectedOpening`
  // above and derived separately here. A wall case lives in wallObjects; a floor
  // case in floorObjects. Deleted selections resolve to null.
  const selectedWallCase: CaseWallObject | null = selectedOpeningId
    ? (project.wallObjects.find(
        (wallObject): wallObject is CaseWallObject =>
          wallObject.kind === "case" && wallObject.id === selectedOpeningId
      ) ?? null)
    : null;
  const selectedWallCaseWall = selectedWallCase
    ? (getProjectWalls(project).find((wall) => wall.id === selectedWallCase.wallId) ?? null)
    : null;
  const wallCaseCenterTarget =
    selectedWallCase && selectedWallCaseWall
      ? getWallPlacementCenterTarget(
          selectedWallCase as unknown as ArtworkWallObject,
          project.wallObjects,
          selectedWallCaseWall.lengthMm,
          partitionNeighborShimsForWall(selectedWallCase.wallId)
        )
      : { xMm: 0, boundaryKind: "wall" as const };
  const selectedFloorCase: CaseFloorObject | null = selectedOpeningId
    ? (project.floorObjects.find(
        (floorObject): floorObject is CaseFloorObject =>
          floorObject.kind === "case" && floorObject.id === selectedOpeningId
      ) ?? null)
    : null;

  // A shelf shares the opening-selection id space with the cases above and is
  // resolved out of `selectedOpening` the same way, for the same reason: it has
  // its own inspector. Wall-only, so there is no floor counterpart to derive.
  const selectedWallShelf: ShelfWallObject | null = selectedOpeningId
    ? (project.wallObjects.find(
        (wallObject): wallObject is ShelfWallObject =>
          wallObject.kind === "shelf" && wallObject.id === selectedOpeningId
      ) ?? null)
    : null;
  const selectedWallShelfWall = selectedWallShelf
    ? (getProjectWalls(project).find((wall) => wall.id === selectedWallShelf.wallId) ?? null)
    : null;
  const wallShelfCenterTarget =
    selectedWallShelf && selectedWallShelfWall
      ? getWallPlacementCenterTarget(
          selectedWallShelf as unknown as ArtworkWallObject,
          project.wallObjects,
          selectedWallShelfWall.lengthMm,
          partitionNeighborShimsForWall(selectedWallShelf.wallId)
        )
      : { xMm: 0, boundaryKind: "wall" as const };

  // Deleted wall-text selections resolve to null.
  const selectedWallText: WallTextWallObject | null = selectedWallTextId
    ? (project.wallObjects.find(
        (wallObject): wallObject is WallTextWallObject =>
          wallObject.kind === "wall-text" && wallObject.id === selectedWallTextId
      ) ?? null)
    : null;
  const selectedWallTextWall = selectedWallText
    ? (getProjectWalls(project).find((wall) => wall.id === selectedWallText.wallId) ?? null)
    : null;
  const wallTextCenterTarget =
    selectedWallText && selectedWallTextWall
      ? getWallPlacementCenterTarget(
          selectedWallText as unknown as ArtworkWallObject,
          project.wallObjects,
          selectedWallTextWall.lengthMm,
          partitionNeighborShimsForWall(selectedWallText.wallId)
        )
      : { xMm: 0, boundaryKind: "wall" as const };
  // Opening selection also represents floor blocked zones; ids are globally unique.
  const selectedFloorBlockedZone: BlockedZoneFloorObject | null =
    selectedOpeningId && !selectedOpening
      ? (project.floorObjects.find(
          (floorObject): floorObject is BlockedZoneFloorObject =>
            floorObject.kind === "blocked-zone" && floorObject.id === selectedOpeningId
        ) ?? null)
      : null;

  // Drop stale multi-selection ids before deriving arrange eligibility.
  const isMultiSelect = selectedObjectIds.length > 1;
  // Arrangement ignores selected architecture and operates on artworks only.
  const selectedArtworkMembers = project.wallObjects.filter(
    (wallObject) =>
      wallObject.kind === "artwork" && selectedObjectIds.includes(wallObject.id)
  );
  // beginArrangeSession enforces the same eligibility at commit time.
  const arrangeEligibility = getArrangeEligibility(project, selectedObjectIds);
  const arrangeWall = arrangeEligibility.eligible
    ? (getProjectWalls(project).find(
        (wall) => wall.id === arrangeEligibility.wallId
      ) ?? null)
    : null;
  // Read arrangement values from live preview positions when a session exists.
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
  const arrangeReadout = deriveArrangeReadout({
    arrangeWall,
    arrangeMembers,
    activeArrangeSession,
    selectedArtworkMembers,
    wallObjects: project.wallObjects,
    selectedObjectIds,
    artworksById,
    lastInsetAnchor,
    lastArrangeMode,
    lastEvenZone,
    partitionNeighbors: partitionNeighborShimsForWall(arrangeWall?.id)
  });

  // Distinct artwork records behind the current multi-selection, for the bulk
  // mat/frame dialog. Both wall and floor placements resolve to a library
  // record; a work placed on two surfaces dedupes to one id.
  const selectedArtworkIds = [
    ...new Set(
      [...project.wallObjects, ...project.floorObjects].flatMap((object) =>
        object.kind === "artwork" && selectedObjectIds.includes(object.id)
          ? [object.artworkId]
          : []
      )
    )
  ];
  // The store skips frame-inclusive works; split the ids the same way so the
  // dialog's count and note match what it will actually apply.
  const bulkMatFrameTargets = selectedArtworkIds.flatMap((id) => {
    const artwork = artworksById.get(id);
    return artwork && artwork.frameIncludedInImage !== true ? [artwork] : [];
  });
  const bulkMatFrameSkippedCount = selectedArtworkIds.length - bulkMatFrameTargets.length;
  const bulkMatFrameTargetCount = bulkMatFrameTargets.length;

  // Back-to-back pairing needs exactly two floor-placed artworks — the anchor
  // (first selected, stays put) and the mover. Selection order is click order
  // for shift-clicks; a marquee hands ids in document order, which is still a
  // deterministic anchor the curator can flip by reselecting.
  const backToBackFloorArtworks =
    selectedObjectIds.length === 2
      ? selectedObjectIds.map((id) =>
          project.floorObjects.find(
            (floorObject) => floorObject.kind === "artwork" && floorObject.id === id
          )
        )
      : [];
  const backToBackPair =
    backToBackFloorArtworks.length === 2 && backToBackFloorArtworks.every(Boolean)
      ? { anchorId: backToBackFloorArtworks[0]!.id, movingId: backToBackFloorArtworks[1]!.id }
      : null;

  // Branch order mirrors arrange eligibility so the hint names the first blocker.
  const arrangeDisabledReason = arrangeEligibility.eligible
    ? ""
    : arrangeEligibility.reason === "floorMember"
      ? "Arranging is for works hung on a wall. This selection includes floor-placed objects."
      : arrangeEligibility.reason === "noArtworks"
        ? "Arranging is for works only. Doors, windows, and blocked zones stay where they are."
        : arrangeEligibility.reason === "singleArtwork"
        ? "Arranging is for works only. Select at least two works on the same wall to arrange them."
        : "Select works on a single wall to arrange them. This selection spans more than one wall.";
  // Explain that selected openings are excluded from arrangement.
  const arrangeIgnoredNote =
    arrangeWall && selectedObjectIds.length > selectedArtworkMembers.length
      ? "Only the works are arranged. Doors, windows, and blocked zones stay put."
      : undefined;

  // Resolve warning ids to artwork titles or human-readable opening labels.
  const labeledPlacementWarnings = placementWarnings.map((warning) => {
    const wallObject = project.wallObjects.find(
      (candidate) => candidate.id === warning.wallObjectId
    );
    const subject =
      wallObject?.kind === "artwork"
        ? (artworksById.get(wallObject.artworkId)?.title ?? "Untitled artwork")
        : wallObject
          ? wallObject.kind === "wall-text"
            ? "Wall text"
            : wallObject.kind === "case"
              ? "Display case" // TODO(case-ui): dedicated label source
              : wallObject.kind === "shelf"
                ? "Shelf"
                : getOpeningKindLabel(wallObject.kind)
          : undefined;
    return { ...warning, subject };
  });

  return (
        <aside className="inspector" aria-label="Inspector">
          <div className="inspector-zone">
            {(measurementActive &&
            (measurement.state.phase === "armed-complete" ||
              measurement.state.phase === "refining")) || selectedReferenceMeasurement ? (
              <div className="panel-heading inspector-subject measurement-subject">
                <h2>Measurement</h2>
                <span>{selectedReferenceMeasurement ? "Reference" : "Temporary"}</span>
              </div>
            ) : null}

            {!measurementActive && !isMultiSelect &&
            (selectedArtwork ||
              selectedOpening ||
              selectedFloorBlockedZone ||
              selectedFloorCase ||
              selectedWallCase ||
              selectedWallShelf ||
              selectedRoomPlacement ||
              selectedFreestandingWall ||
              selectedWall) ? (
              <div className="panel-heading inspector-subject">
                <h2>
                  {selectedArtwork
                    ? "Artwork"
                    : selectedOpening
                      ? getOpeningKindLabel(selectedOpening.kind)
                      : selectedFloorBlockedZone
                        ? getOpeningKindLabel(selectedFloorBlockedZone.kind)
                        : selectedFloorCase || selectedWallCase
                          ? "Display case"
                          : selectedWallShelf
                          ? "Shelf"
                          : selectedRoomPlacement
                            ? selectedRoomPlacement.room.name
                            : selectedFreestandingWall
                              ? selectedFreestandingWall.name
                              : selectedWall?.name}
                </h2>
                {!selectedArtwork ? <span>
                  {selectedOpening
                      ? "Opening"
                      : selectedFloorBlockedZone
                        ? "Floor object"
                        : selectedFloorCase
                          ? "Floor object"
                          : selectedWallCase || selectedWallShelf
                            ? "Wall object"
                            : selectedRoomPlacement
                              ? "Room"
                              : selectedFreestandingWall
                                ? "Partition"
                                : "Wall"}
                </span> : null}
              </div>
            ) : null}

            <PlacementWarnings
              warnings={labeledPlacementWarnings}
              documentIssues={sharedOpeningIssues}
              // Each row selects ITS OWN opening. The rail's "go to first
              // issue" affordance still exists separately; this is what makes
              // the second of two identically-worded rows reachable at all.
              onSelectIssue={selectOpening}
              selectedWallObjectId={
                placedWallObject?.id ??
                selectedOpening?.id ??
                selectedWallCase?.id ??
                selectedWallShelf?.id ??
                selectedWallText?.id ??
                null
              }
            />

            {selectedReferenceMeasurement ? (
              <ReferenceMeasurementInspector
                name={selectedReferenceMeasurement.name}
                distanceMm={Math.hypot(
                  selectedReferenceMeasurement.end.xMm - selectedReferenceMeasurement.start.xMm,
                  selectedReferenceMeasurement.end.yMm - selectedReferenceMeasurement.start.yMm
                )}
                unit={selectedReferenceMeasurement.kind === "elevation" ? elevationUnit : project.unit}
                visible={selectedReferenceMeasurement.visible}
                locked={selectedReferenceMeasurement.locked}
                outOfBounds={selectedReferenceMeasurement.kind === "elevation" && selectedWall?.id === selectedReferenceMeasurement.wallId && [selectedReferenceMeasurement.start, selectedReferenceMeasurement.end].some((point) => point.xMm < 0 || point.xMm > selectedWall.lengthMm || point.yMm < 0 || point.yMm > selectedWall.heightMm)}
                onChange={(changes) => void updateReferenceMeasurement(selectedReferenceMeasurement.id, changes)}
                onDelete={() => void deleteReferenceMeasurement(selectedReferenceMeasurement.id)}
              />
            ) : measurementActive &&
            (measurement.state.phase === "armed-complete" ||
              measurement.state.phase === "refining") ? (
              <MeasurementInspector
                distanceMm={Math.hypot(
                  measurement.state.end.xMm - measurement.state.start.xMm,
                  measurement.state.end.yMm - measurement.state.start.yMm
                )}
                unit={viewMode === "elevation" ? elevationUnit : project.unit}
                onKeepAsReference={() => {
                  const state = measurement.state;
                  if (state.phase !== "armed-complete" && state.phase !== "refining") return;
                  if (state.context.kind === "plan") {
                    void addReferenceMeasurement({ kind: "plan", start: state.start, end: state.end });
                  } else {
                    void addReferenceMeasurement({ kind: "elevation", wallId: state.context.wallId, start: state.start, end: state.end });
                  }
                  measurement.clear();
                }}
                onClear={measurement.clear}
              />
            ) : isMultiSelect ? (
              // Multi-selection replaces the single-subject inspector chain.
              <SelectionInspector
                arrange={arrangeReadout}
                arrangeDisabledReason={arrangeDisabledReason}
                arrangeIgnoredNote={arrangeIgnoredNote}
                count={selectedObjectIds.length}
                selectionKey={[...selectedObjectIds].sort().join("\n")}
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
                onCenterGroup={() =>
                  void centerSelectionBetweenBoundaries(allowOverlappingPlacement)
                }
                backToBack={
                  backToBackPair
                    ? {
                        onPair: () =>
                          void pairFloorArtworksBackToBack(
                            backToBackPair.anchorId,
                            backToBackPair.movingId
                          )
                      }
                    : undefined
                }
                matFrame={
                  selectedArtworkIds.length > 0
                    ? {
                        targetCount: bulkMatFrameTargetCount,
                        skippedCount: bulkMatFrameSkippedCount,
                        currentValues: bulkMatFrameTargets.map(({ matWidthMm, frame }) => ({
                          matWidthMm,
                          frame
                        })),
                        onApply: (changes) =>
                          updateArtworksMatFrame(selectedArtworkIds, changes)
                      }
                    : undefined
                }
                onRemoveAll={() => void removeSelectedPlacements()}
              />
            ) : selectedArtwork ? (
              <ArtworkInspector
                artwork={selectedArtwork}
                scopeNote={
                  viewMode === "library"
                    ? "Changes apply everywhere this artwork is used."
                    : undefined
                }
                isPlaced={isArtworkPlaced}
                placementForm={artworkPlacementForm}
                disabledPlacementForm={
                  noWallToHangSelectedArtworkOn ? "wall" : undefined
                }
                disabledPlacementFormReason="No wall to hang it on."
                // A floor-placed work is dragged/dropped off a wall onto open
                // floor; its remove affordance disconnects that floor object.
                removeLabel={placedFloorArtwork ? "Remove from floor" : "Remove from wall"}
                placementTitle={
                  placedWallObject && placedWallObjectWall
                    ? `Position on ${placedWallObjectWall.name}`
                    : placedFloorArtwork
                      ? "Position on floor"
                      : undefined
                }
                placementSection={
                  placedWallObject && placedWallObjectWall ? (
                    <>
                      <WallPlacementFields
                        placement={placedWallObjectFootprint ?? placedWallObject}
                        wallLengthMm={placedWallObjectWall.lengthMm}
                        leftNeighborRightEdgeMm={wallPlacementNeighbors.leftNeighborRightEdgeMm}
                        rightNeighborLeftEdgeMm={wallPlacementNeighbors.rightNeighborLeftEdgeMm}
                        leftNeighborIsPartition={wallPlacementNeighbors.leftNeighborIsPartition}
                        rightNeighborIsPartition={wallPlacementNeighbors.rightNeighborIsPartition}
                        centerTargetXMm={wallPlacementCenterTarget.xMm}
                        centerBoundaryKind={wallPlacementCenterTarget.boundaryKind}
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
                      {/* What does this work rest on? A shelf is the one piece
                          of furniture a work asks for by name, and asking from
                          the work is what lets the slab be sized and seated
                          from it (see addShelfUnderWallArtwork). It lands under
                          THIS work's bottom edge with both selected, so the
                          next drag moves the pair together. Once a shelf is
                          standing under the work, the row becomes a way back to
                          it — "Select shelf" reaches the relationship from
                          either end. */}
                      <InspectorSummaryRow
                        label="Support"
                        value={standingShelf ? "Shelf" : "Hung on the wall"}
                        action={
                          standingShelf ? (
                            <Button
                              className="inspector-action"
                              size="sm"
                              variant="ghost"
                              onClick={() => selectOpening(standingShelf.id)}
                            >
                              Select shelf
                            </Button>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  className="inspector-action"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void addShelfUnderWallArtwork(placedWallObject.id)}
                                >
                                  <ShelfGlyph aria-hidden="true" size={14} />
                                  Add shelf
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                Puts a shelf under this work and stands it on it.
                                Drag the work away to hang it again.
                              </TooltipContent>
                            </Tooltip>
                          )
                        }
                      />
                    </>
                  ) : placedFloorArtwork ? (
                    <>
                      <FloorPlacementFields
                        floorObject={placedFloorArtwork}
                        unit={project.unit}
                        onCommitPosition={(xMm, yMm) =>
                          void updateFloorObject(placedFloorArtwork.id, { xMm, yMm })
                        }
                        onCommitSize={(widthMm, depthMm) =>
                          void updateFloorObject(placedFloorArtwork.id, { widthMm, depthMm })
                        }
                        onCommitHeight={(heightMm) =>
                          void updateFloorObject(placedFloorArtwork.id, { heightMm })
                        }
                        onCommitRotation={(rotationDeg) =>
                          void updateFloorObject(placedFloorArtwork.id, { rotationDeg })
                        }
                        // A box monitor stands on a pedestal or on the floor
                        // — never on wires. A work standing on a support is
                        // the same case: its bottom edge IS the support's top
                        // face and every renderer ignores baseHeightMm, so the
                        // field would edit a number nothing draws (and "Stands
                        // on" below is how the work gets back into the air).
                        // Withholding the prop hides the field entirely, the
                        // same way a display case is denied it (see
                        // FloorPlacementFields' onCommitBaseHeight and
                        // CrtMonitorMesh, which ignores baseHeightMm for the
                        // same reason).
                        {...(selectedArtworkIsMonitor || placedFloorArtworkSupport
                          ? {}
                          : {
                              onCommitBaseHeight: (baseHeightMm: number) =>
                                void updateFloorObject(placedFloorArtwork.id, {
                                  baseHeightMm
                                })
                            })}
                      />
                      {/* What the work stands on is a fact about THIS
                          installation — it writes to the floor placement
                          (support / baseHeightMm / monitorSupport), so it lives
                          with the other placement fields rather than in the
                          identity block, and stays reachable when the record up
                          there has compacted. An unplaced work gets the default
                          (floor, or a monitor's pedestal) when it lands. */}
                      <StandsOnField
                        artwork={selectedArtwork}
                        floorObject={placedFloorArtwork}
                        isMonitor={selectedArtworkIsMonitor}
                        onChange={(standsOn) =>
                          void setFloorArtworkStandsOn(placedFloorArtwork.id, standsOn)
                        }
                      />
                      {/* The support BOX's own numbers, under the fields that
                          size the WORK. Only when there is one to edit. */}
                      {placedFloorArtworkSupport ? (
                        <FloorSupportFields
                          floorObject={placedFloorArtwork}
                          support={placedFloorArtworkSupport}
                          unit={project.unit}
                          onChange={(changes) =>
                            void updateFloorArtworkSupport(
                              placedFloorArtwork.id,
                              changes
                            )
                          }
                        />
                      ) : null}
                      {/* The box's Width/Height size the object standing on the
                          floor; the work has its own recorded size, and 3D draws
                          the image at THAT size. This note appears only once the
                          two have drifted apart, and offers the way back. A
                          monitor asks the same question about its CABINET, whose
                          target is the 4:3 box the work implies — see the note's
                          own monitor branch. */}
                      <FloorArtworkImageSizeNote
                        dimensions={selectedArtwork.dimensions}
                        isMonitor={selectedArtworkIsMonitor}
                        objectWidthMm={placedFloorArtwork.widthMm}
                        objectHeightMm={placedFloorArtwork.heightMm}
                        objectDepthMm={placedFloorArtwork.depthMm}
                        unit={project.unit}
                        onMatchSizeToWork={(widthMm, heightMm, depthMm) =>
                          void updateFloorObject(placedFloorArtwork.id, {
                            widthMm,
                            heightMm,
                            ...(depthMm !== undefined ? { depthMm } : {})
                          })
                        }
                      />
                      {/* Which box faces carry the image — a box-specific
                          question a wall-hung placement (a plane, not a box)
                          never has, so it rides only this floor branch. A
                          monitor is excluded on its own terms: it shows its
                          picture on ONE screen, so a six-face picker would be
                          offering to break it. */}
                      {selectedArtworkIsMonitor ? null : (
                        <FloorArtworkImageFacesField
                          imageFaces={placedFloorArtwork.imageFaces}
                          onChange={(faces) =>
                            void setFloorArtworkImageFaces(placedFloorArtwork.id, faces)
                          }
                        />
                      )}
                    </>
                  ) : null
                }
                sectionsOpen={inspectorSections}
                unit={project.unit}
                onCommitDimensions={(dimensions) =>
                  void updateArtwork(selectedArtwork.id, { dimensions })
                }
                onCommitField={(changes) => void updateArtwork(selectedArtwork.id, changes)}
                onChangePlacementForm={(placementForm) =>
                  void setArtworkPlacementForm(
                    selectedArtwork.id,
                    placementForm,
                    allowOverlappingPlacement
                  )
                }
                onCommitFraming={(changes) => void updateArtwork(selectedArtwork.id, changes)}
                onSectionOpenChange={setInspectorSectionOpen}
                onRemovePlacement={
                  artworkPlacementId
                    ? () => void removePlacement(artworkPlacementId)
                    : undefined
                }
              />
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
              // Angle only, no Height off floor: a blocked zone is a keep-out
              // annotation about floor AREA, so hovering it has no referent
              // (see FloorObjectInspector / FloorObjectBox, which render it as a
              // flat floor-plane wash that already honors rotationDeg).
              onCommitRotation={(rotationDeg) =>
                void updateFloorObject(selectedFloorBlockedZone.id, { rotationDeg })
              }
              onDelete={() => void removePlacement(selectedFloorBlockedZone.id)}
            />
          ) : selectedWallText ? (
            <WallTextInspector
              wallText={selectedWallText}
              unit={project.unit}
              onRename={(name) => void renameWallText(selectedWallText.id, name)}
              onCommitSize={(widthMm, heightMm) =>
                void resizeOpening(selectedWallText.id, widthMm, heightMm, allowOverlappingPlacement)
              }
              onDelete={() => void removePlacement(selectedWallText.id)}
              placementSection={
                selectedWallTextWall ? (
                  <WallPlacementFields
                    placement={selectedWallText}
                    wallLengthMm={selectedWallTextWall.lengthMm}
                    centerTargetXMm={wallTextCenterTarget.xMm}
                    centerBoundaryKind={wallTextCenterTarget.boundaryKind}
                    unit={project.unit}
                    onCommit={(xMm, yMm) =>
                      void moveOpening(
                        selectedWallText.id,
                        xMm,
                        yMm,
                        allowOverlappingPlacement
                      )
                    }
                  />
                ) : null
              }
            />
          ) : selectedFloorCase ? (
            <FloorCaseInspector
              floorCase={selectedFloorCase}
              unit={project.unit}
              onCommitPosition={(xMm, yMm) =>
                void updateFloorObject(selectedFloorCase.id, { xMm, yMm })
              }
              onCommitSize={(widthMm, depthMm) =>
                void updateFloorObject(selectedFloorCase.id, { widthMm, depthMm })
              }
              onCommitHeight={(heightMm) =>
                void updateFloorObject(selectedFloorCase.id, { heightMm })
              }
              // Angle only, no Height off floor: a vitrine stands on its own
              // legs, whose height CaseMesh derives from heightMm ("overall,
              // floor to box top"). Lifting the box would leave the legs
              // ending in mid-air while invalidating the datum they are
              // computed from — so 3D ignores baseHeightMm for cases too.
              onCommitRotation={(rotationDeg) =>
                void updateFloorObject(selectedFloorCase.id, { rotationDeg })
              }
              onDelete={() => void removePlacement(selectedFloorCase.id)}
            />
          ) : selectedWallCase ? (
            <WallCaseInspector
              wallCase={selectedWallCase}
              wallLengthMm={selectedWallCaseWall?.lengthMm ?? 0}
              centerTargetXMm={wallCaseCenterTarget.xMm}
              centerBoundaryKind={wallCaseCenterTarget.boundaryKind}
              unit={project.unit}
              onCommitPosition={(xMm, yMm) =>
                void updateWallCase(selectedWallCase.id, { xMm, yMm })
              }
              onCommitSize={(widthMm, heightMm, depthMm) =>
                void updateWallCase(selectedWallCase.id, { widthMm, heightMm, depthMm })
              }
              onDelete={() => void removePlacement(selectedWallCase.id)}
            />
          ) : selectedWallShelf ? (
            <ShelfInspector
              shelf={selectedWallShelf}
              riderCount={
                getShelfRiders(selectedWallShelf, project.wallObjects, artworksById).length
              }
              onSelectRiders={() =>
                setObjectSelection(
                  getShelfRiders(selectedWallShelf, project.wallObjects, artworksById).map(
                    (rider) => rider.id
                  )
                )
              }
              wallLengthMm={selectedWallShelfWall?.lengthMm ?? 0}
              centerTargetXMm={wallShelfCenterTarget.xMm}
              centerBoundaryKind={wallShelfCenterTarget.boundaryKind}
              unit={project.unit}
              onCommitPosition={(xMm, yMm) =>
                void updateShelf(selectedWallShelf.id, { xMm, yMm })
              }
              // heightMm IS the slab's thickness; the store keeps the TOP fixed
              // when it changes and recomputes yMm beneath it.
              onCommitSize={(widthMm, thicknessMm, depthMm) =>
                void updateShelf(selectedWallShelf.id, {
                  widthMm,
                  heightMm: thicknessMm,
                  depthMm
                })
              }
              onCommitTop={(topMm) =>
                void updateShelf(selectedWallShelf.id, {
                  yMm: shelfCenterYMmForTop(topMm, selectedWallShelf.heightMm)
                })
              }
              onDelete={() => void removePlacement(selectedWallShelf.id)}
            />
          ) : selectedOpening ? (
            <OpeningInspector
              opening={selectedOpening}
              unit={project.unit}
              wallLengthMm={selectedOpeningWall?.lengthMm ?? 0}
              sharedOpening={sharedOpeningSection}
              // Awaited, not void-ed: the resolved OpeningFit is how the
              // inspector learns that a request was slid or trimmed to fit.
              onCommitPosition={(xMm, yMm) =>
                moveOpening(selectedOpening.id, xMm, yMm, allowOverlappingPlacement)
              }
              onCommitSize={(widthMm, heightMm) =>
                resizeOpening(selectedOpening.id, widthMm, heightMm, allowOverlappingPlacement)
              }
              onFitToWall={() => fitOpeningToAvailableSpan(selectedOpening.id)}
              // Only ever reachable for a door (OpeningInspector narrows on
              // opening.kind itself), but wired unconditionally here: the
              // store action already no-ops for a non-door id, so a second
              // kind check on this line would just duplicate that guard.
              onUpdateDoorLeaf={(leaf) => updateDoorLeaf(selectedOpening.id, leaf)}
              onDelete={() => void removePlacement(selectedOpening.id)}
            />
          ) : selectedRoomPlacement ? (
            <RoomInspector
              artworkCount={selectedRoomArtworkCount}
              objectCount={selectedRoomObjectCount}
              rectangleDimensions={selectedRoomDimensions}
              reshapeActive={reshapeRoomId === selectedRoomPlacement.roomId}
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
              onCommitHeight={(heightMm) =>
                resizeRoomHeight(selectedRoomPlacement.roomId, heightMm)
              }
              onToggleReshape={() => toggleReshapeRoom(selectedRoomPlacement.roomId)}
            />
          ) : selectedFreestandingWall ? (
            <FreestandingWallInspector
              wall={selectedFreestandingWall}
              unit={project.unit}
              clearances={selectedFreestandingWallClearances}
              onCommitLength={(lengthMm) =>
                setFreestandingWallLength(selectedFreestandingWall.id, lengthMm)
              }
              onCommitAngle={(angleDeg) =>
                rotateFreestandingWall(selectedFreestandingWall.id, angleDeg)
              }
              onCommitThickness={(thicknessMm) =>
                setFreestandingWallThickness(selectedFreestandingWall.id, thicknessMm)
              }
              onCommitHeight={(heightMm) =>
                setFreestandingWallHeight(selectedFreestandingWall.id, heightMm)
              }
              onCenter={(axis) => centerFreestandingWall(selectedFreestandingWall.id, axis)}
              onCommitClearance={(side, distanceMm) =>
                setFreestandingWallClearance(selectedFreestandingWall.id, side, distanceMm)
              }
              onDuplicate={() => armDuplicatePartition(selectedFreestandingWall.id)}
              onViewFace={(face) =>
                viewFreestandingFace(faceWallId(selectedFreestandingWall.id, face))
              }
              onDelete={() => void deleteFreestandingWall(selectedFreestandingWall.id)}
            />
          ) : selectedWall ? (
            <WallInspector
              key={selectedWall.id}
              // A partition face never reaches this inspector (it has its own),
              // but the compass still needs a quadrilateral perimeter room.
              canSetNorth={
                selectedWallRoomPlacement !== null &&
                selectedWallRoomPlacement.room.walls.length ===
                  COMPASS_WALL_NAMES.length &&
                parseFaceWallId(selectedWall.id) === null
              }
              centerlineMm={project.defaultCenterlineHeightMm}
              changedWallNames={getWallNames(
                project,
                lastGeometryEdit?.changedWallIds ?? []
              )}
              dimensionLink={wallDimensionLink}
              lastGeometryEdit={lastGeometryEdit}
              isOpenSide={selectedWall.isOpenSide === true}
              // The button fires for the DISPLAYED wall (fallback included),
              // unlike the Delete key. That is not a hole in the safety rule:
              // the user clicked a labelled control inside a panel headed by
              // that wall's name, and the confirm names it again. The rule
              // protects the implicit gesture — a bare keypress — not this one.
              onOpenWall={() => dialogs.open("openWall", { wallId: selectedWall.id })}
              onRenameWall={(name) => void renameWall(selectedWall.id, name)}
              onRestoreWall={() => void restoreWall(selectedWall.id)}
              onSetNorthWall={() => {
                if (!selectedWallRoomPlacement) return;
                requestSetNorthWall(selectedWallRoomPlacement.roomId, selectedWall.id);
              }}
              onAddCase={() => void addWallCase(selectedWall.id)}
              onAddOpening={(kind) => void addOpening(selectedWall.id, kind)}
              onAddShelf={() => void addOpening(selectedWall.id, "shelf")}
              onCommitHeight={(heightMm) =>
                selectedWallRoomPlacement
                  ? resizeRoomHeight(selectedWallRoomPlacement.roomId, heightMm)
                  : Promise.resolve()
              }
              onCommitLength={(lengthMm, anchor) =>
                selectedWallRoomPlacement &&
                !getRectangleRoomDimensions(selectedWallRoomPlacement.room)
                  ? setPolygonWallLength(selectedWall.id, lengthMm, anchor)
                  : resizeSelectedWall(lengthMm)
              }
              polygonLengthEditing={Boolean(
                selectedWallRoomPlacement &&
                  !getRectangleRoomDimensions(selectedWallRoomPlacement.room)
              )}
              roomName={selectedWallRoomPlacement?.room.name ?? "this room"}
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
        </aside>
  );
}
