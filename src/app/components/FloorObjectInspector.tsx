import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { getOpeningKindLabel } from "../../domain/placement/createOpening";
import type { BlockedZoneFloorObject, DisplayUnit, FloorObject } from "../../domain/project";
import { getScopedUnitContext } from "./scopedUnits";
import { LengthField } from "./LengthField";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { Button } from "./ui/button";

// The floor-space position (X/Y) and editable footprint (Width/Depth) shared
// by FloorObjectInspector (a floor blocked zone) and ArtworkInspector's
// floor-placed branch. Same numeric commit-on-blur/Enter discipline as
// OpeningInspector — the tactile (plan drag) and numeric paths must always
// agree. Floor objects carry no wall bounds, so nothing here validates
// against a wall (see the store's updateFloorObject / placeArtworkOnFloor).
export function FloorPlacementFields({
  floorObject,
  onCommitPosition,
  onCommitSize,
  unit
}: {
  floorObject: Pick<FloorObject, "xMm" | "yMm" | "widthMm" | "depthMm">;
  onCommitPosition: (xMm: number, yMm: number) => void;
  onCommitSize: (widthMm: number, depthMm: number) => void;
  unit: DisplayUnit;
}) {
  const position = getScopedUnitContext(unit, "openingPosition");
  const size = getScopedUnitContext(unit, "openingSize");

  return (
    <>
      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          label="X (floor)"
          valueMm={floorObject.xMm}
          displayUnit={position.displayUnit}
          parseUnit={position.parseUnit}
          placeholder={position.placeholder}
          onCommit={(xMm) => onCommitPosition(xMm, floorObject.yMm)}
        />
        <LengthField
          compact
          label="Y (floor)"
          valueMm={floorObject.yMm}
          displayUnit={position.displayUnit}
          parseUnit={position.parseUnit}
          placeholder={position.placeholder}
          onCommit={(yMm) => onCommitPosition(floorObject.xMm, yMm)}
        />
      </InspectorFieldGrid>

      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Width"
          valueMm={floorObject.widthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(widthMm) => onCommitSize(widthMm, floorObject.depthMm)}
        />
        <LengthField
          compact
          positiveOnly
          label="Depth"
          valueMm={floorObject.depthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(depthMm) => onCommitSize(floorObject.widthMm, depthMm)}
        />
      </InspectorFieldGrid>
    </>
  );
}

// Numeric editor for a selected floor-placed blocked zone, mirroring
// OpeningInspector's structure (kind label, position/size fields, delete).
// Floor-placed artworks reuse FloorPlacementFields beneath ArtworkInspector
// instead — their identity/dimension editing already lives there.
export function FloorObjectInspector({
  floorObject,
  onCommitPosition,
  onCommitSize,
  onDelete,
  unit
}: {
  floorObject: BlockedZoneFloorObject;
  onCommitPosition: (xMm: number, yMm: number) => void;
  onCommitSize: (widthMm: number, depthMm: number) => void;
  onDelete: () => void;
  unit: DisplayUnit;
}) {
  const kindLabel = getOpeningKindLabel(floorObject.kind);

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {/* No "Kind" row: the panel's subject header directly above already
          names it (e.g. "Blocked zone / Floor object"). */}
      <FloorPlacementFields
        floorObject={floorObject}
        onCommitPosition={onCommitPosition}
        onCommitSize={onCommitSize}
        unit={unit}
      />

      <div className="inspector-placement">
        <Button className="inspector-action inspector-danger" variant="destructive-ghost" onClick={onDelete}>
          <TrashIcon aria-hidden="true" size={15} />
          Delete {kindLabel.toLowerCase()}
        </Button>
      </div>
    </form>
  );
}
