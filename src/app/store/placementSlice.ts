import { isMonitorArtwork, monitorBoxSizeMm } from "../../domain/geometry/monitorGlyphs";
import {
  findNearestWall,
  getFloorWalls,
  getPlaceableFloorWalls,
  getWallObjectPlanRect
} from "../../domain/geometry/planObjects";
import { clamp } from "../../domain/geometry/scalar";
import { normalizeFloorSupport } from "../../domain/geometry/supportGlyphs";
import { isHangableWall } from "../../domain/geometry/wallCascade";
import { newId } from "../../domain/id";
import { effectiveFloorDepthMm, type PlacementForm } from "../../domain/placement/artworkForm";
import { createFloorCase, createWallCase } from "../../domain/placement/createCase";
import {
  clearOpeningPartners,
  includePairedOpenings,
  normalizeOpeningPairs
} from "../../domain/placement/openingPairs";
import {
  createArtworkPlacement,
  getEffectivePlacementSizeMm
} from "../../domain/placement/placeArtwork";
import type { PlacementWarning } from "../../domain/placement/validatePlacement";
import {
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type ArtworkFloorMemory,
  type ArtworkFloorObject,
  type ArtworkWallObject,
  type CaseWallObject,
  type FloorMemory,
  type FloorObject,
  type Project,
  type WallObject
} from "../../domain/project";
import type { PlanPlacement } from "../../domain/snapping/planSnapTargets";
import type { PixelAspect } from "../../domain/units/aspectFill";
import { getProjectWalls } from "../projectWalls";
import type { AppState, EditEntry, EditExtras } from "../store";
import { moveObjectNoun, syncMovedPairHalves, syncPartnerMove } from "./openingEdits";
import {
  createOpeningPlacementSlice,
  type OpeningPlacementSliceActions
} from "./openingPlacementSlice";
import {
  FORBIDDEN_OVERLAP_MESSAGE,
  OVERLAP_BLOCKED_MESSAGE,
  sharedOpeningRefusalMessage
} from "./placementMessages";
import { NO_SELECTION, objectIdsOf, selectionWrite } from "./selectionSlice";

export {
  OVERLAP_BLOCKED_MESSAGE,
  FORBIDDEN_OVERLAP_MESSAGE,
  SHARED_OPENING_SLOT_BLOCKED_MESSAGE,
  SHARED_OPENING_OFF_BOUNDARY_MESSAGE,
  sharedOpeningRefusalMessage
} from "./placementMessages";

// Enforce one placement only when adding; preserve duplicates already loaded.
const ALREADY_PLACED_MESSAGE =
  "This artwork is already placed. To try another arrangement, duplicate the project and experiment there.";

// Only architecture opts a transaction into reconciliation. Artwork, wall
// text and display cases also live in wallObjects, but moving one says
// nothing about where a room's boundaries are.
function isOpeningKind(kind: WallObject["kind"]): boolean {
  return kind === "door" || kind === "window" || kind === "blocked-zone";
}

export type PlacementSliceActions = OpeningPlacementSliceActions & {
  placeArtwork: (
    artworkId: string,
    wallId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  moveArtworkPlacement: (
    wallObjectId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  // Move a wall object in BOTH wall axes AND (optionally) onto another wall, in
  // one undo entry. The 3D pointer drag's commit: neither existing action fits
  // it alone, because moveArtworkPlacement moves x/y but can't change walls and
  // commitPlanMove changes walls but has no hang height (plan can't see one).
  // Routes through the same wall→wall handler commitPlanMove uses, so the
  // open-wall refusal, shared-opening partner sync and pair normalization are
  // the drag's too rather than a second copy.
  moveWallObjectPlacement: (
    wallObjectId: string,
    wallId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  removePlacement: (wallObjectId: string) => Promise<void>;
  placeArtworkOnFloor: (artworkId: string, xMm: number, yMm: number) => Promise<void>;
  // The artwork inspector's Wall|Floor "Type" control. For a PLACED work this
  // converts the placement itself — off the wall onto the floor in front of it,
  // or off the floor onto the nearest wall — reusing the same round-tripping
  // machinery a plan drag across the boundary uses, so a mis-click is one undo
  // away and nothing surface-specific is lost either way.
  //
  // It deliberately does NOT write the library's `placementForm` when it
  // converts: updateArtwork pushes an undo entry of its own, so writing both
  // would make one click two undo steps. For a placed work the PLACEMENT is the
  // source of truth (App derives the control's displayed value from it), and the
  // flag's only remaining job is deciding where an UNPLACED work lands when it's
  // dropped in from the checklist — which is exactly the case this still writes.
  setArtworkPlacementForm: (
    artworkId: string,
    form: PlacementForm,
    allowOverlap?: boolean
  ) => Promise<void>;
  // The single armed "Case" insert tool: a wall anchor creates a wall case, a
  // floor anchor creates a freestanding floor case (capture-any at the plan
  // layer decides which). Selects the new object; one undo step.
  placeCaseFromPlan: (placement: PlanPlacement) => Promise<void>;
  // The wall inspector's "Wall case" chip. Freestanding cases have no wall to
  // belong to, so they stay a plan-tool placement. Selects the new case; one
  // undo step.
  addWallCase: (wallId: string) => Promise<void>;
  // Numeric edits to a wall case (its own fields, including the new depthMm
  // protrusion). Separate from resizeOpening because a case carries depthMm and
  // is never an opening/does not pair.
  updateWallCase: (
    wallObjectId: string,
    changes: Partial<Pick<CaseWallObject, "xMm" | "yMm" | "widthMm" | "heightMm" | "depthMm">>
  ) => Promise<void>;
  commitPlanMove: (
    objectId: string,
    placement: PlanPlacement,
    allowOverlap?: boolean
  ) => Promise<void>;
  moveWallObjectsGroup: (
    moves: { id: string; xMm: number; yMm: number }[],
    allowOverlap?: boolean
  ) => Promise<void>;
  movePlanObjectsGroup: (
    moves: { id: string; xMm: number; yMm?: number; wallId?: string }[],
    allowOverlap?: boolean
  ) => Promise<void>;
  removeSelectedPlacements: () => Promise<void>;
};

// Gate and persist one placement edit, optionally with a floor-object change.
// Shared with the slices that also commit through the placement gate.
export type CommitWallObjectEdit = (
  label: string,
  project: Project,
  nextWallObjects: WallObject[],
  validateIds: string[],
  allowOverlap: boolean,
  options?: {
    nextFloorObjects?: FloorObject[];
    extras?: EditExtras;
    reconcileWallIds?: string[];
  }
) => Promise<boolean>;

export type CommitWallObjectMoves = (
  moves: { id: string; xMm: number; yMm: number }[],
  label: string | ((movedCount: number) => string),
  allowOverlap: boolean,
  extras?: EditExtras
) => { status: "committed"; project: Project } | { status: "no-op" } | { status: "blocked" };

export type PlacementSliceInternals = {
  applyEdit: (
    label: string,
    buildNextProject: (project: Project) => Project,
    extras?: EditExtras
  ) => Promise<void>;
  // Batch commits build their own undo entry so arrange can settle state
  // synchronously before awaiting persistence.
  pushEditEntry: (entry: EditEntry, extras?: EditExtras) => void;
  persist: (project: Project) => Promise<void>;
  // Framing-aware placement validation (the store widens artwork footprints
  // at its own boundary before calling the pure validator).
  validateWallObjectPlacements: (
    project: Project,
    wallObjectIds: string[],
    artworks?: Artwork[]
  ) => PlacementWarning[];
  reconcileSharedOpenings: (
    project: Project,
    candidateWallObjects: WallObject[],
    touchedWallIds: string[]
  ) => { wallObjects: WallObject[]; validateIds: string[]; scopeWallIds?: string[] };
  loadArtworkAspect: (artwork: Artwork) => Promise<PixelAspect | undefined>;
};

export function createPlacementSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: PlacementSliceInternals
): {
  actions: PlacementSliceActions;
  commitWallObjectEdit: CommitWallObjectEdit;
  commitWallObjectMoves: CommitWallObjectMoves;
} {
  const {
    applyEdit,
    pushEditEntry,
    persist,
    validateWallObjectPlacements,
    reconcileSharedOpenings,
    loadArtworkAspect
  } = internals;

  // Placement commit gate. Forbidden collisions always block; artwork
  // collisions block unless allowOverlap is true. null means do not commit.
  function gatePlacementWarnings(
    project: Project,
    candidateWallObjects: WallObject[],
    validateIds: string[],
    allowOverlap: boolean
  ): PlacementWarning[] | null {
    const placementWarnings = validateWallObjectPlacements(
      { ...project, wallObjects: candidateWallObjects },
      validateIds
    );

    const blocking = placementWarnings.filter(
      (warning) =>
        warning.type === "collision" && (warning.overridable === false || !allowOverlap)
    );
    if (blocking.length > 0) {
      const hasForbidden = blocking.some((warning) => warning.overridable === false);
      set({ error: hasForbidden ? FORBIDDEN_OVERLAP_MESSAGE : OVERLAP_BLOCKED_MESSAGE });
      return null;
    }
    return placementWarnings;
  }

  // Gate and persist one placement edit, optionally with a floor-object change.
  async function commitWallObjectEdit(
    label: string,
    project: Project,
    nextWallObjects: WallObject[],
    validateIds: string[],
    allowOverlap: boolean,
    options: {
      nextFloorObjects?: FloorObject[];
      extras?: EditExtras;
      // OPT-IN, by name. Present only on transactions whose intent is to
      // change architecture — opening create/move/resize/re-anchor. Never on
      // artwork, cases, wall text or partitions, which also rewrite
      // wallObjects but say nothing about where a room's boundaries are.
      reconcileWallIds?: string[];
    } = {}
  ): Promise<boolean> {
    // Reconcile BEFORE the gate, so a twin this edit creates is bounds- and
    // collision-validated like anything else, and rides the same commit —
    // one undo step covers the edit and its reconciliation, or neither
    // happens.
    const reconciled = options.reconcileWallIds
      ? reconcileSharedOpenings(project, nextWallObjects, options.reconcileWallIds)
      : { wallObjects: nextWallObjects, validateIds: [] };

    const placementWarnings = gatePlacementWarnings(
      project,
      reconciled.wallObjects,
      [...validateIds, ...reconciled.validateIds],
      allowOverlap
    );
    if (placementWarnings === null) return false;

    await applyEdit(
      label,
      (current) => ({
        ...current,
        wallObjects: reconciled.wallObjects,
        ...(options.nextFloorObjects ? { floorObjects: options.nextFloorObjects } : {})
      }),
      { placementWarnings, ...options.extras }
    );
    return true;
  }

  // Every path that creates a wall object or re-anchors one onto a different
  // wall funnels through this. An open wall has no surface, so nothing can
  // hang on it — and hiding the affordance is not enough, because these
  // actions are also reachable from drops, group drags and keyboard paths.
  //
  // Reports rather than returning a bare no-op: a click that silently does
  // nothing reads as a broken app, and the user has no way to learn the rule.
  function refuseOpenWall(project: Project, wallId: string): boolean {
    if (isHangableWall(project, wallId)) return false;
    set({ error: "This wall is open, so nothing can hang on it." });
    return true;
  }

  // --- commitPlanMove case handlers ----------------------------------------

  // wall → wall: same wall (x only) or re-anchor to another wall. No-op if
  // nothing moved. Runs the shared collision gate via commitWallObjectEdit
  // (identical warnings/label/error).
  //
  // `heightMm` is the OPTIONAL new hang height, and its absence is the plan
  // view's case: plan has no notion of height, so an object dragged there
  // carries its own yMm across a wall change untouched. The 3D drag DOES move
  // in both wall axes at once, so it passes one — reusing this handler rather
  // than growing a parallel one, because everything else about the commit
  // (open-wall refusal, shared-opening partner sync, pair normalization, the
  // wall-context write) is identical whichever surface asked for the move.
  async function planMoveWithinWalls(
    project: Project,
    wallObject: WallObject,
    placement: Extract<PlanPlacement, { anchor: "wall" }>,
    allowOverlap: boolean,
    heightMm?: number
  ): Promise<void> {
    const nextYMm = heightMm ?? wallObject.yMm;
    if (
      wallObject.wallId === placement.wallId &&
      wallObject.xMm === placement.xMm &&
      wallObject.yMm === nextYMm
    ) {
      return;
    }
    // Re-anchoring onto an open wall is refused the same as creating there.
    if (refuseOpenWall(project, placement.wallId)) return;

    const movedWallObjects = project.wallObjects.map((object) =>
      object.id === wallObject.id
        ? { ...object, wallId: placement.wallId, xMm: placement.xMm, yMm: nextYMm }
        : object
    );

    let draftWallObjects = movedWallObjects;
    let validateIds = [wallObject.id];

    // A plan drag of one half of a shared opening drags the other half with
    // it — the pair is one physical hole and cannot be dragged apart. The
    // classification reads the PRE-EDIT project and runs BEFORE
    // normalizeOpeningPairs, so a repair that would sever the pair can never
    // pre-empt the refusal below. A plan drag carries no hang height, so the
    // twin follows at the moved half's existing yMm (cf. movePlanObjectsGroup).
    if (
      (wallObject.kind === "door" || wallObject.kind === "window") &&
      wallObject.connectsToObjectId !== undefined
    ) {
      const synced = syncPartnerMove(
        project,
        movedWallObjects,
        wallObject,
        placement.xMm,
        nextYMm,
        placement.wallId
      );
      if (synced.status === "blocked") {
        set({ error: sharedOpeningRefusalMessage(synced.reason) });
        return;
      }
      // Only `synced` — deliberately NOT appliedPartnerSync. This path never
      // mirrored anything before, so honouring a legacy pair's best-effort
      // draft here would be a NEW behaviour for plan dragging, not a
      // preserved one. Legacy best-effort belongs to the two direct-edit
      // paths that already had it.
      if (synced.status === "synced") {
        draftWallObjects = synced.nextWallObjects;
        validateIds = [wallObject.id, synced.partnerId];
      }
    }

    // A wallId rewrite can invalidate a shared-wall pairing (the moved half is
    // no longer on its partner's coincident twin face). Normalize the FINISHED
    // draft, so the repair never reads a half-applied batch, and let it ride
    // the same commit — one undo step covers the move and the disconnect.
    const nextWallObjects = normalizeOpeningPairs({
      ...project,
      wallObjects: draftWallObjects
    }).project.wallObjects;

    await commitWallObjectEdit(
      `Move ${moveObjectNoun(wallObject.kind)}`,
      project,
      nextWallObjects,
      validateIds,
      allowOverlap,
      {
        // Both walls: a re-anchoring drag leaves one boundary and joins
        // another, and each side needs reconciling.
        ...(isOpeningKind(wallObject.kind)
          ? { reconcileWallIds: [wallObject.wallId, placement.wallId] }
          : {}),
        // The wall the drag ends on becomes the elevation view's wall
        // context, same as a checklist drop — including a same-wall nudge,
        // where this is a harmless no-op (destination equals the current
        // context). Selection itself is untouched: the object stays
        // selected exactly as it was mid-drag.
        extras: selectionWrite(project, get().selection, placement.wallId)
      }
    );
  }

  // The footprint depth a hung work takes on once it is standing on the floor:
  // an explicitly overridden depth, else the work's own recorded depth, else
  // the editable default. Extracted because setArtworkPlacementForm needs the
  // SAME number planMoveWallToFloor is about to commit — it offsets the new
  // floor position by depth/2 to stand the work's back flat against the wall
  // face, and an offset computed from a different depth would leave the object
  // hovering off the wall or sunk into it.
  function floorDepthForWallArtwork(wallObject: ArtworkWallObject): number {
    const artwork = get().libraryArtworks.find(
      (candidate) => candidate.id === wallObject.artworkId
    );
    return (
      wallObject.displayDimensionsOverride?.depthMm ??
      artwork?.dimensions.depthMm ??
      DEFAULT_FLOOR_OBJECT_DEPTH_MM
    );
  }

  // wall → floor conversion. Doors/windows must never leave a wall (throws).
  // No collision gate: floor objects get no bounds/collision validation in v1
  // (see placeArtworkOnFloor), so this keeps its own gate-free applyEdit.
  async function planMoveWallToFloor(
    project: Project,
    wallObject: WallObject,
    placement: Extract<PlanPlacement, { anchor: "floor" }>
  ): Promise<void> {
    if (wallObject.kind !== "artwork" && wallObject.kind !== "blocked-zone") {
      throw new Error(
        `A ${wallObject.kind} cannot be moved onto the floor. It must stay on a wall.`
      );
    }

    // Preserve the wall's floor-space angle so the freed object keeps
    // its orientation at the moment of release (0 if the wall vanished).
    const sourceWall = getFloorWalls(project.floor).find(
      (candidate) => candidate.id === wallObject.wallId
    );
    const wallAngleDeg = sourceWall ? (sourceWall.angleRad * 180) / Math.PI : 0;

    // Floor-only state stashed when this object was captured onto a wall (see
    // FloorMemory in domain/project.ts). Absent for an object that has always
    // lived on a wall, which is the whole basis of the rotation rule below.
    const floorMemory = wallObject.floorMemory;

    // Two writers, one field, and the tie-break is about PROVENANCE, not
    // precedence. Wall-angle inheritance is right for a first-ever wall→floor
    // conversion: a work coming off a wall should face the way that wall
    // faced, and it has no authored plan angle of its own to fall back on. It
    // is wrong for a return trip: the wall the object is leaving is one it was
    // captured onto by a stray drag, so inheriting that wall's angle would let
    // an accident overwrite an angle the curator actually chose. A remembered
    // angle therefore wins, and only ever exists when the object came from the
    // floor in the first place.
    //
    // `??`, not `||`: a remembered 0° is a real authored angle — a floor
    // graphic squared to the grid — and must beat the wall's angle exactly as
    // a remembered 45° does.
    const rotationDeg = floorMemory?.rotationDeg ?? wallAngleDeg;

    const base = {
      id: wallObject.id,
      xMm: placement.xMm,
      yMm: placement.yMm,
      widthMm: wallObject.widthMm,
      rotationDeg,
      heightMm: wallObject.heightMm,
      // Remember the hang height so a later floor→wall conversion can
      // restore it.
      wallYMm: wallObject.yMm,
      // Restore suspension, keeping absent absent — see the write side in
      // planMoveFloorToWall. Nothing on a wall can edit this value (there is
      // no wall-side notion of a bottom edge above the floor), so the memory
      // cannot have gone stale while the object was up there; restoring it
      // verbatim is the only reading available and the only one that makes a
      // mis-drag reversible.
      ...(floorMemory?.baseHeightMm !== undefined
        ? { baseHeightMm: floorMemory.baseHeightMm }
        : {})
    };

    let newFloorObject: FloorObject;
    if (wallObject.kind === "artwork") {
      // A monitor work coming down onto the floor re-seeds the CABINET's
      // geometry rather than inheriting the flat wall plane's width/height
      // and a nominal depth — the wall placement was a plain image (the
      // intent-wins drop law lets a monitor work hang), and standing it up
      // means standing up the equipment. Same size source as
      // placeArtworkOnFloor, so both routes onto the floor agree.
      const monitorArtwork = get().libraryArtworks.find(
        (candidate) => candidate.id === wallObject.artworkId
      );
      const monitorSizeMm = isMonitorArtwork(monitorArtwork)
        ? monitorBoxSizeMm(monitorArtwork?.dimensions)
        : undefined;

      // The floor support and the monitor's pedestal choice, coming back out of
      // the memory slot they were parked in at capture. Same absent-vs-present
      // rule as imageFaces above: a work that never stood on anything must not
      // acquire a support key here.
      //
      // The support is re-normalised against the dimensions the work is
      // landing with, NOT restored verbatim: unlike baseHeightMm (which nothing
      // on a wall can edit, so its memory cannot go stale), the work's own
      // width/height ARE editable up there — and a monitor's cabinet is
      // re-seeded on the way down — so a pedestal captured around a 400mm work
      // would otherwise come back holding a 900mm one over its edges. The
      // normaliser is idempotent, so an unchanged work restores its support
      // unchanged.
      const restoredMonitorSupport = wallObject.floorMemory?.monitorSupport;
      const rememberedSupport = wallObject.floorMemory?.support;
      const restoredDepthMm =
        monitorSizeMm?.depthMm ?? floorDepthForWallArtwork(wallObject);
      const restoredSupport = rememberedSupport
        ? normalizeFloorSupport(
            {
              widthMm: monitorSizeMm?.widthMm ?? base.widthMm,
              depthMm: restoredDepthMm,
              heightMm: monitorSizeMm?.heightMm ?? base.heightMm
            },
            rememberedSupport
          ).support
        : undefined;

      newFloorObject = {
        ...base,
        ...(monitorSizeMm
          ? {
              widthMm: monitorSizeMm.widthMm,
              heightMm: monitorSizeMm.heightMm
            }
          : {}),
        kind: "artwork",
        artworkId: wallObject.artworkId,
        // `!== undefined` and a copy, mirroring the write side: an empty
        // array means "every face deliberately off" and must come back empty,
        // never collapsing to absent (which would resurrect the front+back
        // default and quietly rewrite a curatorial choice).
        ...(wallObject.floorMemory?.imageFaces !== undefined
          ? { imageFaces: [...wallObject.floorMemory.imageFaces] }
          : {}),
        ...(restoredMonitorSupport !== undefined
          ? { monitorSupport: restoredMonitorSupport }
          : {}),
        ...(restoredSupport !== undefined ? { support: restoredSupport } : {}),
        depthMm: restoredDepthMm,
        ...(wallObject.displayDimensionsOverride
          ? { displayDimensionsOverride: wallObject.displayDimensionsOverride }
          : {})
      };
    } else {
      newFloorObject = {
        ...base,
        kind: "blocked-zone",
        depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
      };
    }

    // Selection survives for free: the id is preserved, and the
    // selection slots store the id (openings) / artworkId (artworks),
    // neither of which changes here.
    await applyEdit(
      `Move ${moveObjectNoun(wallObject.kind)}`,
      (current) => ({
        ...current,
        wallObjects: current.wallObjects.filter((object) => object.id !== wallObject.id),
        floorObjects: [...current.floorObjects, newFloorObject]
      })
    );
  }

  // floor → floor slide. No-op if nothing moved. No collision gate (floor
  // objects are unvalidated in v1), so it keeps its own applyEdit.
  async function planMoveFloorToFloor(
    project: Project,
    floorObject: FloorObject,
    placement: Extract<PlanPlacement, { anchor: "floor" }>
  ): Promise<void> {
    if (floorObject.xMm === placement.xMm && floorObject.yMm === placement.yMm) {
      return;
    }

    const nextFloorObjects = project.floorObjects.map((object) =>
      object.id === floorObject.id
        ? { ...object, xMm: placement.xMm, yMm: placement.yMm }
        : object
    );

    await applyEdit(`Move ${moveObjectNoun(floorObject.kind)}`, (current) => ({
      ...current,
      floorObjects: nextFloorObjects
    }));
  }

  // floor → wall conversion: restore the remembered hang height and
  // elevation height, reconstruct the kind-specific wall fields, then run the
  // shared collision gate via commitWallObjectEdit (identical to the old
  // inline validate+gate+applyEdit — `current === project` at commit time, so
  // the precomputed nextFloorObjects filter matches the old current-based one).
  async function planMoveFloorToWall(
    project: Project,
    floorObject: FloorObject,
    placement: Extract<PlanPlacement, { anchor: "wall" }>,
    allowOverlap: boolean
  ): Promise<void> {
    // Cases never convert between wall and floor (that machinery is
    // artwork-specific): a floor case that captures a wall must not become a
    // wall object. Refuse the conversion — the case stays on the floor.
    if (floorObject.kind === "case") {
      throw new Error("A display case cannot be moved onto a wall.");
    }
    // Floor → wall conversion is a creation on that wall, so it obeys the
    // same rule.
    if (refuseOpenWall(project, placement.wallId)) return;

    const base = {
      id: floorObject.id,
      wallId: placement.wallId,
      xMm: placement.xMm,
      yMm: floorObject.wallYMm,
      widthMm: floorObject.widthMm,
      heightMm: floorObject.heightMm
    };

    // The floor-only half of the object, parked for the trip. Absence
    // discipline, the unconditional rotationDeg marker and the staleness
    // decision are all documented on FloorMemory in domain/project.ts:295-330.
    const floorMemory: FloorMemory = {
      rotationDeg: floorObject.rotationDeg,
      ...(floorObject.baseHeightMm !== undefined
        ? { baseHeightMm: floorObject.baseHeightMm }
        : {})
    };

    let newWallObject: WallObject;
    if (floorObject.kind === "artwork") {
      // `!== undefined`, deliberately not a truthiness test: `imageFaces: []`
      // is a real curatorial state ("every face off") that is DIFFERENT from
      // absent ("never chosen", meaning front+back), and both must survive
      // verbatim. The array is copied so the memory can never alias the live
      // array held by an undo snapshot.
      const artworkFloorMemory: ArtworkFloorMemory = {
        ...floorMemory,
        ...(floorObject.imageFaces !== undefined
          ? { imageFaces: [...floorObject.imageFaces] }
          : {}),
        // The pedestal/plinth the work was standing on, and the monitor's own
        // absent-means-pedestal choice, parked under the same discipline: a
        // support is a sized, curator-authored object, and a mis-drag onto a
        // wall must not be the thing that deletes it. Copied rather than
        // aliased for the same reason imageFaces is — the memory must not share
        // an object with the live placement an undo snapshot still holds.
        ...(floorObject.support !== undefined
          ? { support: { ...floorObject.support } }
          : {}),
        ...(floorObject.monitorSupport !== undefined
          ? { monitorSupport: floorObject.monitorSupport }
          : {})
      };
      newWallObject = {
        ...base,
        kind: "artwork",
        artworkId: floorObject.artworkId,
        floorMemory: artworkFloorMemory,
        ...(floorObject.displayDimensionsOverride
          ? { displayDimensionsOverride: floorObject.displayDimensionsOverride }
          : {})
      };
    } else {
      newWallObject = {
        ...base,
        kind: "blocked-zone",
        blocksPlacement: true,
        floorMemory
      };
    }

    const nextWallObjects = [...project.wallObjects, newWallObject];
    const nextFloorObjects = project.floorObjects.filter(
      (object) => object.id !== floorObject.id
    );

    await commitWallObjectEdit(
      `Move ${moveObjectNoun(floorObject.kind)}`,
      project,
      nextWallObjects,
      [floorObject.id],
      allowOverlap,
      {
        nextFloorObjects,
        // Landing on a wall makes it the elevation view's wall context,
        // same as a checklist drop. Selection is preserved as-is.
        extras: selectionWrite(project, get().selection, placement.wallId)
      }
    );
  }

  // Synchronous all-or-nothing batch commit. Persistence stays caller-owned
  // because arrange settling must finish state changes before awaiting.
  function commitWallObjectMoves(
    moves: { id: string; xMm: number; yMm: number }[],
    label: string | ((movedCount: number) => string),
    allowOverlap: boolean,
    extras: EditExtras = {}
  ):
    | { status: "committed"; project: Project }
    | { status: "no-op" }
    | { status: "blocked" } {
    const project = get().project;
    if (!project) return { status: "no-op" };

    // A stale id (a member removed since the group was selected, e.g. by an
    // undo) is filtered out rather than treated as an error — the rest of
    // the group still moves.
    const applicable = moves.filter((move) =>
      project.wallObjects.some((wallObject) => wallObject.id === move.id)
    );
    if (applicable.length === 0) return { status: "no-op" };

    const moveById = new Map(applicable.map((move) => [move.id, move]));
    const movedIds: string[] = [];
    const nextWallObjects = project.wallObjects.map((wallObject) => {
      const move = moveById.get(wallObject.id);
      if (!move || (wallObject.xMm === move.xMm && wallObject.yMm === move.yMm)) {
        return wallObject;
      }
      movedIds.push(wallObject.id);
      return { ...wallObject, xMm: move.xMm, yMm: move.yMm };
    });
    if (movedIds.length === 0) return { status: "no-op" };

    // Shared openings survive a batch as one opening or not at all: one half
    // in the batch drags the other, both halves in the batch are validated
    // against the finished draft. Classified pre-edit, and a refusal blocks
    // the whole batch — the same all-or-nothing rule as a collision.
    const paired = syncMovedPairHalves(project, nextWallObjects, movedIds);
    if (paired.status === "blocked") {
      set({ error: sharedOpeningRefusalMessage(paired.reason) });
      return { status: "blocked" };
    }

    // Reconcile the batch's own architecture before the gate, scoped to the
    // walls it touched, so a created twin is validated with everything else.
    const touchedOpeningWallIds = project.wallObjects
      .filter((object) => movedIds.includes(object.id) && isOpeningKind(object.kind))
      .map((object) => object.wallId);
    const reconciled =
      touchedOpeningWallIds.length > 0
        ? reconcileSharedOpenings(project, paired.nextWallObjects, touchedOpeningWallIds)
        : { wallObjects: paired.nextWallObjects, validateIds: [] };

    // One collision blocks the entire batch.
    const placementWarnings = gatePlacementWarnings(
      project,
      reconciled.wallObjects,
      [...movedIds, ...paired.validateIds, ...reconciled.validateIds],
      allowOverlap
    );
    if (placementWarnings === null) return { status: "blocked" };

    const after = {
      ...project,
      wallObjects: reconciled.wallObjects,
      updatedAt: new Date().toISOString()
    };
    const resolvedLabel = typeof label === "function" ? label(movedIds.length) : label;
    pushEditEntry(
      { label: resolvedLabel, project: { before: project, after } },
      { placementWarnings, ...extras }
    );
    return { status: "committed", project: after };
  }

  const openingActions = createOpeningPlacementSlice({
    set,
    get,
    internals,
    commitWallObjectEdit,
    refuseOpenWall
  });

  const actions: PlacementSliceActions = {
    ...openingActions,
    async placeArtwork(artworkId, wallId, xMm, yMm, allowOverlap = false) {
      const project = get().project;
      if (!project) return;

      const artwork = get().libraryArtworks.find((candidate) => candidate.id === artworkId);
      if (!artwork) return;
      if (!getProjectWalls(project).some((wall) => wall.id === wallId)) return;
      if (refuseOpenWall(project, wallId)) return;

      const alreadyPlaced =
        project.wallObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId) ||
        project.floorObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId);
      if (alreadyPlaced) {
        set({ error: ALREADY_PLACED_MESSAGE });
        return;
      }

      const aspect = await loadArtworkAspect(artwork);
      const placement = createArtworkPlacement(artwork, wallId, xMm, yMm, aspect);
      const nextWallObjects = [...project.wallObjects, placement];

      await commitWallObjectEdit(
        "Place artwork",
        project,
        nextWallObjects,
        [placement.id],
        allowOverlap,
        {
          // Replace selection with the new placement, and make the wall it
          // was placed on the elevation view's wall context so toggling to
          // elevation shows this wall.
          extras: selectionWrite(
            { ...project, wallObjects: nextWallObjects },
            { kind: "objects", ids: [placement.id] },
            wallId
          )
        }
      );
    },

    async moveArtworkPlacement(wallObjectId, xMm, yMm, allowOverlap = false) {
      const project = get().project;
      if (!project) return;

      const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
      if (!target || (target.xMm === xMm && target.yMm === yMm)) return;

      const nextWallObjects = project.wallObjects.map((wallObject) =>
        wallObject.id === wallObjectId ? { ...wallObject, xMm, yMm } : wallObject
      );

      // The UI previews the drag locally and calls this exactly once on
      // release (docs/plan.md §7) — one call here is already one undo
      // entry, nothing extra to batch.
      await commitWallObjectEdit(
        "Move artwork",
        project,
        nextWallObjects,
        [wallObjectId],
        allowOverlap
      );
    },

    async moveWallObjectPlacement(wallObjectId, wallId, xMm, yMm, allowOverlap = false) {
      const project = get().project;
      if (!project) return;

      const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
      if (!target) return;

      // Same contract as moveArtworkPlacement: the UI previews the drag
      // locally and calls this exactly once on release, so one call here is
      // already one undo entry.
      await planMoveWithinWalls(project, target, { anchor: "wall", wallId, xMm }, allowOverlap, yMm);
    },

    async removePlacement(wallObjectId) {
      const project = get().project;
      if (!project) return;
      const isWallObject = project.wallObjects.some(
        (wallObject) => wallObject.id === wallObjectId
      );
      const isFloorObject = project.floorObjects.some(
        (floorObject) => floorObject.id === wallObjectId
      );
      if (!isWallObject && !isFloorObject) return;

      // Removes the placement only — checklist membership is a separate
      // concept (docs/plan.md §4.1) and is untouched here. Generic over
      // object kind, so this same action deletes an opening or a
      // floor-placed object too (ids are unique across both arrays) —
      // there's no checklist-membership concept to preserve for those.
      //
      // Shared-wall full-sync delete (spec §5.5): removing a paired
      // door/window removes its twin in the same commit, so the two rooms
      // never diverge. (Deleting a whole ROOM only disconnects the neighbor's
      // opening — that cascade is elsewhere and deliberately unchanged.)
      // clearOpeningPartners still clears any other surviving partner's
      // connectsToObjectId that pointed at a removed opening, so no dangling
      // pairing ref persists.
      const removedIds = includePairedOpenings(project.wallObjects, [wallObjectId]);

      const nextProject: Project = {
        ...project,
        wallObjects: clearOpeningPartners(
          project.wallObjects.filter((wallObject) => !removedIds.has(wallObject.id)),
          removedIds
        ),
        floorObjects: project.floorObjects.filter((floorObject) => !removedIds.has(floorObject.id))
      };

      await applyEdit("Remove from wall", () => nextProject);
    },

    async placeArtworkOnFloor(artworkId, xMm, yMm) {
      const project = get().project;
      if (!project) return;

      const artwork = get().libraryArtworks.find((candidate) => candidate.id === artworkId);
      if (!artwork) return;

      const alreadyPlaced =
        project.wallObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId) ||
        project.floorObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId);
      if (alreadyPlaced) {
        set({ error: ALREADY_PLACED_MESSAGE });
        return;
      }

      // A box monitor's floor object is the CABINET, not the work: a 4:3 face
      // scaled off whatever the work records, MONITOR_DEPTH_MM deep. It
      // deliberately does NOT take the flat-artwork path — the image's own
      // aspect and depth describe the video, not the equipment playing it.
      // (The pedestal is not part of this height; it is added by the
      // renderers from monitorSupport — see CrtMonitorMesh.)
      const isMonitor = isMonitorArtwork(artwork);
      const aspect = isMonitor ? undefined : await loadArtworkAspect(artwork);
      const { widthMm, heightMm, depthMm } = isMonitor
        ? monitorBoxSizeMm(artwork.dimensions)
        : {
            ...getEffectivePlacementSizeMm(artwork.dimensions, aspect),
            // A floor-standing work's real depth if known, else a squarish
            // footprint off its width, else the editable default (see
            // effectiveFloorDepthMm — shared with plan/3D rendering).
            depthMm: effectiveFloorDepthMm(artwork.dimensions)
          };
      const floorObject: ArtworkFloorObject = {
        id: newId(),
        kind: "artwork",
        artworkId,
        xMm,
        yMm,
        widthMm,
        depthMm,
        rotationDeg: 0,
        heightMm,
        // Remembered hang-height center for a later floor→wall conversion.
        wallYMm: project.defaultCenterlineHeightMm
      };

      // Floor objects get no bounds/collision validation in v1 (no wall
      // bounds; 2-D footprint collision is a v2 candidate) — an empty
      // validate-ids list keeps the shared gate a no-op here.
      await commitWallObjectEdit(
        "Place artwork",
        project,
        project.wallObjects,
        [],
        true,
        {
          nextFloorObjects: [...project.floorObjects, floorObject],
          // Replace selection with the new floor placement.
          extras: selectionWrite(
            { ...project, floorObjects: [...project.floorObjects, floorObject] },
            { kind: "objects", ids: [floorObject.id] },
            get().wallContextId
          )
        }
      );
    },

    async setArtworkPlacementForm(artworkId, form, allowOverlap = false) {
      const project = get().project;
      if (!project) return;

      const wallObject = project.wallObjects.find(
        (object): object is ArtworkWallObject =>
          object.kind === "artwork" && object.artworkId === artworkId
      );
      const floorObject = project.floorObjects.find(
        (object): object is ArtworkFloorObject =>
          object.kind === "artwork" && object.artworkId === artworkId
      );

      // Unplaced: there is no placement to convert, so the library flag is the
      // whole answer — it is what the inspector reads back, and what the work
      // is understood to be until it lands somewhere. It no longer decides
      // where a checklist drop may land: that follows the drop point on both
      // surfaces now (floatPolicyForKind), so the flag is a default, not a
      // gate.
      if (!wallObject && !floorObject) {
        await get().updateArtwork(artworkId, { placementForm: form });
        return;
      }

      // --- wall → floor ---------------------------------------------------
      if (wallObject) {
        if (form === "wall") return;

        const wall = getFloorWalls(project.floor).find(
          (candidate) => candidate.id === wallObject.wallId
        );
        if (!wall) {
          set({
            error: "Can’t stand it on the floor. The wall it hangs on can’t be found."
          });
          return;
        }

        // Land it where it already is: same point along the wall, shifted off
        // the centerline into the room by half its own footprint depth, so the
        // work's back sits flat against the wall face it just left. That is
        // what getWallObjectPlanRect's offsetToViewerSide computes, and the
        // depth it is given has to be the depth planMoveWallToFloor commits —
        // hence the shared floorDepthForWallArtwork.
        //
        // The flatness is best-effort, not a guarantee: planMoveWallToFloor
        // prefers a REMEMBERED plan angle over the wall's own when the work
        // has been on the floor before, and an offset derived from the wall's
        // angle no longer squares the object's back to the wall once it turns
        // to face 45°. Accepted deliberately — this is a starting point the
        // curator drags, not a placement anyone should have to accept.
        const planRect = getWallObjectPlanRect(
          wall,
          wallObject,
          floorDepthForWallArtwork(wallObject),
          true
        );
        await planMoveWallToFloor(project, wallObject, {
          anchor: "floor",
          xMm: planRect.centerXMm,
          yMm: planRect.centerYMm
        });
        return;
      }

      // --- floor → wall ---------------------------------------------------
      if (!floorObject) return; // unreachable — narrows the type below.
      if (form === "floor") return;

      // Placeable walls only: an open wall has no surface to hang on, so it
      // must not even be a candidate for "nearest".
      const walls = getPlaceableFloorWalls(project.floor);
      const nearest = findNearestWall(
        { xMm: floorObject.xMm, yMm: floorObject.yMm },
        walls,
        // No distance limit. Unlike a plan drag — where the capture radius is
        // what tells a deliberate wall grab apart from a slide past one — this
        // is an explicit request to hang the work, and refusing it because the
        // work happens to stand mid-room would be inexplicable.
        Number.POSITIVE_INFINITY
      );
      if (!nearest) {
        set({ error: "Can’t hang it. There’s no wall here it can hang on." });
        return;
      }

      const wall = walls.find((candidate) => candidate.id === nearest.wallId);
      if (!wall) return; // unreachable — findNearestWall only reports these walls.

      // Same clamp resolveOnWall applies to a plan drag (planSnapTargets.ts):
      // keep the work's full width on the wall, and centre it when the wall is
      // shorter than the work and there is no valid range at all. Without it a
      // work standing near a corner would hang half off the end of the wall.
      const halfWidthMm = floorObject.widthMm / 2;
      const maxXMm = wall.lengthMm - halfWidthMm;
      const xMm =
        maxXMm < halfWidthMm
          ? wall.lengthMm / 2
          : clamp(nearest.xAlongMm, halfWidthMm, maxXMm);

      await planMoveFloorToWall(
        project,
        floorObject,
        { anchor: "wall", wallId: nearest.wallId, xMm },
        allowOverlap
      );
    },

    async placeCaseFromPlan(placement) {
      const project = get().project;
      if (!project) return;

      // Wall anchor → wall case; floor anchor → freestanding floor case. Both
      // ride the shared commit path (floor objects and cases carry no wall
      // bounds/collision to validate in v1, so an empty validate-ids list
      // keeps the gate a no-op) and select the new object.
      if (placement.anchor === "wall") {
        if (refuseOpenWall(project, placement.wallId)) return;
        const wallCase = createWallCase(placement.wallId, placement.xMm);
        const nextWallObjects = [...project.wallObjects, wallCase];
        await commitWallObjectEdit("Add display case", project, nextWallObjects, [], true, {
          extras: selectionWrite(
            { ...project, wallObjects: nextWallObjects },
            { kind: "objects", ids: [wallCase.id] },
            get().wallContextId
          )
        });
        return;
      }

      const floorCase = createFloorCase(placement.xMm, placement.yMm);
      await commitWallObjectEdit("Add display case", project, project.wallObjects, [], true, {
        nextFloorObjects: [...project.floorObjects, floorCase],
        extras: selectionWrite(
          { ...project, floorObjects: [...project.floorObjects, floorCase] },
          { kind: "objects", ids: [floorCase.id] },
          get().wallContextId
        )
      });
    },

    // The inspector-side counterpart to placeCaseFromPlan: with a wall already
    // selected there is no click point to classify, so this only ever makes
    // the hung kind (a freestanding case has no wall to belong to — it stays
    // a plan-tool placement). Hangs at the wall's midpoint at the default
    // mount height. Cases never block or pair, so — as in placeCaseFromPlan —
    // there is nothing to validate.
    async addWallCase(wallId) {
      const project = get().project;
      if (!project) return;

      const wall = getProjectWalls(project).find((candidate) => candidate.id === wallId);
      if (!wall) return;
      if (refuseOpenWall(project, wallId)) return;

      const wallCase = createWallCase(wallId, wall.lengthMm / 2);
      const nextWallObjects = [...project.wallObjects, wallCase];
      await commitWallObjectEdit("Add display case", project, nextWallObjects, [], true, {
        extras: selectionWrite(
          { ...project, wallObjects: nextWallObjects },
          { kind: "objects", ids: [wallCase.id] },
          get().wallContextId
        )
      });
    },

    async updateWallCase(wallObjectId, changes) {
      const project = get().project;
      if (!project) return;

      const target = project.wallObjects.find((object) => object.id === wallObjectId);
      if (!target || target.kind !== "case") return;

      const keys = ["xMm", "yMm", "widthMm", "heightMm", "depthMm"] as const;
      const hasChange = keys.some(
        (key) => changes[key] !== undefined && changes[key] !== target[key]
      );
      if (!hasChange) return;

      const nextWallObjects = project.wallObjects.map((object) =>
        object.id === wallObjectId && object.kind === "case"
          ? { ...object, ...changes }
          : object
      );

      // Cases never block placement and never pair, so there is nothing to
      // mirror; the collision gate still runs (a case can overlap other wall
      // objects, treated blocked-zone-style) via the shared commit path.
      await commitWallObjectEdit(
        "Edit display case",
        project,
        nextWallObjects,
        [wallObjectId],
        true
      );
    },

    async commitPlanMove(objectId, placement, allowOverlap = false) {
      const project = get().project;
      if (!project) return;

      const wallObject = project.wallObjects.find((object) => object.id === objectId);
      const floorObject = project.floorObjects.find((object) => object.id === objectId);
      if (!wallObject && !floorObject) return;

      // Classify the drag by source (wall/floor object) × target
      // (placement.anchor) and delegate to the matching case handler.

      // --- Source: wall object -------------------------------------------
      if (wallObject) {
        if (placement.anchor === "wall") {
          await planMoveWithinWalls(project, wallObject, placement, allowOverlap);
          return;
        }
        await planMoveWallToFloor(project, wallObject, placement);
        return;
      }

      // --- Source: floor object ------------------------------------------
      if (!floorObject) return; // unreachable — narrows the type below.

      if (placement.anchor === "floor") {
        await planMoveFloorToFloor(project, floorObject, placement);
        return;
      }

      await planMoveFloorToWall(project, floorObject, placement, allowOverlap);
    },

    // A direct group drag with no active session: one "Move N objects" undo
    // entry via the shared commit path. (When a session is active the drag
    // routes into setArrangeSessionPreview instead — see App.tsx.)
    async moveWallObjectsGroup(moves, allowOverlap = false) {
      const result = commitWallObjectMoves(
        moves,
        (count) => `Move ${count} objects`,
        allowOverlap
      );
      if (result.status === "committed") await persist(result.project);
    },

    async movePlanObjectsGroup(moves, allowOverlap = false) {
      const project = get().project;
      if (!project) return;

      const wallMoveById = new Map(
        moves
          .filter((move) => project.wallObjects.some((wallObject) => wallObject.id === move.id))
          .map((move) => [move.id, move])
      );
      const floorMoveById = new Map(
        moves
          .filter((move) =>
            project.floorObjects.some((floorObject) => floorObject.id === move.id)
          )
          .map((move) => [move.id, move])
      );
      if (wallMoveById.size === 0 && floorMoveById.size === 0) return;

      // A group drag can re-anchor several members onto a foreign wall at
      // once. Refuse the whole move if ANY member would land on an open wall
      // — committing the legal half would silently split the group apart.
      for (const move of wallMoveById.values()) {
        if (move.wallId && refuseOpenWall(project, move.wallId)) return;
      }

      const movedWallIds: string[] = [];
      const nextWallObjects = project.wallObjects.map((wallObject) => {
        const move = wallMoveById.get(wallObject.id);
        if (!move) return wallObject;
        // A move.wallId re-anchors an artwork member onto a different wall
        // (group drag onto a foreign wall); absent, the member slides along
        // its own wall. Either way the hang height and size carry over
        // unchanged — the plan view has no notion of hang height, so yMm (if
        // present on the move) is ignored — mirroring commitPlanMove's
        // wall→wall branch. The collision gate below validates the new wall.
        const nextWallId = move.wallId ?? wallObject.wallId;
        if (wallObject.wallId === nextWallId && wallObject.xMm === move.xMm) return wallObject;
        movedWallIds.push(wallObject.id);
        return { ...wallObject, wallId: nextWallId, xMm: move.xMm };
      });

      const movedFloorIds: string[] = [];
      const nextFloorObjects = project.floorObjects.map((floorObject) => {
        const move = floorMoveById.get(floorObject.id);
        if (!move) return floorObject;
        const yMm = move.yMm ?? floorObject.yMm;
        if (floorObject.xMm === move.xMm && floorObject.yMm === yMm) return floorObject;
        movedFloorIds.push(floorObject.id);
        return { ...floorObject, xMm: move.xMm, yMm };
      });

      if (movedWallIds.length === 0 && movedFloorIds.length === 0) return;

      // Shared openings first, against the pre-edit classification and the
      // COMPLETED draft: one half in the batch drags its twin, both halves in
      // the batch are validated to still be one aligned opening on the same
      // boundary. This runs BEFORE normalization so a severing repair cannot
      // pre-empt the refusal.
      const paired = syncMovedPairHalves(project, nextWallObjects, movedWallIds);
      if (paired.status === "blocked") {
        set({ error: sharedOpeningRefusalMessage(paired.reason) });
        return;
      }

      // One normalization pass over the COMPLETED draft. Doing it per-object
      // inside the map above would be order-dependent: the first twin's move
      // would be judged against the second twin's not-yet-applied wall and
      // sever a pair that the finished batch leaves perfectly valid (dragging
      // both halves onto a new shared wall together must keep them paired).
      const pairedWallObjects = normalizeOpeningPairs({
        ...project,
        wallObjects: paired.nextWallObjects
      }).project.wallObjects;

      // Floor objects get no bounds/collision validation in v1 (see
      // placeArtworkOnFloor) — only the wall-anchored members are checked.
      // The label counts what the USER moved; a twin dragged along is still
      // validated, so it joins validateIds without inflating the count.
      // Reconcile the batch too: a group drag can carry an UNPAIRED opening
      // onto (or off) a shared boundary just as a single drag can, and this
      // path commits through the same gate. Both the pre-edit and post-edit
      // walls of every moved opening are in scope, because a re-anchor
      // leaves one boundary and joins another.
      const movedOpeningWallIds = [
        ...new Set(
          [...project.wallObjects, ...pairedWallObjects]
            .filter((object) => movedWallIds.includes(object.id) && isOpeningKind(object.kind))
            .map((object) => object.wallId)
        )
      ];

      await commitWallObjectEdit(
        `Move ${movedWallIds.length + movedFloorIds.length} objects`,
        project,
        pairedWallObjects,
        [...movedWallIds, ...paired.validateIds],
        allowOverlap,
        {
          nextFloorObjects,
          ...(movedOpeningWallIds.length > 0
            ? { reconcileWallIds: movedOpeningWallIds }
            : {})
        }
      );
    },

    async removeSelectedPlacements() {
      const project = get().project;
      const selectedIds = objectIdsOf(get().selection);
      if (!project || selectedIds.length === 0) return;

      const idSet = new Set(selectedIds);
      const removedCount =
        project.wallObjects.filter((wallObject) => idSet.has(wallObject.id)).length +
        project.floorObjects.filter((floorObject) => idSet.has(floorObject.id)).length;
      if (removedCount === 0) return;

      const label = removedCount === 1 ? "Remove 1 object" : `Remove ${removedCount} objects`;

      // Keyboard and multi-selection deletion obey the same shared-wall
      // full-sync contract as removePlacement: selecting either face removes
      // both stored halves of a paired door/window in this one commit. Keep
      // the label based on the user's selected objects; mirrored twins are a
      // storage detail rather than an additional selected object.
      const removedIds = includePairedOpenings(project.wallObjects, idSet);
      const nextProject: Project = {
        ...project,
        wallObjects: clearOpeningPartners(
          project.wallObjects.filter((wallObject) => !removedIds.has(wallObject.id)),
          removedIds
        ),
        floorObjects: project.floorObjects.filter(
          (floorObject) => !removedIds.has(floorObject.id)
        )
      };

      await applyEdit(
        label,
        () => nextProject,
        selectionWrite(project, NO_SELECTION, get().wallContextId)
      );
    },
  };

  return { actions, commitWallObjectEdit, commitWallObjectMoves };
}
