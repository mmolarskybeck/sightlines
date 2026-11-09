import { useState } from "react";
import type { Dimensions, DisplayUnit } from "../../../domain/project";
import { SIZE_MATCH_TOLERANCE_MM } from "../../../domain/placement/artworkForm";
import { monitorBoxSizeMm } from "../../../domain/geometry/monitorGlyphs";
import { formatLength } from "../../../domain/units/length";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { InspectorSummaryRow } from "./InspectorSummaryRow";
import { Button } from "../ui/button";

// The BOX standing on the floor, as one summary row that expands into its own
// numbers (floor-supports spec §7). It replaces FloorArtworkImageSizeNote,
// whose job was the same fact stated only while it was going wrong.
//
// TWO MEASUREMENTS, ONE PANEL. The Dimensions section above sizes the WORK; the
// Width/Depth/Height here size the object standing on the floor — a projection
// board, a sculpture's bounding volume, a monitor's cabinet. 3D draws the image
// at the WORK's size on the box's face, so widening a board simply reveals more
// bare board (floorObjectImageFaces.ts). A curator needs to be able to see, at
// a glance and at rest, whether the two currently agree.
//
// "Same as work" DESCRIBES PRESENT EQUALITY, never a live link (USER DECISION
// 2026-09-18, replacing the old hide-unless-diverged note): correcting the
// work's recorded dimensions must never silently resize a board someone built
// to a size. "Reset" is the only thing that copies one onto the other, and it
// is a one-shot write, exactly the write the old note's "Match size to work"
// made.
//
// A BOX MONITOR asks the same question about a different box. Its floor object
// is the CABINET — a 4:3 face scaled off the work, MONITOR_DEPTH_MM deep — so
// the comparison target is the cabinet the work implies, not the work's own
// face, and all three axes travel together because a cabinet is one
// indivisible piece of equipment.
export function FloorArtworkFootprintRow({
  dimensions,
  isMonitor = false,
  // Keys the local expansion state. A draft must never outlive the selection
  // that opened it (see the Details stale-draft trap in docs/decisions.md), so
  // the expanded fields are also keyed on it and remount with the selection.
  placementId,
  widthMm,
  depthMm,
  heightMm,
  unit,
  onCommit
}: {
  // The WORK's recorded dimensions (the artwork record), not the box's.
  dimensions: Dimensions;
  isMonitor?: boolean;
  placementId: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  unit: DisplayUnit;
  // Straight onto updateFloorObject — the same call the old note's corrective
  // made, so the numeric path and the one-shot Reset write through one seam.
  onCommit: (changes: {
    widthMm?: number;
    depthMm?: number;
    heightMm?: number;
  }) => void;
}) {
  // Not a ref and not derived from the values: a curator who wants to see the
  // numbers while they still agree has asked for something the geometry cannot
  // tell us. `null` is the resting state and any other selection resets it,
  // because the id no longer matches.
  const [editingId, setEditingId] = useState<string | null>(null);

  const size = getScopedUnitContext(unit, "openingSize");
  const format = (mm: number) => formatLength(mm, { unit: size.displayUnit });

  // The cabinet scales off width, or off height alone — either is enough to
  // have a target. A plain floor work needs both face dimensions: "the same as
  // the work" has no meaning when the work's own size is half-unknown, and the
  // render layer falls back to the image's native aspect there anyway.
  const target = hasComparisonTarget(dimensions, isMonitor)
    ? isMonitor
      ? monitorBoxSizeMm(dimensions)
      : {
          widthMm: dimensions.widthMm as number,
          heightMm: dimensions.heightMm as number,
          depthMm: undefined
        }
    : null;

  const differs =
    target !== null &&
    !(
      Math.abs(widthMm - target.widthMm) < SIZE_MATCH_TOLERANCE_MM &&
      Math.abs(heightMm - target.heightMm) < SIZE_MATCH_TOLERANCE_MM &&
      (target.depthMm === undefined ||
        Math.abs(depthMm - target.depthMm) < SIZE_MATCH_TOLERANCE_MM)
    );

  // Diverged numbers keep the fields open whatever the toggle says: the row's
  // action is "Reset" then, so collapsing would leave no way back to them.
  const expanded = differs || editingId === placementId;

  const comparison = target === null ? null : differs ? "Differs from work" : "Same as work";
  const footprint = `${format(widthMm)} × ${format(depthMm)}`;

  return (
    <>
      <InspectorSummaryRow
        label="Footprint"
        value={footprint}
        // The comparison is the qualifier, so it rides the hint line and the
        // value stays two numbers wide — which is what keeps Edit / Reset on
        // the row's right edge instead of wrapping under it.
        hint={comparison}
        action={
          differs ? (
            <Button
              className="inspector-action"
              size="sm"
              variant="ghost"
              onClick={() =>
                onCommit({
                  widthMm: target.widthMm,
                  heightMm: target.heightMm,
                  // A plain floor work resets its FACE only: depth describes
                  // how thick the board or plinth is, which the work's own
                  // dimensions say nothing about. A cabinet resets all three.
                  ...(target.depthMm !== undefined ? { depthMm: target.depthMm } : {})
                })
              }
            >
              Reset
            </Button>
          ) : (
            <Button
              aria-expanded={expanded}
              className="inspector-action"
              size="sm"
              variant="ghost"
              onClick={() => setEditingId(expanded ? null : placementId)}
            >
              Edit
            </Button>
          )
        }
      />

      {expanded ? (
        // Keyed on the placement so every draft in here is abandoned when the
        // selection changes, rather than blurring the previous work's number
        // onto the new one — the two grids stay SIBLINGS of the row (no
        // wrapper element) so they keep the form's own vertical rhythm.
        <>
          <InspectorFieldGrid key={`${placementId}-footprint`} columns={2}>
            <LengthField
              compact
              positiveOnly
              label="Width"
              valueMm={widthMm}
              displayUnit={size.displayUnit}
              parseUnit={size.parseUnit}
              placeholder={size.placeholder}
              onCommit={(next) => onCommit({ widthMm: next })}
            />
            <LengthField
              compact
              positiveOnly
              label="Depth"
              valueMm={depthMm}
              displayUnit={size.displayUnit}
              parseUnit={size.parseUnit}
              placeholder={size.placeholder}
              onCommit={(next) => onCommit({ depthMm: next })}
            />
          </InspectorFieldGrid>

          <InspectorFieldGrid key={`${placementId}-height`} columns={2}>
            <LengthField
              compact
              positiveOnly
              label="Height"
              valueMm={heightMm}
              displayUnit={size.displayUnit}
              parseUnit={size.parseUnit}
              placeholder={size.placeholder}
              onCommit={(next) => onCommit({ heightMm: next })}
            />
          </InspectorFieldGrid>
        </>
      ) : null}
    </>
  );
}

function hasComparisonTarget(dimensions: Dimensions, isMonitor: boolean): boolean {
  return isMonitor
    ? dimensions.widthMm !== undefined || dimensions.heightMm !== undefined
    : dimensions.widthMm !== undefined && dimensions.heightMm !== undefined;
}
