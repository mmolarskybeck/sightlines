import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { getOpeningKindLabel } from "../../domain/placement/createOpening";
import type { OpeningWallObject, DisplayUnit } from "../../domain/project";
import { getScopedUnitContext } from "./scopedUnits";
import { LengthField } from "./LengthField";
import { Button } from "./ui/button";

// Numeric position/size fields for a selected door/window/blocked zone,
// mirroring WallInspector's commit-on-blur/Enter pattern exactly — the
// tactile (drag) and numeric paths must always agree (docs/plan.md §2).
export function OpeningInspector({
  onCommitPosition,
  onCommitSize,
  onDelete,
  opening,
  unit
}: {
  onCommitPosition: (xMm: number, yMm: number) => void;
  onCommitSize: (widthMm: number, heightMm: number) => void;
  onDelete: () => void;
  opening: OpeningWallObject;
  unit: DisplayUnit;
}) {
  const position = getScopedUnitContext(unit, "openingPosition");
  const size = getScopedUnitContext(unit, "openingSize");

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {/* No "Kind" row: the panel's subject header directly above already
          names it (e.g. "Door / Opening"). */}
      <div className="field-pair-grid">
        <LengthField
          compact
          label="X (wall start)"
          valueMm={opening.xMm}
          displayUnit={position.displayUnit}
          parseUnit={position.parseUnit}
          placeholder={position.placeholder}
          onCommit={(xMm) => onCommitPosition(xMm, opening.yMm)}
        />
        <LengthField
          compact
          label="Y (from floor)"
          valueMm={opening.yMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(yMm) => onCommitPosition(opening.xMm, yMm)}
        />
      </div>

      <div className="field-pair-grid">
        <LengthField
          compact
          positiveOnly
          label="Width"
          valueMm={opening.widthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(widthMm) => onCommitSize(widthMm, opening.heightMm)}
        />
        <LengthField
          compact
          positiveOnly
          label="Height"
          valueMm={opening.heightMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(heightMm) => onCommitSize(opening.widthMm, heightMm)}
        />
      </div>

      <div className="inspector-placement">
        <Button className="inspector-action inspector-danger" variant="destructive-ghost" onClick={onDelete}>
          <TrashIcon aria-hidden="true" size={15} />
          Delete {getOpeningKindLabel(opening.kind).toLowerCase()}
        </Button>
      </div>
    </form>
  );
}
