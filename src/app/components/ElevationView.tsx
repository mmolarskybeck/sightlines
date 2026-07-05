import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import type { Vector2 } from "../../domain/geometry/dragResize";
import {
  getEffectivePlacementSizeMm,
  PLACEHOLDER_ARTWORK_HEIGHT_MM,
  PLACEHOLDER_ARTWORK_WIDTH_MM
} from "../../domain/placement/placeArtwork";
import type {
  Artwork,
  ArtworkWallObject,
  DisplayUnit,
  OpeningWallObject,
  WallObject,
  WallObjectBase
} from "../../domain/project";
import { resolveArtworkSnap } from "../../domain/snapping/artworkSnapTargets";
import type { Guide, SnapTargetIds } from "../../domain/snapping/resolveSnap";
import { formatLength } from "../../domain/units/length";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm,
  getPixelsPerMm
} from "../../domain/units/precision";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import { useContainerSize } from "../hooks/useContainerSize";
import { ARTWORK_DRAG_MIME } from "./ChecklistPanel";
import { ElevationArtwork } from "./ElevationArtwork";
import { ElevationOpening } from "./ElevationOpening";
import { isArtworkOutOfWallBounds, wallLocalYToSvgY } from "./elevationArtworkGeometry";
import { GridOverlay } from "./GridOverlay";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "./ui/select";

// Re-exported for backward compatibility — this used to be defined here,
// and nothing outside this file depends on the distinction between "defined
// here" and "defined in elevationArtworkGeometry.ts and re-exported."
export { wallLocalYToSvgY };

const SNAP_THRESHOLD_PX = 10;

// Stable module-level reference so a caller that doesn't pass `getBlob`
// (the pre-wiring default) doesn't retrigger useAssetImageUrls's fetch
// effect on every render — the hook depends on its getBlob argument's
// identity. Rejecting immediately is fine: the hook treats a failed fetch as
// "leave this id unresolved," never as a thrown error.
const NO_OP_GET_BLOB: (key: string) => Promise<Blob> = () =>
  Promise.reject(new Error("ElevationView: no getBlob provided"));

// A pointer-drag move of an existing placement, transient until release
// (docs/plan.md §7: live preview, exactly one store commit on release).
// Mirrors PlanView's DragState shape/naming for the resize-handle drag.
// Generalized over wall object kind (artwork or opening) — `kind` decides
// which store action commits on release, everything else about the drag
// (preview, snapping, sub-threshold no-op) is identical either way.
type MoveDragState = {
  wallObjectId: string;
  kind: WallObject["kind"];
  sizeMm: { widthMm: number; heightMm: number };
  startPointerMm: Vector2;
  startCenterMm: Vector2;
  previewCenterMm: Vector2;
  // Per-axis hysteresis ids: x and y snap independently (centerline in y
  // while the grid holds x), so each axis remembers its own active target.
  previousSnapTargetIds?: SnapTargetIds;
  activeGuides: Guide[];
};

// The HTML5-drop preview for a not-yet-placed artwork being dragged in from
// the checklist. Separate from MoveDragState because it has no existing
// wallObjectId/startCenterMm — it's a brand-new placement, not a move — but
// it flows through the exact same resolveArtworkSnap call so a drop can
// never land somewhere the ghost didn't just show.
type DropGhostState = {
  centerMm: Vector2;
  sizeMm: { widthMm: number; heightMm: number };
  previousSnapTargetIds?: SnapTargetIds;
  activeGuides: Guide[];
};

export function ElevationView({
  artworksById,
  draggingArtworkId = null,
  centerlineMm,
  getBlob,
  gridPrecisionFloorMm,
  gridVisible,
  onMoveOpening,
  onMovePlacement,
  onPlaceArtwork,
  onSelectArtwork,
  onSelectOpening,
  selectedArtworkId = null,
  selectedOpeningId = null,
  snapToGrid = false,
  unit,
  wallHeightMm,
  wallId,
  wallLengthMm,
  wallName,
  wallObjects,
  walls = [],
  onSelectWall
}: {
  gridPrecisionFloorMm: number | null;
  gridVisible: boolean;
  wallName: string;
  wallLengthMm: number;
  wallHeightMm: number;
  centerlineMm: number;
  unit: DisplayUnit;
  // Everything below is new and optional (safe, inert defaults) — App.tsx
  // doesn't pass these yet, that's the next task's wiring. Until then this
  // component renders and behaves exactly as it did before this change.
  wallId?: string;
  wallObjects?: WallObject[];
  artworksById?: Map<string, Artwork>;
  selectedArtworkId?: string | null;
  selectedOpeningId?: string | null;
  getBlob?: (key: string) => Promise<Blob>;
  snapToGrid?: boolean;
  draggingArtworkId?: string | null;
  onPlaceArtwork?: (artworkId: string, wallId: string, xMm: number, yMm: number) => void;
  onMovePlacement?: (wallObjectId: string, xMm: number, yMm: number) => void;
  onMoveOpening?: (wallObjectId: string, xMm: number, yMm: number) => void;
  onSelectArtwork?: (artworkId: string) => void;
  onSelectOpening?: (wallObjectId: string) => void;
  // The full wall inventory (in room order) plus a selector, so the elevation
  // chip can double as a wall switcher — the navigation the right panel used
  // to carry. Optional/inert until App wires them.
  walls?: { id: string; name: string; roomName: string }[];
  onSelectWall?: (wallId: string) => void;
}) {
  const [containerRef, containerSize] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [moveDrag, setMoveDrag] = useState<MoveDragState | null>(null);
  const moveDragRef = useRef<MoveDragState | null>(null);
  const [dropGhost, setDropGhost] = useState<DropGhostState | null>(null);

  // Pad the viewBox so the wall reads as a figure on the canvas field
  // rather than bleeding edge-to-edge, and so boundary strokes (centered on
  // the wall edge) aren't half-clipped. All wall-local coordinates are
  // unchanged — only the visible window widens.
  const viewPadMm = Math.max(wallLengthMm, wallHeightMm) * 0.06;
  const viewBox = `${-viewPadMm} ${-viewPadMm} ${wallLengthMm + viewPadMm * 2} ${
    wallHeightMm + viewPadMm * 2
  }`;
  const pixelsPerMm = getPixelsPerMm(containerSize, {
    width: wallLengthMm + viewPadMm * 2,
    height: wallHeightMm + viewPadMm * 2
  });
  const minorGridMm = getMinorGridIntervalMm(unit, pixelsPerMm, {
    // Elevation reads finer than plan: hang heights are an inches/centimeters
    // activity, so a tighter target keeps the lattice on the (6in, 2ft) /
    // (10cm, 1m) rung at typical single-wall zoom.
    targetMinorPx: 7,
    minIntervalMm: gridPrecisionFloorMm
  });
  const majorGridMm = getMajorGridIntervalMm(unit, minorGridMm);
  const centerlineSvgY = wallLocalYToSvgY(wallHeightMm, centerlineMm);
  const snapThresholdMm = pixelsPerMm > 0 ? SNAP_THRESHOLD_PX / pixelsPerMm : 0;

  const placements: ArtworkWallObject[] = (wallObjects ?? []).filter(
    (object): object is ArtworkWallObject => object.kind === "artwork" && object.wallId === wallId
  );
  const openings: OpeningWallObject[] = (wallObjects ?? []).filter(
    (object): object is OpeningWallObject => object.kind !== "artwork" && object.wallId === wallId
  );
  // Every wall object on this wall is a valid snap neighbor for any other —
  // an artwork can align to a door's edge just as readily as to another
  // artwork's (docs/plan.md §2 snap-target priority doesn't distinguish by
  // kind, only centerline > neighbor-center > neighbor-edge > grid).
  const wallObjectsOnThisWall: WallObjectBase[] = [...placements, ...openings];

  const assetIds = placements.map((placement) => artworksById?.get(placement.artworkId)?.assetId);
  const imageUrlsByAssetId = useAssetImageUrls(assetIds, getBlob ?? NO_OP_GET_BLOB, "display");

  // The size to show for a not-yet-placed drop ghost: the real artwork's
  // effective size if the checklist told us which one is being dragged
  // (draggingArtworkId), otherwise the same placeholder size placement
  // itself falls back to (docs/plan.md §1.5: place before dimensions are
  // known).
  function effectiveSizeForArtworkId(artworkId: string | null): { widthMm: number; heightMm: number } {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    if (artwork) return getEffectivePlacementSizeMm(artwork.dimensions);
    return { widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM, heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM };
  }

  function toWallLocalMm(clientX: number, clientY: number): Vector2 | null {
    const svg = svgRef.current;
    if (!svg) return null;

    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;

    const transformed = point.matrixTransform(ctm.inverse());
    // The SVG viewBox is already in wall-local mm with x running the same
    // direction as wall-local x (from the wall start), so only y needs the
    // shared y-up/y-down flip — the same function used to place every other
    // elevation element, applied here in the inverse direction (it's
    // self-inverse, since it's just wallHeightMm minus the value).
    return { xMm: transformed.x, yMm: wallLocalYToSvgY(wallHeightMm, transformed.y) };
  }

  useEffect(() => {
    if (!moveDrag) return;

    function onPointerMove(event: PointerEvent) {
      const current = moveDragRef.current;
      if (!current) return;

      const pointerMm = toWallLocalMm(event.clientX, event.clientY);
      if (!pointerMm) return;

      const proposedCenterMm: Vector2 = {
        xMm: current.startCenterMm.xMm + (pointerMm.xMm - current.startPointerMm.xMm),
        yMm: current.startCenterMm.yMm + (pointerMm.yMm - current.startPointerMm.yMm)
      };

      const neighbors = wallObjectsOnThisWall.filter(
        (wallObject) => wallObject.id !== current.wallObjectId
      );

      const snapResult = resolveArtworkSnap(proposedCenterMm, {
        centerlineYMm: centerlineMm,
        wallLengthMm,
        wallHeightMm,
        gridIntervalMm: minorGridMm,
        neighbors,
        movingSize: current.sizeMm,
        // The dragged object's kind gates the floor tier: a door drag gets a
        // floor target (its primary snap); artworks/windows/blocked zones
        // never do. The artwork drop-ghost/drop paths below omit this.
        movingKind: current.kind,
        snapToGrid,
        thresholdMm: snapThresholdMm,
        previousSnapTargetIds: current.previousSnapTargetIds
      });

      setMoveDrag((state) =>
        state
          ? {
              ...state,
              previewCenterMm: snapResult.point,
              previousSnapTargetIds: snapResult.snapTargetIds,
              activeGuides: snapResult.activeGuides
            }
          : state
      );
    }

    function onPointerUp() {
      const current = moveDragRef.current;
      setMoveDrag(null);
      if (!current) return;

      // Sub-threshold release is a no-op — a click-without-real-movement
      // must not produce a phantom undo entry (docs/plan.md §7).
      const movedMm = Math.hypot(
        current.previewCenterMm.xMm - current.startCenterMm.xMm,
        current.previewCenterMm.yMm - current.startCenterMm.yMm
      );
      if (movedMm < 0.5) return;

      if (current.kind === "artwork") {
        onMovePlacement?.(current.wallObjectId, current.previewCenterMm.xMm, current.previewCenterMm.yMm);
      } else {
        onMoveOpening?.(current.wallObjectId, current.previewCenterMm.xMm, current.previewCenterMm.yMm);
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    // Same shape as PlanView's drag effect: subscribed once per gesture,
    // reading live state via moveDragRef rather than closing over `moveDrag`.
    // wallLengthMm/wallHeightMm/centerlineMm/minorGridMm/snapToGrid/
    // snapThresholdMm/wallObjectsOnThisWall all derive from the committed
    // project and current viewport, which can't change mid-drag (the
    // transient preview never rewrites them), so they're intentionally left
    // out of the deps.
  }, [moveDrag !== null, onMovePlacement, onMoveOpening]);

  useEffect(() => {
    moveDragRef.current = moveDrag;
  }, [moveDrag]);

  function beginMoveDrag(wallObject: WallObject, event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation();
    const startPointerMm = toWallLocalMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    setMoveDrag({
      wallObjectId: wallObject.id,
      kind: wallObject.kind,
      sizeMm: { widthMm: wallObject.widthMm, heightMm: wallObject.heightMm },
      startPointerMm,
      startCenterMm: { xMm: wallObject.xMm, yMm: wallObject.yMm },
      previewCenterMm: { xMm: wallObject.xMm, yMm: wallObject.yMm },
      previousSnapTargetIds: undefined,
      activeGuides: []
    });
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!wallId || !event.dataTransfer.types.includes(ARTWORK_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    const pointerMm = toWallLocalMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const sizeMm = effectiveSizeForArtworkId(draggingArtworkId);
    const snapResult = resolveArtworkSnap(pointerMm, {
      centerlineYMm: centerlineMm,
      wallLengthMm,
      wallHeightMm,
      gridIntervalMm: minorGridMm,
      neighbors: wallObjectsOnThisWall,
      movingSize: sizeMm,
      // A checklist drag-in is always an artwork: eyeline first, floor just
      // below it (see getArtworkSnapTargets' kind-dependent floor rank).
      movingKind: "artwork",
      snapToGrid,
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds: dropGhost?.previousSnapTargetIds
    });

    setDropGhost({
      centerMm: snapResult.point,
      sizeMm,
      previousSnapTargetIds: snapResult.snapTargetIds,
      activeGuides: snapResult.activeGuides
    });
  }

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    // Only clear when the pointer actually leaves the surface, not when it
    // moves between child elements within it (those also fire dragleave).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropGhost(null);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    const artworkId = event.dataTransfer.getData(ARTWORK_DRAG_MIME);
    setDropGhost(null);
    if (!artworkId || !wallId) return;
    event.preventDefault();

    const pointerMm = toWallLocalMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const sizeMm = effectiveSizeForArtworkId(artworkId);
    const snapResult = resolveArtworkSnap(pointerMm, {
      centerlineYMm: centerlineMm,
      wallLengthMm,
      wallHeightMm,
      gridIntervalMm: minorGridMm,
      neighbors: wallObjectsOnThisWall,
      movingSize: sizeMm,
      movingKind: "artwork",
      snapToGrid,
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds: undefined
    });

    onPlaceArtwork?.(artworkId, wallId, snapResult.point.xMm, snapResult.point.yMm);
  }

  const activeGuides = moveDrag?.activeGuides ?? dropGhost?.activeGuides ?? [];

  // Wall switcher wiring for the chip. Prev/next cycle through every wall in
  // room order (wrapping), and the Select lists them all — grouped by room
  // once more than one room exists.
  const currentWallIndex = walls.findIndex((wall) => wall.id === wallId);
  const canSwitchWalls = walls.length > 0 && currentWallIndex >= 0 && Boolean(onSelectWall);
  const roomNames = [...new Set(walls.map((wall) => wall.roomName))];
  const stepWall = (delta: number) => {
    if (currentWallIndex < 0) return;
    const next = walls[(currentWallIndex + delta + walls.length) % walls.length];
    if (next) onSelectWall?.(next.id);
  };

  return (
    <div
      aria-label="Wall elevation view"
      className="drawing-surface"
      ref={containerRef}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="surface-label">
        {canSwitchWalls ? (
          <div className="surface-label-nav">
            <Button
              aria-label="Previous wall"
              className="surface-label-switch"
              size="icon-sm"
              variant="ghost"
              onClick={() => stepWall(-1)}
            >
              <CaretLeftIcon aria-hidden="true" size={16} />
            </Button>
            <Select
              value={wallId}
              onValueChange={(value) => onSelectWall?.(value)}
            >
              <SelectTrigger aria-label="Select wall" className="surface-label-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roomNames.length > 1
                  ? roomNames.map((roomName) => (
                    <SelectGroup key={roomName}>
                      <SelectLabel>{roomName}</SelectLabel>
                      {walls
                        .filter((wall) => wall.roomName === roomName)
                        .map((wall) => (
                          <SelectItem key={wall.id} value={wall.id}>
                            {wall.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ))
                  : walls.map((wall) => (
                    <SelectItem key={wall.id} value={wall.id}>
                      {wall.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              aria-label="Next wall"
              className="surface-label-switch"
              size="icon-sm"
              variant="ghost"
              onClick={() => stepWall(1)}
            >
              <CaretRightIcon aria-hidden="true" size={16} />
            </Button>
          </div>
        ) : (
          <strong>{wallName}</strong>
        )}
        <span>
          {formatLength(wallLengthMm, { unit })} by{" "}
          {formatLength(wallHeightMm, { unit })}
        </span>
      </div>
      <svg className="elevation-svg" ref={svgRef} viewBox={viewBox} role="img">
        <title>{wallName} elevation</title>
        <rect
          className="wall-fill"
          x="0"
          y="0"
          width={wallLengthMm}
          height={wallHeightMm}
          vectorEffect="non-scaling-stroke"
        />
        {gridVisible ? (
          <GridOverlay
            id="elevation-grid"
            height={wallHeightMm}
            majorSpacingMm={majorGridMm}
            minorSpacingMm={minorGridMm}
            // x=0 is the wall start (already the pattern default); y is
            // anchored to wallHeightMm so lines land counting up from
            // floor level (svg y = wallHeightMm) rather than down from the
            // wall top, per docs/plan.md §5.5.
            originYMm={wallHeightMm}
            width={wallLengthMm}
            x={0}
            y={0}
          />
        ) : null}
        <line
          className="centerline"
          x1="0"
          y1={centerlineSvgY}
          x2={wallLengthMm}
          y2={centerlineSvgY}
          vectorEffect="non-scaling-stroke"
        />
        <line
          className="floor-line"
          x1="0"
          y1={wallHeightMm}
          x2={wallLengthMm}
          y2={wallHeightMm}
          vectorEffect="non-scaling-stroke"
        />
        {placements.map((placement) => {
          const isDraggingThis = moveDrag?.wallObjectId === placement.id;
          const center = isDraggingThis ? moveDrag.previewCenterMm : { xMm: placement.xMm, yMm: placement.yMm };
          const size = isDraggingThis
            ? moveDrag.sizeMm
            : { widthMm: placement.widthMm, heightMm: placement.heightMm };
          const artwork = artworksById?.get(placement.artworkId);

          return (
            <ElevationArtwork
              key={placement.id}
              center={center}
              dimensionStatus={artwork?.dimensions.status}
              imageUrl={artwork?.assetId ? imageUrlsByAssetId.get(artwork.assetId) : undefined}
              isOutOfBounds={isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, center, size)}
              isSelected={selectedArtworkId === placement.artworkId}
              size={size}
              wallHeightMm={wallHeightMm}
              onPointerDown={(event) => beginMoveDrag(placement, event)}
              onSelect={() => onSelectArtwork?.(placement.artworkId)}
            />
          );
        })}
        {openings.map((opening) => {
          const isDraggingThis = moveDrag?.wallObjectId === opening.id;
          const center = isDraggingThis ? moveDrag.previewCenterMm : { xMm: opening.xMm, yMm: opening.yMm };
          const size = isDraggingThis
            ? moveDrag.sizeMm
            : { widthMm: opening.widthMm, heightMm: opening.heightMm };

          return (
            <ElevationOpening
              key={opening.id}
              center={center}
              isOutOfBounds={isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, center, size)}
              isSelected={selectedOpeningId === opening.id}
              kind={opening.kind}
              size={size}
              wallHeightMm={wallHeightMm}
              wallObjectId={opening.id}
              onPointerDown={(event) => beginMoveDrag(opening, event)}
              onSelect={() => onSelectOpening?.(opening.id)}
            />
          );
        })}
        {dropGhost ? (
          <ElevationArtwork
            center={dropGhost.centerMm}
            isGhost
            size={dropGhost.sizeMm}
            wallHeightMm={wallHeightMm}
          />
        ) : null}
        {activeGuides.map((guide) => (
          <line
            className="snap-guide"
            key={guide.id}
            x1={guide.axis === "x" ? guide.positionMm : 0}
            y1={guide.axis === "y" ? wallLocalYToSvgY(wallHeightMm, guide.positionMm) : 0}
            x2={guide.axis === "x" ? guide.positionMm : wallLengthMm}
            y2={
              guide.axis === "y" ? wallLocalYToSvgY(wallHeightMm, guide.positionMm) : wallHeightMm
            }
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}
