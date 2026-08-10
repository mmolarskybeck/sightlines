import type { Dimensions, DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// How far apart the two sizes have to be before the note appears. Both sides
// are curator-entered lengths already rounded to whole millimetres by
// LengthField, so anything under half a millimetre is float noise from a
// unit round-trip, not a difference anyone typed.
const SIZE_MATCH_TOLERANCE_MM = 0.5;

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
// Only ever mounted from App's `placedFloorArtwork` branch. It renders nothing
// unless BOTH of the work's face dimensions are recorded: "match the box to the
// work" has no target when the work's own size is half-unknown, and the render
// layer is falling back to the image's native aspect there anyway, so there is
// no discrepancy to explain.
//
// SHAPE. A footnote, not a status. It carries `.field-hint` — the same species
// as the "Floor-placed in plan view." line App renders three fields above it —
// and the corrective rides at the end of the sentence as an inline text action
// (the `.settings-link` tertiary-action species, tinted petrol because this one
// writes numbers rather than opening a page). No fill, no icon, no button
// chrome: a filled InspectorNotice card read as an alert for what is a quiet
// factual aside, and DESIGN.md keeps inspector panels flat, reserving fills and
// shadows for real overlays. Two lines instead of a 87px card.
export function FloorArtworkImageSizeNote({
  dimensions,
  objectWidthMm,
  objectHeightMm,
  unit,
  onMatchSizeToWork
}: {
  // The WORK's recorded dimensions (the artwork record), not the floor
  // object's.
  dimensions: Dimensions;
  objectWidthMm: number;
  objectHeightMm: number;
  unit: DisplayUnit;
  // Writes the work's width/height onto the floor object. Depth is
  // deliberately not this action's business: it describes how thick the board
  // or plinth is, which the work's face dimensions say nothing about.
  onMatchSizeToWork: (widthMm: number, heightMm: number) => void;
}) {
  const { widthMm, heightMm } = dimensions;
  if (widthMm === undefined || heightMm === undefined) return null;

  const matches =
    Math.abs(objectWidthMm - widthMm) < SIZE_MATCH_TOLERANCE_MM &&
    Math.abs(objectHeightMm - heightMm) < SIZE_MATCH_TOLERANCE_MM;
  if (matches) return null;

  // The artwork scope, matching how the Dimensions section above formats the
  // same two numbers — a note that restated the work's size in a different
  // unit than the fields it refers to would read as a third measurement.
  const { displayUnit } = getScopedUnitContext(unit, "artwork");
  const workSize = `${formatLength(widthMm, { unit: displayUnit })} × ${formatLength(
    heightMm,
    { unit: displayUnit }
  )}`;

  return (
    // String children rather than JSX text so the sentence's exact spacing is
    // explicit and the apostrophe needs no entity.
    <p className="field-hint floor-artwork-image-size-note">
      {"The image stays at the work's own size, "}
      <span className="floor-artwork-image-size-note-value">{workSize}</span>
      {". "}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="floor-artwork-image-size-note-action"
            type="button"
            onClick={() => onMatchSizeToWork(widthMm, heightMm)}
          >
            Match size to work
          </button>
        </TooltipTrigger>
        <TooltipContent className="toolbar-tooltip" side="bottom">
          {`Sets Width and Height above to ${workSize}. Depth is left alone.`}
        </TooltipContent>
      </Tooltip>
    </p>
  );
}
