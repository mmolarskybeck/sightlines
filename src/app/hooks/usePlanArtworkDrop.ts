import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type RefObject
} from "react";
import type { Vector2 } from "../../domain/geometry/dragResize";
import type { FloorWall } from "../../domain/geometry/planObjects";
import { roomIdContainingPoint } from "../../domain/geometry/freestandingWalls";
import { getArtworkOuterDimensionsMm } from "../../domain/framing";
import {
  effectiveFloorDepthMm,
  effectiveWallArtworkDepthMm
} from "../../domain/placement/artworkForm";
import {
  getEffectivePlacementSizeMm,
  PLACEHOLDER_ARTWORK_HEIGHT_MM,
  PLACEHOLDER_ARTWORK_WIDTH_MM
} from "../../domain/placement/placeArtwork";
import {
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type Project,
  type WallObjectBase
} from "../../domain/project";
import { floatPolicyForKind, resolvePlanPlacement } from "../../domain/snapping/planSnapTargets";
import type { SnapTargetIds } from "../../domain/snapping/resolveSnap";
import {
  ARTWORK_DRAG_MIME,
  consumeArtworkDragSession,
  peekArtworkDragSession,
  subscribeArtworkTouchDrag
} from "../components/library/artworkDragSession";
import type { DropGhostState } from "../components/plan/types";
import { useArtworkAspect } from "./useArtworkAspect";

// The artwork HTML5 drag/drop + touch-drop cluster, lifted out of PlanView
// verbatim. It owns the transient drop-ghost state and snap hysteresis, loads
// the dragged artwork's aspect, and subscribes to the module-level touch-drag
// session. The DOM handlers and dropGhost the JSX renders are the whole surface
// it hands back. It no longer reads a work's library placementForm at all: a
// drop floats exactly like a move, so the wall under the cursor (or the absence
// of one) is what decides whether the work hangs or stands (see
// floatPolicyForKind).
export function usePlanArtworkDrop(options: {
  artworksById: Map<string, Artwork> | undefined;
  draggingArtworkId: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
  toSvgMm: (clientX: number, clientY: number) => Vector2 | null;
  project: Project;
  floorWallsForTool: FloorWall[];
  snappingWallObjects: WallObjectBase[];
  floorObjectRoomIds: ReadonlyMap<string, string | null>;
  captureDistanceMm: number;
  gridSnapTargets: Parameters<typeof resolvePlanPlacement>[1]["gridTargets"];
  snapToGrid: boolean;
  snapThresholdMm: number;
  onPlaceArtwork: ((artworkId: string, wallId: string, xMm: number, yMm: number) => void) | undefined;
  onPlaceArtworkOnFloor: ((artworkId: string, xMm: number, yMm: number) => void) | undefined;
}) {
  const {
    artworksById,
    draggingArtworkId,
    containerRef,
    toSvgMm,
    project,
    floorWallsForTool,
    snappingWallObjects,
    floorObjectRoomIds,
    captureDistanceMm,
    gridSnapTargets,
    snapToGrid,
    snapThresholdMm,
    onPlaceArtwork,
    onPlaceArtworkOnFloor
  } = options;

  const [dropGhost, setDropGhost] = useState<DropGhostState | null>(null);
  const dropSnapTargetIdsRef = useRef<SnapTargetIds | undefined>(undefined);

  // The dragged artwork's image aspect, so a partial/unknown-dimension work's
  // drop preview is sized at its true proportions (matching what placeArtwork
  // bakes) instead of the raw placeholder box. Only the currently-dragged
  // artwork is loaded, keyed off draggingArtworkId's asset.
  const draggingArtworkAspect = useArtworkAspect(
    draggingArtworkId ? artworksById?.get(draggingArtworkId)?.assetId : undefined
  );

  // The effective footprint of an artwork being dragged from the checklist:
  // its real size if we know which one (draggingArtworkId), otherwise the same
  // placeholder placement itself falls back to. BOTH footprints are always
  // resolved, because the drop now floats in both directions (USER DECISION —
  // intent wins) and only the RESOLVED anchor knows which one to read: the wall
  // stage takes wallFootprintWidthMm/wallFootprintDepthMm (framing widens the
  // work, deep works protrude, flat works keep the nominal band), the floor
  // stage takes movingSize's widthMm/depthMm. Gating either footprint on the
  // library placementForm — as this did before — left a floor work with no wall
  // footprint the moment it hovered a wall, and a wall work's ghost keeping the
  // nominal 150mm band once it stood on open floor.
  function effectiveArtworkDims(artworkId: string | null): {
    widthMm: number;
    heightMm: number;
    depthMm: number;
    wallFootprintWidthMm?: number;
    wallFootprintDepthMm?: number;
  } {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    if (artwork) {
      // The aspect only applies to the artwork we actually loaded it for.
      const aspect = artworkId === draggingArtworkId ? draggingArtworkAspect : undefined;
      const { widthMm, heightMm } = getEffectivePlacementSizeMm(artwork.dimensions, aspect);
      // Framing is WALL-ONLY geometry (docs/framing-dimension-contract.md §3,
      // Phase 6b), which is why the outer width travels in its own field and
      // never in movingSize: only resolveOnWall reads it. The floor stage keeps
      // the image width, so the frame band can never reach
      // effectiveFloorDepthMm's width fallback and land on the depth axis, which
      // it has no physical relationship to.
      const wallFootprintWidthMm = getArtworkOuterDimensionsMm(
        widthMm,
        heightMm,
        artwork.matWidthMm,
        artwork.frame
      ).widthMm;
      return {
        widthMm,
        heightMm,
        wallFootprintWidthMm,
        // A checklist drag has no placement yet, so no displayDimensionsOverride
        // — the record's own depth is the only source. Undefined for flat works,
        // which keeps the drop ghost at the nominal band; a depth-bearing work
        // hovering a wall previews (and places as) the supported deep-wall work.
        wallFootprintDepthMm: effectiveWallArtworkDepthMm({}, artwork),
        // Floor footprint depth for a floor drop — shared with the store commit
        // and 3D via effectiveFloorDepthMm (depth → width → default, so a flat
        // work standing on the floor still gets a real footprint); ignored by
        // the wall stage.
        depthMm: effectiveFloorDepthMm(artwork.dimensions)
      };
    }
    return {
      widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM,
      heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM,
      depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
    };
  }

  function resolveArtworkDrop(
    pointerMm: Vector2,
    dims: ReturnType<typeof effectiveArtworkDims>,
    // ⌘/Ctrl (mouse) or an explicit request bypasses snapping/quantization:
    // kill the grid tier and drop the neighbor threshold to zero so the point
    // lands exactly under the pointer. Touch drags pass false — they have no
    // modifier and read best fully snapped.
    bypassSnap: boolean
  ) {
    const roomId = roomIdContainingPoint(project, pointerMm);
    return resolvePlanPlacement(pointerMm, {
      walls: floorWallsForTool,
      wallObjects: snappingWallObjects,
      movingSize: dims,
      wallFootprintWidthMm: dims.wallFootprintWidthMm,
      wallFootprintDepthMm: dims.wallFootprintDepthMm,
      movingKind: "artwork",
      // "float": a wall in capture range takes the work, otherwise it lands on
      // open floor — the same policy a MOVE of an already-placed work uses, so
      // the drop and the drag that follows it behave identically. The library
      // placementForm is not consulted at all (see floatPolicyForKind).
      floatPolicy: floatPolicyForKind("artwork"),
      currentAnchorWallId: null,
      captureDistanceMm,
      gridTargets: gridSnapTargets,
      snapToGrid: bypassSnap ? false : snapToGrid,
      thresholdMm: bypassSnap ? 0 : snapThresholdMm,
      previousSnapTargetIds: dropSnapTargetIdsRef.current,
      // Not yet placed — nothing to exclude, just filter to the room under the
      // pointer.
      floorAlign: {
        roomId,
        floorObjects: project.floorObjects.filter(
          (object) => floorObjectRoomIds.get(object.id) === roomId
        )
      }
    });
  }

  // Shared by the HTML5 dragover handler and the touch-drag subscription: given
  // client coordinates and the artwork being dragged, resolve the placement and
  // paint the drop ghost. Assumes the caller has already gated on an active
  // drag; it always draws (the drop target is known to be under the pointer).
  function updateArtworkDropGhost(
    clientX: number,
    clientY: number,
    artworkId: string | null,
    bypassSnap: boolean
  ) {
    const pointerMm = toSvgMm(clientX, clientY);
    if (!pointerMm) return;

    const result = resolveArtworkDrop(pointerMm, effectiveArtworkDims(artworkId), bypassSnap);
    dropSnapTargetIdsRef.current = result.snapTargetIds;
    setDropGhost({
      planRect: result.planRect,
      placement: result.placement,
      activeGuides: result.activeGuides
    });
  }

  function clearArtworkDropGhost() {
    setDropGhost(null);
    dropSnapTargetIdsRef.current = undefined;
  }

  // Shared by the HTML5 drop handler and the touch-drag subscription: commit
  // the placement. Caller has already resolved and validated the artworkId.
  function completeArtworkDrop(
    clientX: number,
    clientY: number,
    artworkId: string,
    bypassSnap: boolean
  ) {
    const pointerMm = toSvgMm(clientX, clientY);
    if (!pointerMm) return;

    const placement = resolveArtworkDrop(pointerMm, effectiveArtworkDims(artworkId), bypassSnap)
      .placement;
    // Where it was dropped decides what it becomes, for any work: no wall in
    // capture range → it stands on the floor via placeArtworkOnFloor, whatever
    // the library form said. The form flag is deliberately NOT written here —
    // App derives the effective type from where the object actually lives, and
    // writing it would cost a second undo step (same precedent as
    // setArtworkPlacementForm's conversion).
    if (placement.anchor === "floor") {
      onPlaceArtworkOnFloor?.(artworkId, placement.xMm, placement.yMm);
      return;
    }
    // `anchor: "none"` no longer occurs for an artwork drop (the policy above
    // floats), but the arm is still the type's, so it stays a no-op rather than
    // an assumption.
    if (placement.anchor !== "wall") return;
    const wall = floorWallsForTool.find((candidate) => candidate.id === placement.wallId);
    // A wall-dropped artwork hangs at the wall's centerline (its own default,
    // or the project default) — plan view chooses no y itself.
    const yMm = wall?.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
    onPlaceArtwork?.(artworkId, placement.wallId, placement.xMm, yMm);
  }

  function handleArtworkDragOver(event: ReactDragEvent<HTMLDivElement>) {
    // iPadOS Safari hides custom MIME types during dragover/drop, so fall back
    // to the app-level drag state (draggingArtworkId), and further to the
    // module-level drag session for when WebKit's event ordering leaves that
    // state already cleared by the time dragover/drop fires.
    if (
      !event.dataTransfer.types.includes(ARTWORK_DRAG_MIME) &&
      !draggingArtworkId &&
      !peekArtworkDragSession()
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    updateArtworkDropGhost(
      event.clientX,
      event.clientY,
      draggingArtworkId,
      event.metaKey || event.ctrlKey
    );
  }

  function handleArtworkDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    // Only clear when the pointer actually leaves the surface, not when it
    // crosses between child elements (which also fire dragleave).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    clearArtworkDropGhost();
  }

  function handleArtworkDrop(event: ReactDragEvent<HTMLDivElement>) {
    const artworkId =
      event.dataTransfer.getData(ARTWORK_DRAG_MIME) || draggingArtworkId || peekArtworkDragSession();
    consumeArtworkDragSession();
    clearArtworkDropGhost();
    if (!artworkId) return;
    if (!artworksById?.get(artworkId)) return;
    event.preventDefault();
    completeArtworkDrop(event.clientX, event.clientY, artworkId, event.metaKey || event.ctrlKey);
  }

  // The touch/pen drag path (iOS/iPadOS, where HTML5 DnD is unavailable/
  // unreliable) reaches the drop target through the module-level session rather
  // than DOM drag events. The handlers close over live state/props, so route
  // them through a ref refreshed each render and subscribe once — re-running the
  // subscription on every render would churn the shared listener Set.
  const touchDropRef = useRef({
    updateGhost: updateArtworkDropGhost,
    complete: completeArtworkDrop,
    clearGhost: clearArtworkDropGhost,
    isValidArtwork: (id: string) => Boolean(artworksById?.get(id))
  });
  touchDropRef.current = {
    updateGhost: updateArtworkDropGhost,
    complete: completeArtworkDrop,
    clearGhost: clearArtworkDropGhost,
    isValidArtwork: (id: string) => Boolean(artworksById?.get(id))
  };

  useEffect(() => {
    return subscribeArtworkTouchDrag((dragEvent) => {
      const container = containerRef.current;
      const handlers = touchDropRef.current;
      if (!container) return;
      if (dragEvent.type === "cancel") {
        handlers.clearGhost();
        return;
      }
      const rect = container.getBoundingClientRect();
      const inside =
        dragEvent.clientX >= rect.left &&
        dragEvent.clientX <= rect.right &&
        dragEvent.clientY >= rect.top &&
        dragEvent.clientY <= rect.bottom;
      if (dragEvent.type === "move") {
        // Touch has no modifier keys, so never bypass snapping.
        if (inside) handlers.updateGhost(dragEvent.clientX, dragEvent.clientY, dragEvent.artworkId, false);
        else handlers.clearGhost();
        return;
      }
      // drop: always clear the ghost; place only if it landed inside and the id
      // still resolves to a known artwork (mirrors the HTML5 drop guard).
      handlers.clearGhost();
      if (inside && handlers.isValidArtwork(dragEvent.artworkId)) {
        handlers.complete(dragEvent.clientX, dragEvent.clientY, dragEvent.artworkId, false);
      }
    });
    // containerRef is stable; the effect subscribes once for the component's life.
  }, [containerRef]);

  return {
    dropGhost,
    handleArtworkDragOver,
    handleArtworkDragLeave,
    handleArtworkDrop
  };
}
