import { parseFaceWallId } from "../../domain/geometry/freestandingWalls";
import { areSharedBoundaryWalls, sameDoorLeaf } from "../../domain/geometry/sharedWalls";
import { newId } from "../../domain/id";
import {
  getDefaultOpeningCenterYMm,
  getDefaultOpeningSizeMm,
  type InsertToolKind
} from "../../domain/placement/createOpening";
import {
  createWallTextPlacement,
  WALL_TEXT_DEFAULT_NAME
} from "../../domain/placement/createWallText";
import {
  FIT_EPSILON_MM,
  fitOpeningOnWall,
  getOpeningLegalSpan,
  type OpeningFit
} from "../../domain/placement/fitOpeningOnWall";
import { withDoorLeaf } from "../../domain/placement/sharedOpeningAnalysis";
import {
  type BlockedZoneFloorObject,
  type ConnectableOpeningWallObject,
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type DoorLeaf,
  type Project,
  type WallObject
} from "../../domain/project";
import type { PlanPlacement } from "../../domain/snapping/planSnapTargets";
import { getProjectWalls } from "../projectWalls";
import type { AppState } from "../store";
import {
  appliedPartnerSync,
  buildOpeningOnWall,
  defaultDoorLeaf,
  moveObjectNoun,
  openingNoun,
  resolveFreeOpeningXMm,
  resolvePairedOpeningSpan,
  syncPartnerLeaf,
  syncPartnerMove,
  syncPartnerResize
} from "./openingEdits";
import type { CommitWallObjectEdit, PlacementSliceInternals } from "./placementSlice";
import { sharedOpeningRefusalMessage } from "./placementMessages";
import { selectionWrite } from "./selectionSlice";

export type OpeningPlacementSliceActions = {
  addOpening: (wallId: string, kind: InsertToolKind) => Promise<void>;
  // Both return how the request was adjusted to stay on the wall, so the
  // inspector can say what it did ("Moved 2' 6\" to fit the wall."), or null
  // when there was nothing to report at all (no such object, no resolvable
  // wall). A REFUSED request still returns a fit — one carrying noMutualSpan or
  // partnerBlocked — describing the state that was kept rather than a committed
  // change; nothing is written and no undo entry is pushed. See fitOpeningOnWall.
  moveOpening: (
    wallObjectId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<OpeningFit | null>;
  resizeOpening: (
    wallObjectId: string,
    widthMm: number,
    heightMm: number,
    allowOverlap?: boolean
  ) => Promise<OpeningFit | null>;
  // Widen an opening to fill the legal span it currently sits in — bounded by
  // its same-wall neighbours, else the wall's ends. Widens in place; never
  // relocates the opening to a larger gap elsewhere on the wall.
  fitOpeningToAvailableSpan: (wallObjectId: string) => Promise<OpeningFit | null>;
  // Turn a doorway into a hinged door, change its handing, or turn it back.
  //
  // `undefined` clears the leaf (back to a plain doorway). A PARTIAL leaf fills
  // its missing flags from the door's current handing, or — for a doorway
  // becoming hinged — from the geometry-derived default (hinge at the nearer
  // wall end, swinging toward the room interior). That is the one place room
  // interior is consulted, and it lives here because this is where floor
  // geometry is available; the stored flags are wall-local from then on.
  // So: `{}` = "make it hinged, you pick"; `{ hingeAtStart: x }` = "flip the
  // hinge, leave the swing".
  //
  // Mirrors onto the far half only across a REAL shared boundary — see
  // syncPartnerLeaf. One undo step covers both halves.
  updateDoorLeaf: (
    wallObjectId: string,
    leaf: Partial<DoorLeaf> | undefined
  ) => Promise<void>;
  // Rename a wall text (the only editable field it carries). An empty/blank
  // name resets it to the default label.
  renameWallText: (wallObjectId: string, name: string) => Promise<void>;
  // The two Insert-cluster placement paths accept the widened InsertToolKind:
  // wall text is armed and placed here alongside openings, then branches to its
  // own (non-pairing, non-blocking) constructor at the creation step.
  placeOpeningFromPlan: (kind: InsertToolKind, placement: PlanPlacement) => Promise<void>;
  placeOpeningOnElevation: (
    kind: InsertToolKind,
    wallId: string,
    xMm: number,
    yMm: number
  ) => Promise<void>;
};

export type OpeningPlacementContext = {
  set: (partial: Partial<AppState>) => void;
  get: () => AppState;
  internals: PlacementSliceInternals;
  commitWallObjectEdit: CommitWallObjectEdit;
  refuseOpenWall: (project: Project, wallId: string) => boolean;
};

export function createOpeningPlacementSlice(
  ctx: OpeningPlacementContext
): OpeningPlacementSliceActions {
  const { set, get, internals, commitWallObjectEdit, refuseOpenWall } = ctx;
  const { applyEdit } = internals;

  // The legal span an opening may occupy on its wall, or null when its wall
  // can't be resolved. Bounded by same-wall neighbours, else the wall's ends.
  function resolveOpeningSpan(project: Project, target: WallObject) {
    const wall = getProjectWalls(project).find((candidate) => candidate.id === target.wallId);
    if (!wall) return null;

    const sameWallObjects = project.wallObjects.filter(
      (object) => object.wallId === target.wallId
    );
    return getOpeningLegalSpan(target, sameWallObjects, wall.lengthMm);
  }

  // Resolve a requested width/position for `target`. Returns null when the
  // wall can't be resolved, in which case callers commit the raw request
  // unchanged (the pre-existing behaviour).
  //
  // `bounds` decides what the request is fitted against:
  //   "free-span" — the run between same-wall neighbours. For WIDTH, where a
  //     neighbour-aware result is collision-free by construction, so a widen
  //     never has to be rejected.
  //   "wall" — the wall's own ends only. For MOVES, which must keep their
  //     existing contract: an opening dragged onto another opening is BLOCKED
  //     (opening x opening is forbidden and unoverridable), not quietly slid
  //     flush against it. Clamping here only stops a typed X from leaving the
  //     wall entirely; collisions stay the commit gate's decision.
  function fitOpeningForRequest(
    project: Project,
    target: WallObject,
    requestedWidthMm: number,
    currentXMm: number,
    bounds: "free-span" | "wall"
  ): OpeningFit | null {
    const wall = getProjectWalls(project).find((candidate) => candidate.id === target.wallId);
    if (!wall) return null;

    const span =
      bounds === "wall"
        ? { spanStartMm: 0, spanEndMm: wall.lengthMm, boundedByNeighbor: false }
        : resolveOpeningSpan(project, target);
    if (!span) return null;

    return fitOpeningOnWall({
      requestedWidthMm,
      currentXMm,
      spanStartMm: span.spanStartMm,
      spanEndMm: span.spanEndMm,
      constraintSource: span.boundedByNeighbor ? "neighbor" : "wall"
    });
  }

  return {
    async addOpening(wallId, kind) {
      const project = get().project;
      if (!project) return;

      const wall = getProjectWalls(project).find((candidate) => candidate.id === wallId);
      if (!wall) return;
      if (refuseOpenWall(project, wallId)) return;

      // Wall text starts at the wall's midpoint on the centerline — same
      // landing spot as placeOpeningFromPlan's wall-text branch, and no
      // free-slot search since it never blocks or pairs.
      if (kind === "wall-text") {
        const centerlineYMm =
          wall.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
        const wallText = createWallTextPlacement(wallId, wall.lengthMm / 2, centerlineYMm);
        const nextWallObjects = [...project.wallObjects, wallText];
        await commitWallObjectEdit("Add wall text", project, nextWallObjects, [wallText.id], true, {
          extras: selectionWrite(
            { ...project, wallObjects: nextWallObjects },
            { kind: "objects", ids: [wallText.id] },
            get().wallContextId
          )
        });
        return;
      }

      // Display cases are never added through this opening path — the plan
      // tool routes through placeCaseFromPlan and the wall inspector through
      // addCaseToWall, since each decides wall vs floor differently. Guarding
      // here also narrows `kind` to OpeningKind for the opening builders below.
      if (kind === "case") {
        throw new Error("Display cases are placed via placeCaseFromPlan or addCaseToWall.");
      }

      // Doors/windows can't be placed on a partition face in v1 (spec §2/§6.1);
      // blocked zones can. This guard backs up the plan tool's candidate filter.
      if (kind !== "blocked-zone" && parseFaceWallId(wallId) !== null) {
        set({ error: "Doors and windows can't be placed on a partition." });
        return;
      }

      // Start near center but never create a forbidden opening overlap.
      const xMm = resolveFreeOpeningXMm(project, wall, kind, wall.lengthMm / 2);
      if (xMm === null) {
        set({ error: "There isn’t room for another opening on this wall." });
        return;
      }

      // buildOpeningWithMirror is shared with placeOpeningFromPlan, whose only
      // difference is the chosen xMm (the plan drop point vs. wall center). It
      // also mirrors the opening onto a coincident twin wall in the same array
      // when the wall is shared between two rooms (spec §5.5).
      // Append the primary only. Mirroring onto a shared wall is
      // reconciliation's job now (opted in below via reconcileWallIds), so
      // creation and every later geometry edit build the twin the same way —
      // the old builder sized it from the kind's DEFAULTS while the analyzer
      // copies the primary's actual width, height and hang height.
      const primary = buildOpeningOnWall(project, wall, kind, xMm);
      const nextWallObjects = [...project.wallObjects, primary];
      const primaryId = primary.id;
      const validateIds = [primaryId];

      // Adding an opening is never blocked by a collision (there's no
      // allowOverlap knob for it) — allowOverlap: true skips the gate while
      // still surfacing the warning via placementWarnings.
      await commitWallObjectEdit(
        `Add ${openingNoun(kind)}`,
        project,
        nextWallObjects,
        validateIds,
        true,
        {
          reconcileWallIds: [wall.id],
          // Select only the primary; a mirrored twin is created silently.
          extras: selectionWrite(
            { ...project, wallObjects: nextWallObjects },
            { kind: "objects", ids: [primaryId] },
            get().wallContextId
          )
        }
      );
    },

    async moveOpening(wallObjectId, xMm, yMm, allowOverlap = false) {
      const project = get().project;
      if (!project) return null;

      const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
      if (!target || target.kind === "artwork") return null;

      // Doors must sit on the floorline (center at height/2).
      const clampedYMm = target.kind === "door" ? target.heightMm / 2 : yMm;

      // Keep the opening on its wall. The numeric X field used to commit
      // whatever was typed, so X = 50' on a 12' wall left a door off the wall
      // entirely; the drag path has always clamped (resolveOnWall).
      const raw = fitOpeningForRequest(project, target, target.widthMm, xMm, "wall");
      // A move must never resize: an opening already wider than its span
      // keeps its width and simply centres.
      const fit: OpeningFit | null = raw
        ? { ...raw, widthMm: target.widthMm, requestedWidthMm: target.widthMm, widthClamped: false }
        : null;
      const nextXMm = fit ? fit.xMm : xMm;

      if (target.xMm === nextXMm && target.yMm === clampedYMm) return fit;

      let nextWallObjects = project.wallObjects.map((wallObject) =>
        wallObject.id === wallObjectId
          ? { ...wallObject, xMm: nextXMm, yMm: clampedYMm }
          : wallObject
      );
      let validateIds = [wallObjectId];

      // Shared-wall sync: a paired door/window drags its twin in the same
      // commit so the two rooms stay aligned (spec §5.5). The pair is
      // classified against the PRE-EDIT project — a live shared pair either
      // moves together or the move fails; a legacy pair across walls that
      // never faced each other may still drift, exactly as before.
      if (
        (target.kind === "door" || target.kind === "window") &&
        target.connectsToObjectId !== undefined
      ) {
        const synced = syncPartnerMove(project, nextWallObjects, target, nextXMm, clampedYMm);
        if (synced.status === "blocked") {
          // Same shape as the noMutualSpan refusal below: nothing committed,
          // no undo entry, and the request reported so the inspector can say
          // why it did not happen.
          set({ error: sharedOpeningRefusalMessage(synced.reason) });
          return {
            requestedWidthMm: target.widthMm,
            widthMm: target.widthMm,
            xMm: target.xMm,
            widthClamped: false,
            positionAdjusted: false,
            movedByMm: 0,
            constraint: "none",
            partnerBlocked: true
          };
        }
        const applied = appliedPartnerSync(synced);
        if (applied) {
          nextWallObjects = applied.nextWallObjects;
          validateIds = [wallObjectId, applied.partnerId];
        }
      }

      // Same shape as moveArtworkPlacement: the UI previews the drag
      // locally and calls this exactly once on release.
      await commitWallObjectEdit(
        `Move ${moveObjectNoun(target.kind)}`,
        project,
        nextWallObjects,
        validateIds,
        allowOverlap,
        { reconcileWallIds: [target.wallId] }
      );
      return fit;
    },

    async fitOpeningToAvailableSpan(wallObjectId) {
      const project = get().project;
      if (!project) return null;

      const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
      if (!target || target.kind === "artwork") return null;

      const span = resolveOpeningSpan(project, target);
      if (!span) return null;

      // Request the whole span; the shared fit path clamps it to exactly the
      // available width and positions it, so this needs no geometry of its own.
      // That also means a refusal (noMutualSpan / partnerBlocked) is returned
      // verbatim rather than swallowed: "Fit wall" on half a shared opening
      // whose twin cannot follow commits nothing and reports why.
      return get().resizeOpening(
        wallObjectId,
        span.spanEndMm - span.spanStartMm,
        target.heightMm
      );
    },

    async resizeOpening(wallObjectId, widthMm, heightMm, allowOverlap = false) {
      const project = get().project;
      if (!project) return null;

      const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
      if (!target || target.kind === "artwork") return null;

      // Keep the requested width whenever it fits somewhere on the wall,
      // sliding the opening the minimum distance to make room; reduce it only
      // when it cannot fit at all. See fitOpeningOnWall.
      //
      // A PAIRED opening is one physical hole through one wall, so it is
      // solved ONCE against the run both faces share — never fitted per face
      // and reconciled, which would let the two halves settle at locally
      // valid but physically different centres.
      const partner =
        (target.kind === "door" || target.kind === "window") &&
        target.connectsToObjectId !== undefined
          ? project.wallObjects.find((object) => object.id === target.connectsToObjectId)
          : undefined;
      // Only a REAL shared boundary is solved as one hole. A legacy pair on
      // unrelated walls has no meaningful mutual run — perpendicular walls
      // project to a zero-length one — and solving it that way would refuse
      // the resize with noMutualSpan before the non-refusing legacy branch
      // was ever reached. Legacy pairs keep their own-wall fit.
      const pairedSpan =
        partner &&
        (partner.kind === "door" || partner.kind === "window") &&
        areSharedBoundaryWalls(project, target.wallId, partner.wallId)
          ? resolvePairedOpeningSpan(
              project,
              target as ConnectableOpeningWallObject,
              partner
            )
          : null;

      const fit = pairedSpan
        ? fitOpeningOnWall({
            requestedWidthMm: widthMm,
            currentXMm: target.xMm,
            spanStartMm: pairedSpan.spanStartMm,
            spanEndMm: pairedSpan.spanEndMm,
            constraintSource: pairedSpan.constraintSource
          })
        : fitOpeningForRequest(project, target, widthMm, target.xMm, "free-span");

      // No run the two faces share: half a shared opening cannot move without
      // the other half, so report rather than desynchronise them.
      if (pairedSpan && pairedSpan.spanEndMm - pairedSpan.spanStartMm < FIT_EPSILON_MM) {
        return {
          requestedWidthMm: widthMm,
          widthMm: target.widthMm,
          xMm: target.xMm,
          widthClamped: false,
          positionAdjusted: false,
          movedByMm: 0,
          constraint: pairedSpan.constraintSource,
          noMutualSpan: true
        };
      }

      const nextWidthMm = fit ? fit.widthMm : widthMm;
      const nextXMm = fit ? fit.xMm : target.xMm;

      // For doors, recompute yMm so the bottom stays on the floor when height changes.
      const updatedYMm = target.kind === "door" ? heightMm / 2 : target.yMm;

      // Re-requesting a width that clamps to what the opening already has is a
      // no-op: report the adjustment so the field can explain itself, but do
      // not stack an undo entry for a document that did not change.
      if (
        target.widthMm === nextWidthMm &&
        target.heightMm === heightMm &&
        target.xMm === nextXMm
      ) {
        return fit;
      }

      let nextWallObjects = project.wallObjects.map((wallObject) =>
        wallObject.id === wallObjectId
          ? { ...wallObject, widthMm: nextWidthMm, heightMm, xMm: nextXMm, yMm: updatedYMm }
          : wallObject
      );
      let validateIds = [wallObjectId];

      // Shared-wall sync: mirror the new size onto a paired twin in the same
      // commit (spec §5.5). Classified against the PRE-EDIT project, so a
      // live shared pair resizes as one opening or not at all; a legacy pair
      // keeps its old freedom to diverge.
      if (
        (target.kind === "door" || target.kind === "window") &&
        target.connectsToObjectId !== undefined
      ) {
        const synced = syncPartnerResize(
          project,
          nextWallObjects,
          target,
          nextWidthMm,
          heightMm,
          nextXMm,
          updatedYMm
        );
        if (synced.status === "blocked") {
          set({ error: sharedOpeningRefusalMessage(synced.reason) });
          return {
            requestedWidthMm: widthMm,
            widthMm: target.widthMm,
            xMm: target.xMm,
            widthClamped: false,
            positionAdjusted: false,
            movedByMm: 0,
            constraint: pairedSpan ? pairedSpan.constraintSource : "none",
            partnerBlocked: true
          };
        }
        const applied = appliedPartnerSync(synced);
        if (applied) {
          nextWallObjects = applied.nextWallObjects;
          validateIds = [wallObjectId, applied.partnerId];
        }
      }

      await commitWallObjectEdit(
        `Resize ${moveObjectNoun(target.kind)}`,
        project,
        nextWallObjects,
        validateIds,
        allowOverlap,
        { reconcileWallIds: [target.wallId] }
      );
      return fit;
    },

    async renameWallText(wallObjectId, name) {
      const project = get().project;
      if (!project) return;
      const target = project.wallObjects.find((object) => object.id === wallObjectId);
      if (!target || target.kind !== "wall-text") return;

      const trimmed = name.trim();
      const nextName = trimmed.length > 0 ? trimmed : WALL_TEXT_DEFAULT_NAME;
      if ((target.name ?? WALL_TEXT_DEFAULT_NAME) === nextName) return;

      await applyEdit("Rename wall text", (current) => ({
        ...current,
        wallObjects: current.wallObjects.map((object) =>
          object.id === wallObjectId && object.kind === "wall-text"
            ? { ...object, name: nextName }
            : object
        )
      }));
    },

    async placeOpeningFromPlan(kind, placement) {
      const project = get().project;
      if (!project) return;

      // Wall text is placed here alongside openings but is wall-only and
      // never pairs/mirrors, so it takes its own simple path: land at the
      // clicked wall x, centered on the wall's centerline.
      if (kind === "wall-text") {
        if (placement.anchor !== "wall") {
          throw new Error("Wall text can only be placed on a wall.");
        }
        const wall = getProjectWalls(project).find(
          (candidate) => candidate.id === placement.wallId
        );
        if (!wall) return;
        const centerlineYMm =
          wall.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
        const wallText = createWallTextPlacement(placement.wallId, placement.xMm, centerlineYMm);
        const nextWallObjects = [...project.wallObjects, wallText];
        await commitWallObjectEdit("Add wall text", project, nextWallObjects, [wallText.id], true, {
          extras: selectionWrite(
            { ...project, wallObjects: nextWallObjects },
            { kind: "objects", ids: [wallText.id] },
            get().wallContextId
          )
        });
        return;
      }

      // Display cases have their own plan placement action; guarding here keeps
      // them off the opening builders and narrows `kind` to OpeningKind.
      if (kind === "case") {
        throw new Error("Display cases are placed via placeCaseFromPlan, not placeOpeningFromPlan.");
      }

      if (placement.anchor === "floor") {
        // Only blocked zones can float. Doors and windows are excluded from
        // floor placement by the domain (FloorObject has no door/window
        // kind) and resolve under the "capture-any" float policy, so a
        // door/window landing here is an invariant break, not a user path —
        // fail loudly.
        if (kind !== "blocked-zone") {
          throw new Error(
            `Cannot place a ${kind} on the floor. Only blocked zones can be floor-placed.`
          );
        }

        const { widthMm, heightMm } = getDefaultOpeningSizeMm(kind);
        const floorObject: BlockedZoneFloorObject = {
          id: newId(),
          kind: "blocked-zone",
          xMm: placement.xMm,
          yMm: placement.yMm,
          widthMm,
          depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM,
          rotationDeg: 0,
          heightMm,
          // Remembered hang-height for a later floor→wall conversion: the
          // same centerline default the object would take on a wall.
          wallYMm: getDefaultOpeningCenterYMm(kind, heightMm, project.defaultCenterlineHeightMm)
        };

        // No wallObjects change here, so an empty validate-ids list is a
        // trivial no-collision pass (see gatePlacementWarnings) — this just
        // rides the shared commit path for the floorObjects append + select.
        await commitWallObjectEdit(
          `Add ${openingNoun(kind)}`,
          project,
          project.wallObjects,
          [],
          true,
          {
            nextFloorObjects: [...project.floorObjects, floorObject],
            extras: selectionWrite(
              { ...project, floorObjects: [...project.floorObjects, floorObject] },
              { kind: "objects", ids: [floorObject.id] },
              get().wallContextId
            )
          }
        );
        return;
      }

      // Wall placement: identical to addOpening, but at the plan-chosen xMm
      // rather than the wall center.
      const wall = getProjectWalls(project).find((candidate) => candidate.id === placement.wallId);
      if (!wall) return;
      if (refuseOpenWall(project, placement.wallId)) return;

      // Doors/windows can't land on a partition face in v1 (spec §2/§6.1).
      if (kind !== "blocked-zone" && parseFaceWallId(placement.wallId) !== null) {
        set({ error: "Doors and windows can't be placed on a partition." });
        return;
      }

      // Slide to the nearest free slot; refuse when no legal slot exists.
      const xMm = resolveFreeOpeningXMm(project, wall, kind, placement.xMm);
      if (xMm === null) {
        set({ error: "There isn’t room for another opening on this wall." });
        return;
      }

      // Same shared-wall mirroring as addOpening (spec §5.5): a twin wall gets
      // a paired opening in the same single commit.
      // Append the primary only. Mirroring onto a shared wall is
      // reconciliation's job now (opted in below via reconcileWallIds), so
      // creation and every later geometry edit build the twin the same way —
      // the old builder sized it from the kind's DEFAULTS while the analyzer
      // copies the primary's actual width, height and hang height.
      const primary = buildOpeningOnWall(project, wall, kind, xMm);
      const nextWallObjects = [...project.wallObjects, primary];
      const primaryId = primary.id;
      const validateIds = [primaryId];

      // Same as addOpening: never blocked by a collision.
      await commitWallObjectEdit(
        `Add ${openingNoun(kind)}`,
        project,
        nextWallObjects,
        validateIds,
        true,
        {
          reconcileWallIds: [wall.id],
          extras: selectionWrite(
            { ...project, wallObjects: nextWallObjects },
            { kind: "objects", ids: [primaryId] },
            get().wallContextId
          )
        }
      );
    },

    async placeOpeningOnElevation(kind, wallId, xMm, yMm) {
      const project = get().project;
      if (!project) return;

      const wall = getProjectWalls(project).find((candidate) => candidate.id === wallId);
      if (!wall) return;
      if (refuseOpenWall(project, wallId)) return;

      // Wall text lands at the clicked point (the elevation resolver already
      // keeps the pointer on the wall). It never pairs, mirrors, or blocks, so
      // it skips the opening free-slot search and takes the pointer's y.
      if (kind === "wall-text") {
        const wallText = createWallTextPlacement(wallId, xMm, yMm);
        const nextWallObjects = [...project.wallObjects, wallText];
        await commitWallObjectEdit("Add wall text", project, nextWallObjects, [wallText.id], true, {
          extras: selectionWrite(
            { ...project, wallObjects: nextWallObjects },
            { kind: "objects", ids: [wallText.id] },
            get().wallContextId
          )
        });
        return;
      }

      // Display cases are plan-only (they never reach the elevation canvas);
      // guarding here narrows `kind` to OpeningKind for the builders below.
      if (kind === "case") {
        throw new Error("Display cases cannot be placed from elevation.");
      }

      // Doors and windows remain disallowed on partition faces in elevation,
      // matching the plan insertion rules. Blocked zones are annotations and
      // can be placed on either face.
      if (kind !== "blocked-zone" && parseFaceWallId(wallId) !== null) {
        set({ error: "Doors and windows can’t be placed on a partition." });
        return;
      }

      // The elevation resolver already keeps the pointer inside the wall,
      // but preserve the creation-time opening-overlap guard here as well so
      // imported callers and future surfaces cannot create forbidden opening
      // pairs by bypassing the canvas.
      const xCenterMm = resolveFreeOpeningXMm(project, wall, kind, xMm, yMm);
      if (xCenterMm === null) {
        set({ error: "There isn’t room for another opening on this wall." });
        return;
      }

      // Doors must sit on the floorline (bottom edge at y=0, center at height/2).
      const resolvedYMm = kind === "door" ? undefined : yMm;

      const primary = buildOpeningOnWall(project, wall, kind, xCenterMm, resolvedYMm);
      const nextWallObjects = [...project.wallObjects, primary];
      const primaryId = primary.id;
      const validateIds = [primaryId];

      await commitWallObjectEdit(
        `Add ${openingNoun(kind)}`,
        project,
        nextWallObjects,
        validateIds,
        true,
        {
          reconcileWallIds: [wall.id],
          extras: selectionWrite(
            { ...project, wallObjects: nextWallObjects },
            { kind: "objects", ids: [primaryId] },
            get().wallContextId
          )
        }
      );
    },

    async updateDoorLeaf(wallObjectId, leaf) {
      const project = get().project;
      if (!project) return;

      const target = project.wallObjects.find((object) => object.id === wallObjectId);
      if (!target || target.kind !== "door") return;

      // A partial fills from the door's CURRENT handing when it already has
      // one, and only falls back to the derived default when it does not —
      // so "flip the hinge" cannot silently reset the swing to the default.
      const nextLeaf: DoorLeaf | undefined =
        leaf === undefined
          ? undefined
          : { ...(target.leaf ?? defaultDoorLeaf(project, target)), ...leaf };
      if (sameDoorLeaf(target.leaf, nextLeaf)) return;

      const edited = project.wallObjects.map((object) =>
        object.id === wallObjectId && object.kind === "door"
          ? withDoorLeaf(object, nextLeaf)
          : object
      );
      const nextWallObjects = syncPartnerLeaf(project, edited, target, nextLeaf);

      // Nothing to validate and nothing to gate: hinging changes no
      // footprint, so no placement can newly collide. Hence the empty
      // validateIds — and no reconcileWallIds either, since this says nothing
      // about where a room's boundaries are.
      await commitWallObjectEdit("Edit door", project, nextWallObjects, [], true);
    }
  };
}

