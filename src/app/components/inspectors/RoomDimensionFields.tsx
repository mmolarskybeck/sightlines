import type { DisplayUnit } from "../../../domain/project";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";

export function RoomDimensionFields({
  depthMm,
  onCommitDepth,
  onCommitWidth,
  unit,
  widthMm
}: {
  depthMm: number;
  onCommitDepth: (lengthMm: number) => Promise<void>;
  onCommitWidth: (lengthMm: number) => Promise<void>;
  unit: DisplayUnit;
  widthMm: number;
}) {
  const { displayUnit, parseUnit, placeholder } = getScopedUnitContext(unit, "wall");

  return (
    <div className="room-dimensions">
      <LengthField
        compact
        positiveOnly
        label="Width"
        valueMm={widthMm}
        displayUnit={displayUnit}
        parseUnit={parseUnit}
        placeholder={placeholder}
        onCommit={onCommitWidth}
        commitErrorFallback="Could not resize Width."
      />
      <LengthField
        compact
        positiveOnly
        label="Depth"
        valueMm={depthMm}
        displayUnit={displayUnit}
        parseUnit={parseUnit}
        placeholder={placeholder}
        onCommit={onCommitDepth}
        commitErrorFallback="Could not resize Depth."
      />
    </div>
  );
}
