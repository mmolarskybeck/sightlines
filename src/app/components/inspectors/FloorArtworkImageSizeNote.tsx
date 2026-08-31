import type { Dimensions, DisplayUnit } from "../../../domain/project";
import { SIZE_MATCH_TOLERANCE_MM } from "../../../domain/placement/artworkForm";
import { monitorBoxSizeMm } from "../../../domain/geometry/monitorGlyphs";
import { formatLength } from "../../../domain/units/length";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// The one place the inspector states that a floor-placed work's box and the
// work itself are two different measurements — and the only way back when they
// have drifted apart.
//
// The box's Width/Depth/Height (FloorPlacementFields, under "Position on
// floor") size the OBJECT STANDING ON THE FLOOR: a projection board, a plinth,
// a sculpture's bounding volume. The Dimensions section above sizes the WORK.
// Both are real numbers a curator legitimately types, and 3D draws the image at
// the work's size on the box's face, so widening a board simply reveals more
// bare board (see floorObjectImageFaces.ts).
//
// Deliberately CONTEXTUAL rather than a permanent control: the two sizes agree
// on every fresh placement (placeArtworkOnFloor seeds the box from the work),
// so a curator who never resizes the board never sees this, and a curator who
// does gets the explanation at the moment it becomes relevant — which is also
// the moment they might mistake bare board for a bug. Nothing here is a mode:
// there is no stored state, and dismissing it means making the numbers agree.
//
// Only ever mounted from App's `placedFloorArtwork` branch, and it renders
// nothing without a target size to offer (see hasTarget below).
//
// SHAPE. A footnote, not a status. It carries `.field-hint` — the same species
// as the hint lines InspectorRow renders under a control — and the corrective
// rides at the end of the sentence as an inline text action
// (the `.settings-link` tertiary-action species, tinted petrol because this one
// writes numbers rather than opening a page). No fill, no icon, no button
// chrome: a filled InspectorNotice card read as an alert for what is a quiet
// factual aside, and DESIGN.md keeps inspector panels flat, reserving fills and
// shadows for real overlays. Two lines instead of a 87px card.
// A BOX MONITOR asks the same question about a different box. Its floor object
// is the CABINET — a 4:3 face scaled off the work, MONITOR_DEPTH_MM deep (see
// monitorBoxSizeMm) — so "the work's own size" is not the target; the cabinet
// the work implies is. All three axes travel together, because a cabinet is one
// indivisible piece of equipment and half-matching it would leave a shape no
// monitor has. Everything else about the note is identical, deliberately: it is
// the same fact ("this box drifted from the work") stated about the same kind of
// drift, and inventing a second visual species for it would be noise.
export function FloorArtworkImageSizeNote({
  dimensions,
  isMonitor = false,
  objectWidthMm,
  objectHeightMm,
  objectDepthMm,
  unit,
  onMatchSizeToWork
}: {
  // The WORK's recorded dimensions (the artwork record), not the floor
  // object's.
  dimensions: Dimensions;
  // Whether the placement is a box monitor's cabinet (see above).
  isMonitor?: boolean;
  objectWidthMm: number;
  objectHeightMm: number;
  // Only read in the monitor case, where depth is part of the match.
  objectDepthMm?: number;
  unit: DisplayUnit;
  // Writes the target size onto the floor object. For a plain floor work that
  // is width/height only — depth describes how thick the board or plinth is,
  // which the work's face dimensions say nothing about — while a monitor hands
  // back the cabinet's depth as well.
  onMatchSizeToWork: (widthMm: number, heightMm: number, depthMm?: number) => void;
}) {
  const { widthMm, heightMm } = dimensions;

  // The cabinet scales off width, or off height alone — either one is enough
  // to have a target. A plain floor work needs both face dimensions: "match the
  // box to the work" has no target when the work's own size is half-unknown,
  // and the render layer is falling back to the image's native aspect there
  // anyway, so there is no discrepancy to explain.
  const hasTarget = isMonitor
    ? widthMm !== undefined || heightMm !== undefined
    : widthMm !== undefined && heightMm !== undefined;
  if (!hasTarget) return null;

  const target = isMonitor
    ? monitorBoxSizeMm(dimensions)
    : { widthMm: widthMm as number, heightMm: heightMm as number, depthMm: undefined };

  const matches =
    Math.abs(objectWidthMm - target.widthMm) < SIZE_MATCH_TOLERANCE_MM &&
    Math.abs(objectHeightMm - target.heightMm) < SIZE_MATCH_TOLERANCE_MM &&
    (target.depthMm === undefined ||
      objectDepthMm === undefined ||
      Math.abs(objectDepthMm - target.depthMm) < SIZE_MATCH_TOLERANCE_MM);
  if (matches) return null;

  // The artwork scope, matching how the Dimensions section above formats the
  // same two numbers — a note that restated the work's size in a different
  // unit than the fields it refers to would read as a third measurement.
  const { displayUnit } = getScopedUnitContext(unit, "artwork");
  const targetSize = `${formatLength(target.widthMm, {
    unit: displayUnit
  })} × ${formatLength(target.heightMm, { unit: displayUnit })}`;

  return (
    // String children rather than JSX text so the sentence's exact spacing is
    // explicit and the apostrophe needs no entity.
    <p className="field-hint floor-artwork-image-size-note">
      {isMonitor
        ? "A monitor for this work measures "
        : "The image stays at the work's own size, "}
      <span className="floor-artwork-image-size-note-value">{targetSize}</span>
      {". "}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="floor-artwork-image-size-note-action"
            type="button"
            onClick={() =>
              onMatchSizeToWork(target.widthMm, target.heightMm, target.depthMm)
            }
          >
            {isMonitor ? "Match monitor to work" : "Match size to work"}
          </button>
        </TooltipTrigger>
        <TooltipContent className="toolbar-tooltip" side="bottom">
          {isMonitor
            ? `Sets Width, Height and Depth above to the cabinet for a ${targetSize} work.`
            : `Sets Width and Height above to ${targetSize}. Depth is left alone.`}
        </TooltipContent>
      </Tooltip>
    </p>
  );
}
