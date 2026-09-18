import {
  useEffect,
  useRef,
  type DragEvent as ReactDragEvent,
  type RefObject
} from "react";
import type { Vector2 } from "../../domain/geometry/dragResize";
import {
  PLACEHOLDER_ARTWORK_HEIGHT_MM,
  PLACEHOLDER_ARTWORK_WIDTH_MM
} from "../../domain/placement/placeArtwork";
import type { Artwork, WallObject } from "../../domain/project";
import type { Guide, SnapTargetIds } from "../../domain/snapping/resolveSnap";
import {
  ARTWORK_DRAG_MIME,
  consumeArtworkDragSession,
  peekArtworkDragSession,
  subscribeArtworkTouchDrag
} from "../components/library/artworkDragSession";
import { getElevationDropGhostSizeMm } from "../components/elevation/elevationArtworkGeometry";
import { useArtworkAspect } from "./useArtworkAspect";

type ElevationPlacementResult = {
  point: Vector2;
  activeGuides: Guide[];
  snapTargetIds: SnapTargetIds;
  brokenBarrierIds: string[];
  blocked: boolean;
};

type DropGhostState = {
  centerMm: Vector2;
  sizeMm: { widthMm: number; heightMm: number };
  previousSnapTargetIds?: SnapTargetIds;
  activeGuides: Guide[];
  brokenBarrierIds?: string[];
};

// The elevation checklist drop cluster (HTML5 drag/drop plus the touch-drag
// session), lifted out of ElevationView verbatim. The drop-ghost state itself
// stays in the view (the JSX and the marquee/opening-tool guards read it); its
// setter and last value are passed through.
export function useElevationArtworkDrop(options: {
  wallId: string | undefined;
  artworksById: Map<string, Artwork> | undefined;
  draggingArtworkId: string | null;
  onPlaceArtwork:
    | ((
        artworkId: string,
        wallId: string,
        xMm: number,
        yMm: number,
        seatOnShelfId?: string
      ) => void)
    | undefined;
  containerRef: RefObject<HTMLDivElement | null>;
  toWallLocalMm: (clientX: number, clientY: number) => Vector2 | null;
  wallObjectsOnThisWall: WallObject[];
  dropGhost: DropGhostState | null;
  setDropGhost: (ghost: DropGhostState | null) => void;
  resolveElevationPlacement: (
    proposed: Vector2,
    sizeMm: { widthMm: number; heightMm: number },
    neighbors: WallObject[],
    movingKind: WallObject["kind"],
    movingKinds: WallObject["kind"][],
    previousSnapTargetIds: SnapTargetIds | undefined,
    precisionBypass: boolean,
    brokenBarrierIds: ReadonlySet<string>
  ) => ElevationPlacementResult;
}) {
  const {
    wallId,
    artworksById,
    draggingArtworkId,
    onPlaceArtwork,
    containerRef,
    toWallLocalMm,
    wallObjectsOnThisWall,
    dropGhost,
    setDropGhost,
    resolveElevationPlacement
  } = options;

  // The dragged artwork's image aspect, so a partial/unknown-dimension work's
  // drop ghost is sized at its true proportions (matching what placeArtwork
  // bakes) instead of the raw placeholder box. Only the currently-dragged
  // artwork is loaded, keyed off draggingArtworkId's asset.
  const draggingArtworkAspect = useArtworkAspect(
    draggingArtworkId ? artworksById?.get(draggingArtworkId)?.assetId : undefined
  );

  // The size to show for a not-yet-placed drop ghost: the real artwork's
  // effective size if the checklist told us which one is being dragged
  // (draggingArtworkId), otherwise the same placeholder size placement
  // itself falls back to (docs/plan.md §1.5: place before dimensions are
  // known).
  function effectiveSizeForArtworkId(artworkId: string | null): { widthMm: number; heightMm: number } {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    if (artwork) {
      // The aspect only applies to the artwork we actually loaded it for.
      const aspect = artworkId === draggingArtworkId ? draggingArtworkAspect : undefined;
      return getElevationDropGhostSizeMm(artwork, aspect);
    }
    return { widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM, heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM };
  }

  // Shared by the HTML5 dragover handler and the touch-drag subscription: given
  // client coordinates and the dragged artwork, resolve the placement and paint
  // the drop ghost. No-ops with no wall selected. Caller has gated on an active
  // drag; bypassSnap comes from ⌘/Ctrl on the mouse path, false on touch.
  //
  // Every work is droppable here, whatever its library form. This used to refuse
  // a floor work outright — no ghost, no-drop cursor, no commit — on the reading
  // that a floor work never hangs. That was reversed by USER DECISION along with
  // the plan-view policy (see floatPolicyForKind): dropping onto a wall IS the
  // statement that this thing hangs, and a depth-bearing work on a wall is the
  // supported deep-wall path. The library placementForm flag is not written on
  // the way through — App derives the effective type from where the object
  // actually lives.
  function updateArtworkDropGhost(
    clientX: number,
    clientY: number,
    artworkId: string | null,
    bypassSnap: boolean
  ) {
    if (!wallId) return;
    const pointerMm = toWallLocalMm(clientX, clientY);
    if (!pointerMm) return;

    const sizeMm = effectiveSizeForArtworkId(artworkId);
    // A checklist drag-in is always an artwork: eyeline first, floor just below
    // it (see getArtworkSnapTargets' kind-dependent floor rank). ⌘/Ctrl held
    // over the surface bypasses snapping/quantization, same as a move-drag. The
    // broken-barrier set carries frame-to-frame like a move-drag's (a fresh
    // ghost starts empty), and neighbors are every object on the wall.
    const snapResult = resolveElevationPlacement(
      pointerMm,
      sizeMm,
      wallObjectsOnThisWall,
      "artwork",
      ["artwork"],
      dropGhost?.previousSnapTargetIds,
      bypassSnap,
      new Set(dropGhost?.brokenBarrierIds)
    );

    // A blocked resolve (dropped-into an unresolvable hard overlap) still paints
    // the best-effort ghost — unlike a move it has no "last legal" preview to
    // hold, and the commit gate is the final backstop on drop.
    setDropGhost({
      centerMm: snapResult.point,
      sizeMm,
      previousSnapTargetIds: snapResult.snapTargetIds,
      activeGuides: snapResult.activeGuides,
      brokenBarrierIds: snapResult.brokenBarrierIds
    });
  }

  // Shared by the HTML5 drop handler and the touch-drag subscription: commit the
  // placement. Guards wallId (this view needs it to place); the caller has
  // already validated the artworkId resolves to a known artwork.
  function completeArtworkDrop(
    clientX: number,
    clientY: number,
    artworkId: string,
    bypassSnap: boolean
  ) {
    if (!wallId) return;
    const pointerMm = toWallLocalMm(clientX, clientY);
    if (!pointerMm) return;

    const sizeMm = effectiveSizeForArtworkId(artworkId);
    // Must land exactly where the ghost showed — same resolver, same bypass, and
    // the SAME broken-barrier set the ghost last carried (read off the closed-
    // over dropGhost, still the last rendered value here even though handleDrop
    // has queued setDropGhost(null)). Without threading it, the final resolve
    // could re-arm a barrier the ghost had already popped and snap the drop back.
    const snapResult = resolveElevationPlacement(
      pointerMm,
      sizeMm,
      wallObjectsOnThisWall,
      "artwork",
      ["artwork"],
      undefined,
      bypassSnap,
      new Set(dropGhost?.brokenBarrierIds)
    );

    const seatedShelfId = snapResult.snapTargetIds.y?.startsWith("shelf-top:")
      ? snapResult.snapTargetIds.y.slice("shelf-top:".length)
      : undefined;
    onPlaceArtwork?.(
      artworkId,
      wallId,
      snapResult.point.xMm,
      snapResult.point.yMm,
      seatedShelfId
    );
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    // iPadOS Safari hides custom MIME types during dragover/drop, so fall back
    // to the app-level drag state (draggingArtworkId), and further to the
    // module-level drag session for when WebKit's event ordering leaves that
    // state already cleared by the time dragover/drop fires.
    if (
      !wallId ||
      (!event.dataTransfer.types.includes(ARTWORK_DRAG_MIME) &&
        !draggingArtworkId &&
        !peekArtworkDragSession())
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

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    // Only clear when the pointer actually leaves the surface, not when it
    // moves between child elements within it (those also fire dragleave).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropGhost(null);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    const artworkId =
      event.dataTransfer.getData(ARTWORK_DRAG_MIME) || draggingArtworkId || peekArtworkDragSession();
    consumeArtworkDragSession();
    setDropGhost(null);
    if (!artworkId || !wallId) return;
    if (!artworksById?.get(artworkId)) return;
    event.preventDefault();
    completeArtworkDrop(event.clientX, event.clientY, artworkId, event.metaKey || event.ctrlKey);
  }

  // The touch/pen drag path (iOS/iPadOS, where HTML5 DnD is unavailable/
  // unreliable) reaches this drop target through the module-level session rather
  // than DOM drag events. The handlers close over live state/props, so route
  // them through a ref refreshed each render and subscribe once.
  const touchDropRef = useRef({
    updateGhost: updateArtworkDropGhost,
    complete: completeArtworkDrop,
    isValidArtwork: (id: string) => Boolean(artworksById?.get(id))
  });
  touchDropRef.current = {
    updateGhost: updateArtworkDropGhost,
    complete: completeArtworkDrop,
    isValidArtwork: (id: string) => Boolean(artworksById?.get(id))
  };

  useEffect(() => {
    return subscribeArtworkTouchDrag((dragEvent) => {
      const container = containerRef.current;
      const handlers = touchDropRef.current;
      if (!container) return;
      if (dragEvent.type === "cancel") {
        setDropGhost(null);
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
        else setDropGhost(null);
        return;
      }
      // drop: always clear the ghost; place only if it landed inside and the id
      // still resolves to a known artwork (mirrors the HTML5 drop guard).
      setDropGhost(null);
      if (inside && handlers.isValidArtwork(dragEvent.artworkId)) {
        handlers.complete(dragEvent.clientX, dragEvent.clientY, dragEvent.artworkId, false);
      }
    });
    // containerRef is stable; the effect subscribes once for the component's life.
  }, [containerRef]);

  return {
    handleDragOver,
    handleDragLeave,
    handleDrop
  };
}
