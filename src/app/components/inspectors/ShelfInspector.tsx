import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { DisplayUnit, ShelfWallObject } from "../../../domain/project";
import { shelfTopYMm } from "../../../domain/geometry/shelfGlyphs";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";
import {
  WallPlacementFields,
  type WallPlacementCenterBoundaryKind
} from "./WallPlacementFields";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { InspectorNotice } from "./InspectorNotice";
import { InspectorSummaryRow } from "./InspectorSummaryRow";
import { ShelfGlyph } from "../toolbar/toolbarGlyphs";
import { Button } from "../ui/button";

// A wall shelf: the same shape as WallCaseInspector beside it — shared
// WallPlacementFields for along-wall position, then the slab's own numbers —
// with two differences that are entirely about what a shelf IS.
//
// 1. TOP HEIGHT. A curator authors a shelf by the face a work stands on, not by
//    the middle of the timber, so the height field here is the TOP and the
//    conversion to the stored centre (yMm) happens once, at the commit, through
//    shelfCenterYMmForTop. WallPlacementFields still carries its own "Center
//    height" row — it is the shared control and the centre is the stored truth —
//    so the two heights sit a thickness/2 apart on purpose.
// 2. THICKNESS, not Height. `heightMm` is the slab's vertical thickness for a
//    shelf, and calling the field "Height" beside a "Top height" field would be
//    unreadable. Changing it keeps the TOP fixed (the store recomputes yMm), so
//    a thicker shelf grows downward and the works standing on it never move.
export function ShelfInspector({
  shelf,
  riderCount,
  onSelectRiders,
  wallLengthMm,
  centerTargetXMm,
  centerBoundaryKind,
  onCommitPosition,
  onCommitSize,
  onCommitTop,
  onDelete,
  unit
}: {
  shelf: ShelfWallObject;
  // How many works are standing on this shelf right now, derived by
  // getShelfRiders — never stored, so this is a live readout, not a count of
  // anything the shelf remembers.
  riderCount: number;
  onSelectRiders: () => void;
  wallLengthMm: number;
  centerTargetXMm: number;
  centerBoundaryKind: WallPlacementCenterBoundaryKind;
  // Along-wall x plus the stored slab CENTRE (yMm), straight from the shared
  // placement fields.
  onCommitPosition: (xMm: number, yMm: number) => void;
  onCommitSize: (widthMm: number, thicknessMm: number, depthMm: number) => void;
  // The TOP face's height. The store converts it to the stored centre.
  onCommitTop: (topMm: number) => void;
  onDelete: () => void;
  unit: DisplayUnit;
}) {
  const size = getScopedUnitContext(unit, "openingSize");
  const position = getScopedUnitContext(unit, "openingPosition");

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {/* An empty shelf reads as a blank slab of numbers unless something
          teaches the gesture; once works are standing on it, "Holds" is the
          way back to them from the shelf's own inspector. */}
      {riderCount === 0 ? (
        <InspectorNotice tone="info" icon={<ShelfGlyph aria-hidden="true" size={15} />}>
          Nothing on this shelf yet. Drag a work over it to stand it on the
          shelf.
        </InspectorNotice>
      ) : (
        <InspectorSummaryRow
          label="Holds"
          value={`${riderCount} work${riderCount === 1 ? "" : "s"}`}
          action={
            <Button
              className="inspector-action"
              size="sm"
              variant="ghost"
              onClick={onSelectRiders}
            >
              Select works
            </Button>
          }
        />
      )}

      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Width"
          valueMm={shelf.widthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(widthMm) => onCommitSize(widthMm, shelf.heightMm, shelf.depthMm)}
        />
        <LengthField
          compact
          positiveOnly
          label="Depth"
          valueMm={shelf.depthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(depthMm) => onCommitSize(shelf.widthMm, shelf.heightMm, depthMm)}
        />
      </InspectorFieldGrid>

      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Thickness"
          valueMm={shelf.heightMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(thicknessMm) =>
            onCommitSize(shelf.widthMm, thicknessMm, shelf.depthMm)
          }
        />
        <LengthField
          compact
          positiveOnly
          label="Top height"
          valueMm={shelfTopYMm(shelf)}
          displayUnit={position.displayUnit}
          parseUnit={position.parseUnit}
          placeholder={position.placeholder}
          stepMm={position.stepMm}
          onCommit={(topMm) => onCommitTop(topMm)}
        />
      </InspectorFieldGrid>

      <WallPlacementFields
        placement={shelf}
        wallLengthMm={wallLengthMm}
        centerTargetXMm={centerTargetXMm}
        centerBoundaryKind={centerBoundaryKind}
        unit={unit}
        onCommit={onCommitPosition}
      />

      <div className="inspector-placement">
        <Button
          className="inspector-action inspector-danger"
          variant="destructive-ghost"
          onClick={onDelete}
        >
          <TrashIcon aria-hidden="true" size={15} />
          Delete shelf
        </Button>
      </div>
    </form>
  );
}
