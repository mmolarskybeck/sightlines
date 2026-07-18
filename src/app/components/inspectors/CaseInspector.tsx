import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { CaseFloorObject, CaseWallObject, DisplayUnit } from "../../../domain/project";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";
import { FloorPlacementFields } from "./FloorObjectInspector";
import {
  WallPlacementFields,
  type WallPlacementCenterBoundaryKind
} from "./WallPlacementFields";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { Button } from "../ui/button";

// A freestanding display case: floor-space position (X/Y) and footprint
// (Width/Depth) via the shared FloorPlacementFields, plus an overall Height
// field. Same commit-on-blur/Enter discipline as FloorObjectInspector — the
// tactile (plan drag) and numeric paths must always agree (docs/plan.md §2).
export function FloorCaseInspector({
  floorCase,
  onCommitPosition,
  onCommitSize,
  onCommitHeight,
  onDelete,
  unit
}: {
  floorCase: CaseFloorObject;
  onCommitPosition: (xMm: number, yMm: number) => void;
  onCommitSize: (widthMm: number, depthMm: number) => void;
  onCommitHeight: (heightMm: number) => void;
  onDelete: () => void;
  unit: DisplayUnit;
}) {
  const size = getScopedUnitContext(unit, "openingSize");

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {/* No "Kind" row: the panel's subject header already names it
          ("Display case / Floor object"). */}
      <FloorPlacementFields
        floorObject={floorCase}
        onCommitPosition={onCommitPosition}
        onCommitSize={onCommitSize}
        unit={unit}
      />

      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Height"
          valueMm={floorCase.heightMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(heightMm) => onCommitHeight(heightMm)}
        />
      </InspectorFieldGrid>

      <div className="inspector-placement">
        <Button
          className="inspector-action inspector-danger"
          variant="destructive-ghost"
          onClick={onDelete}
        >
          <TrashIcon aria-hidden="true" size={15} />
          Delete display case
        </Button>
      </div>
    </form>
  );
}

// A wall-cantilevered display case: along-wall position + mount (Center) height
// via the shared WallPlacementFields, plus its box Width/Height/Depth. Every
// numeric edit commits through updateWallCase, mirroring OpeningInspector.
export function WallCaseInspector({
  wallCase,
  wallLengthMm,
  centerTargetXMm,
  centerBoundaryKind,
  onCommitPosition,
  onCommitSize,
  onDelete,
  unit
}: {
  wallCase: CaseWallObject;
  wallLengthMm: number;
  centerTargetXMm: number;
  centerBoundaryKind: WallPlacementCenterBoundaryKind;
  // Along-wall x plus mount-height center (yMm).
  onCommitPosition: (xMm: number, yMm: number) => void;
  onCommitSize: (widthMm: number, heightMm: number, depthMm: number) => void;
  onDelete: () => void;
  unit: DisplayUnit;
}) {
  const size = getScopedUnitContext(unit, "openingSize");

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Width"
          valueMm={wallCase.widthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(widthMm) => onCommitSize(widthMm, wallCase.heightMm, wallCase.depthMm)}
        />
        <LengthField
          compact
          positiveOnly
          label="Height"
          valueMm={wallCase.heightMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(heightMm) => onCommitSize(wallCase.widthMm, heightMm, wallCase.depthMm)}
        />
      </InspectorFieldGrid>

      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Depth"
          valueMm={wallCase.depthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(depthMm) => onCommitSize(wallCase.widthMm, wallCase.heightMm, depthMm)}
        />
      </InspectorFieldGrid>

      <WallPlacementFields
        placement={wallCase}
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
          Delete display case
        </Button>
      </div>
    </form>
  );
}
