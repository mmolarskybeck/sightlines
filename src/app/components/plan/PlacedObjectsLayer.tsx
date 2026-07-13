import { type PointerEvent as ReactPointerEvent } from "react";
import {
  getRenderedWallObjectPlanRect,
  type PlanSceneFloorObject,
  type PlanSceneOpeningConnection,
  type PlanSceneWallObject
} from "../../../domain/scene2d/planScene";
import {
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type Dimensions,
  type Project,
  type WallObject
} from "../../../domain/project";
import type { PlanPlacement } from "../../../domain/snapping/planSnapTargets";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import type { Vector2 } from "../../../domain/geometry/dragResize";
import { PlanObject } from "../PlanObject";
import { ArtworkTooltipContent, OpeningTooltipContent } from "../PlacementTooltip";
import type { ObjectDragState } from "./types";

// Render-only placed-objects layer: the advisory opening-connection glyphs, the
// wall-anchored object rects, and the floor-placed object rects — the block
// PlanView used to paint (via an IIFE) above the room structure and below the
// selection handles. Every per-object preview decision (single vs group drag,
// floor/none anchor, the rendered-rect transform) is reproduced verbatim; the
// layer holds no state, reading the live `objectDrag` preview and selection ids
// straight from props. Paint order (connections → wall objects → floor objects)
// is preserved exactly.
type BeginObjectDragParams = {
  objectId: string;
  kind: WallObject["kind"];
  startCenterMm: Vector2;
  movingSize: { widthMm: number; heightMm: number; depthMm: number };
  wallFootprintWidthMm?: number;
  rotationDeg: number;
  currentPlacement: PlanPlacement;
  initialPlanRect: PlanRect;
};

export type PlacedObjectsLayerProps = {
  openingConnections: PlanSceneOpeningConnection[];
  wallObjects: PlanSceneWallObject[];
  floorObjects: PlanSceneFloorObject[];
  pixelsPerMm: number;
  objectDrag: ObjectDragState | null;
  // Any in-flight gesture / armed tool suppresses hover tooltips (computed by
  // PlanView, which owns all the drag machines this depends on).
  tooltipsDisabled: boolean;
  artworksById?: Map<string, Artwork>;
  thumbnailUrlsByAssetId: Map<string, string>;
  unit: Project["unit"];
  wallObjectMinDepthMm: number;
  objectHitMinMm: number;
  selectedArtworkId?: string | null;
  selectedOpeningId?: string | null;
  selectedObjectIds: string[];
  consumeSelectSuppression: () => boolean;
  beginObjectDrag: (params: BeginObjectDragParams, event: ReactPointerEvent<SVGGElement>) => void;
  onSelectObject?: (id: string, options: { additive: boolean }) => void;
  onSelectArtwork?: (artworkId: string) => void;
  onSelectOpening?: (openingId: string) => void;
};

export function PlacedObjectsLayer({
  openingConnections,
  wallObjects,
  floorObjects,
  pixelsPerMm,
  objectDrag,
  tooltipsDisabled,
  artworksById,
  thumbnailUrlsByAssetId,
  unit,
  wallObjectMinDepthMm,
  objectHitMinMm,
  selectedArtworkId,
  selectedOpeningId,
  selectedObjectIds,
  consumeSelectSuppression,
  beginObjectDrag,
  onSelectObject,
  onSelectArtwork,
  onSelectOpening
}: PlacedObjectsLayerProps) {
  const artworkTooltip = (artworkId: string, displayDimensionsOverride?: Dimensions) => {
    const artwork = artworksById?.get(artworkId);
    if (!artwork) return undefined;
    return (
      <ArtworkTooltipContent
        artwork={artwork}
        dimensions={displayDimensionsOverride ?? artwork.dimensions}
        thumbnailUrl={
          artwork.assetId ? thumbnailUrlsByAssetId.get(artwork.assetId) : undefined
        }
        unit={unit}
      />
    );
  };
  return (
    <>
      {openingConnections.map((connection) => (
        <g
          aria-label={`Connected openings: ${connection.status}`}
          className={`opening-connection-glyph ${connection.status}`}
          key={connection.id}
          role="img"
        >
          <line
            x1={connection.aCenterMm.xMm}
            y1={connection.aCenterMm.yMm}
            x2={connection.bCenterMm.xMm}
            y2={connection.bCenterMm.yMm}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={connection.midMm.xMm}
            cy={connection.midMm.yMm}
            r={pixelsPerMm > 0 ? 5 / pixelsPerMm : 0}
          />
        </g>
      ))}
      {wallObjects.map(({ object: wallObject, artwork, restRect, renderedRect }) => {
        // Preview position, generalized over single and group drags: a
        // group member reads its own rect from previewRectById, a single
        // dragged object reads previewPlanRect, everything else rests.
        const groupPreviewRect = objectDrag?.members
          ? objectDrag.previewRectById?.get(wallObject.id)
          : undefined;
        const planRect =
          groupPreviewRect ??
          (objectDrag && !objectDrag.members && objectDrag.objectId === wallObject.id
            ? objectDrag.previewPlanRect
            : restRect);
        const isSinglePreview = Boolean(
          objectDrag && !objectDrag.members && objectDrag.objectId === wallObject.id
        );
        // The live single-drag preview's anchor drives the look: "floor"
        // → dashed floor object; "none" → danger token (artwork dragged
        // off every wall — a refused move). A group drag is translation-
        // only so a wall member stays on its wall; at rest, on the wall.
        const previewAnchor =
          objectDrag != null &&
          !objectDrag.members &&
          objectDrag.objectId === wallObject.id
            ? objectDrag.previewPlacement.anchor
            : null;
        const isFloorPlaced = previewAnchor === "floor";
        const isInvalid = previewAnchor === "none";
        const isSelected =
          (wallObject.kind === "artwork"
            ? wallObject.artworkId === selectedArtworkId
            : wallObject.id === selectedOpeningId) ||
          selectedObjectIds.includes(wallObject.id);
        // What paints while wall-anchored (a floated/rejected preview
        // already carries its real floor-object depth and sits off the
        // wall, so it's drawn at its own center, untransformed): the
        // scene's precomputed rect at rest, and the SAME domain
        // transform (getRenderedWallObjectPlanRect — mat/frame
        // widening, viewer-side offset, min-depth clamp) applied to
        // any live single/group drag preview, so the drawing never
        // disagrees between mid-drag and on-release — nothing jumps.
        //
        // The preview rect's provenance travels in `sizing`, not by lying about
        // the artwork: a single-drag rect arrives already outer-sized from
        // resolvePlanPlacement, while a group preview rect arrives image-sized
        // (its members are built from stored project.wallObjects) and still
        // needs widening. Both still need the viewer-side offset and min-depth
        // clamp, so both go through the transform.
        const renderedPlanRect =
          isFloorPlaced || isInvalid
            ? planRect
            : planRect === restRect
              ? renderedRect
              : getRenderedWallObjectPlanRect(
                  planRect,
                  wallObject.kind,
                  artwork,
                  wallObjectMinDepthMm,
                  isSinglePreview ? "outer" : "image"
                );

        return (
          <PlanObject
            hitMinSizeMm={objectHitMinMm}
            isFloorPlaced={isFloorPlaced}
            isInvalid={isInvalid}
            isSelected={isSelected}
            key={wallObject.id}
            kind={wallObject.kind}
            planRect={renderedPlanRect}
            tooltip={
              wallObject.kind === "artwork" ? (
                artworkTooltip(wallObject.artworkId, wallObject.displayDimensionsOverride)
              ) : (
                <OpeningTooltipContent
                  kind={wallObject.kind}
                  secondaryMm={wallObject.heightMm}
                  unit={unit}
                  widthMm={wallObject.widthMm}
                />
              )
            }
            tooltipDisabled={tooltipsDisabled}
            onBeginDrag={(event) =>
              beginObjectDrag(
                {
                  objectId: wallObject.id,
                  kind: wallObject.kind,
                  startCenterMm: {
                    xMm: restRect.centerXMm,
                    yMm: restRect.centerYMm
                  },
                  movingSize: {
                    widthMm: wallObject.widthMm,
                    heightMm: wallObject.heightMm,
                    // The eventual floor footprint depth if this drags
                    // off the wall; unused while it stays on a wall.
                    depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
                  },
                  wallFootprintWidthMm: renderedRect.widthMm,
                  // Preview a floated result at the wall's angle so a
                  // wall→floor drag keeps its orientation (matching
                  // commitPlanMove).
                  rotationDeg: restRect.angleDeg,
                  currentPlacement: {
                    anchor: "wall",
                    wallId: wallObject.wallId,
                    xMm: wallObject.xMm
                  },
                  // The live single-drag renderer treats wall previews as
                  // already footprint-sized. Seed that outer width before the
                  // first pointermove so a framed work never shrinks on grab.
                  initialPlanRect: { ...restRect, widthMm: renderedRect.widthMm }
                },
                event
              )
            }
            onSelect={(event) => {
              if (consumeSelectSuppression()) return;
              if (onSelectObject) {
                onSelectObject(wallObject.id, {
                  additive: event.shiftKey || event.metaKey || event.ctrlKey
                });
              } else if (wallObject.kind === "artwork") {
                onSelectArtwork?.(wallObject.artworkId);
              } else {
                onSelectOpening?.(wallObject.id);
              }
            }}
          />
        );
      })}
      {floorObjects.map(({ object: floorObject, rect: restRect }) => {
        const groupPreviewRect = objectDrag?.members
          ? objectDrag.previewRectById?.get(floorObject.id)
          : undefined;
        const planRect =
          groupPreviewRect ??
          (objectDrag && !objectDrag.members && objectDrag.objectId === floorObject.id
            ? objectDrag.previewPlanRect
            : restRect);
        // A floor object reads floor-placed at rest and under a group
        // drag (translation-only keeps it on the floor); a single drag
        // follows the preview — a floor→wall drag drops the dashed look,
        // and an artwork dragged nowhere ("none") shows the danger token
        // (the move is refused, it stays at its old floor spot on release).
        const previewAnchor =
          objectDrag && !objectDrag.members && objectDrag.objectId === floorObject.id
            ? objectDrag.previewPlacement.anchor
            : null;
        const isFloorPlaced = previewAnchor === null ? true : previewAnchor === "floor";
        const isInvalid = previewAnchor === "none";
        const isSelected =
          (floorObject.kind === "artwork"
            ? floorObject.artworkId === selectedArtworkId
            : floorObject.id === selectedOpeningId) ||
          selectedObjectIds.includes(floorObject.id);

        return (
          <PlanObject
            hitMinSizeMm={objectHitMinMm}
            isFloorPlaced={isFloorPlaced}
            isInvalid={isInvalid}
            isSelected={isSelected}
            key={floorObject.id}
            kind={floorObject.kind}
            planRect={planRect}
            tooltip={
              floorObject.kind === "artwork" ? (
                artworkTooltip(floorObject.artworkId, floorObject.displayDimensionsOverride)
              ) : (
                // A floor blocked zone's footprint reads width × depth
                // (its plan axes), not width × height.
                <OpeningTooltipContent
                  kind={floorObject.kind}
                  secondaryMm={floorObject.depthMm}
                  unit={unit}
                  widthMm={floorObject.widthMm}
                />
              )
            }
            tooltipDisabled={tooltipsDisabled}
            onBeginDrag={(event) =>
              beginObjectDrag(
                {
                  objectId: floorObject.id,
                  kind: floorObject.kind,
                  startCenterMm: { xMm: floorObject.xMm, yMm: floorObject.yMm },
                  movingSize: {
                    widthMm: floorObject.widthMm,
                    heightMm: floorObject.heightMm,
                    depthMm: floorObject.depthMm
                  },
                  rotationDeg: floorObject.rotationDeg,
                  currentPlacement: {
                    anchor: "floor",
                    xMm: floorObject.xMm,
                    yMm: floorObject.yMm
                  },
                  initialPlanRect: restRect
                },
                event
              )
            }
            onSelect={(event) => {
              if (consumeSelectSuppression()) return;
              if (onSelectObject) {
                onSelectObject(floorObject.id, {
                  additive: event.shiftKey || event.metaKey || event.ctrlKey
                });
              } else if (floorObject.kind === "artwork") {
                onSelectArtwork?.(floorObject.artworkId);
              } else {
                onSelectOpening?.(floorObject.id);
              }
            }}
          />
        );
      })}
    </>
  );
}
