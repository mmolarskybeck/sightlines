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
  effectivePlacementForm,
  type PlacementForm
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
// session. artworkFormFor is exposed because PlanView's own object-drag path
// also needs a dragged artwork's effective placement form; the DOM handlers and
// dropGhost the JSX renders round out the surface it hands back.
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
  // placeholder placement itself falls back to. depthMm feeds a floor-drop
  // preview; it's ignored for a wall drop.
  function effectiveArtworkDims(artworkId: string | null): {
    widthMm: number;
    heightMm: number;
    depthMm: number;
    wallFootprintWidthMm?: number;
  } {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    if (artwork) {
      // The aspect only applies to the artwork we actually loaded it for.
      const aspect = artworkId === draggingArtworkId ? draggingArtworkAspect : undefined;
      const { widthMm, heightMm } = getEffectivePlacementSizeMm(artwork.dimensions, aspect);
      // Framing is WALL-ONLY geometry (docs/framing-dimension-contract.md §3,
      // Phase 6b): a floor work gets NO outer width, by construction rather than
      // by the floor stage happening to ignore one. An outer width leaking into
      // a floor drop would also reach effectiveFloorDepthMm's width fallback and
      // put the frame band on the depth axis, which it has no relationship to.
      const wallFootprintWidthMm =
        effectivePlacementForm(artwork) === "wall"
          ? getArtworkOuterDimensionsMm(widthMm, heightMm, artwork.matWidthMm, artwork.frame)
              .widthMm
          : undefined;
      return {
        widthMm,
        heightMm,
        wallFootprintWidthMm,
        // Floor footprint depth for a floor-work drop — shared with the store
        // commit and 3D via effectiveFloorDepthMm; ignored for a wall drop.
        depthMm: effectiveFloorDepthMm(artwork.dimensions)
      };
    }
    return {
      widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM,
      heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM,
      depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
    };
  }

  // The effective placement form of the artwork under a drag — governs whether
  // the drop captures a wall (wall work) or lands on the floor (floor work). An
  // unresolved id (placeholder drag before the payload is known) reads as a wall
  // work, the conservative default (matches floatPolicyForKind's own fallback).
  function artworkFormFor(artworkId: string | null): PlacementForm {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    return artwork ? effectivePlacementForm(artwork) : "wall";
  }

  function resolveArtworkDrop(
    pointerMm: Vector2,
    dims: ReturnType<typeof effectiveArtworkDims>,
    // ⌘/Ctrl (mouse) or an explicit request bypasses snapping/quantization:
    // kill the grid tier and drop the neighbor threshold to zero so the point
    // lands exactly under the pointer. Touch drags pass false — they have no
    // modifier and read best fully snapped.
    bypassSnap: boolean,
    // The dragged work's effective form: a wall work rejects off every wall
    // (resolves to `{ anchor: "none" }`), a floor work goes straight to the
    // floor stage and never captures a wall (floor-only).
    form: PlacementForm
  ) {
    const roomId = roomIdContainingPoint(project, pointerMm);
    return resolvePlanPlacement(pointerMm, {
      walls: floorWallsForTool,
      wallObjects: snappingWallObjects,
      movingSize: dims,
      wallFootprintWidthMm: dims.wallFootprintWidthMm,
      movingKind: "artwork",
      floatPolicy: floatPolicyForKind("artwork", form),
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

    const result = resolveArtworkDrop(
      pointerMm,
      effectiveArtworkDims(artworkId),
      bypassSnap,
      artworkFormFor(artworkId)
    );
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

    const placement = resolveArtworkDrop(
      pointerMm,
      effectiveArtworkDims(artworkId),
      bypassSnap,
      artworkFormFor(artworkId)
    ).placement;
    // A floor work lands on the floor (floor-only policy always resolves a floor
    // center) via the store's placeArtworkOnFloor path.
    if (placement.anchor === "floor") {
      onPlaceArtworkOnFloor?.(artworkId, placement.xMm, placement.yMm);
      return;
    }
    // A wall work is wall-only: only a wall capture commits. `anchor: "none"`
    // (no wall in range) is a rejected drop — a no-op, matching the danger ghost
    // the user saw.
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
    artworkFormFor,
    handleArtworkDragOver,
    handleArtworkDragLeave,
    handleArtworkDrop
  };
}
