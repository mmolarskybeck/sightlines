import { useEffect, useState } from "react";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { DisplayUnit, FreestandingWall } from "../../domain/project";
import {
  getFreestandingAngleDeg,
  getFreestandingLengthMm
} from "../../domain/geometry/freestandingWalls";
import {
  getPlaceholderForScope,
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "../../domain/units/unitSystem";
import { LengthField } from "./LengthField";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

// The partition inspector (spec §8): length, angle, thickness, height, the two
// face-view buttons, and delete. Purely presentational — every commit routes
// through a store action passed in from App. Faces flow through getProjectWalls,
// so "View side A/B" just points the elevation at a face id.
export function FreestandingWallInspector({
  wall,
  unit,
  onCommitLength,
  onCommitAngle,
  onCommitThickness,
  onCommitHeight,
  onViewFace,
  onDelete
}: {
  wall: FreestandingWall;
  unit: DisplayUnit;
  onCommitLength: (lengthMm: number) => Promise<void> | void;
  onCommitAngle: (angleDeg: number) => Promise<void> | void;
  onCommitThickness: (thicknessMm: number) => Promise<void> | void;
  onCommitHeight: (heightMm: number) => Promise<void> | void;
  onViewFace: (face: "a" | "b") => void;
  onDelete: () => void;
}) {
  const system = unitSystemFromDisplayUnit(unit);
  const wallScope = getScopeUnits(system, "wall");
  const wallPlaceholder = getPlaceholderForScope(system, "wall");

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <div className="inspector-placement">
        <div className="wall-switcher" role="group" aria-label="View a face in elevation">
          <Button className="inspector-action" variant="inspector" onClick={() => onViewFace("a")}>
            View side A
          </Button>
          <Button className="inspector-action" variant="inspector" onClick={() => onViewFace("b")}>
            View side B
          </Button>
        </div>
        <p className="field-hint">
          Hang artwork on either face — each side gets its own elevation view.
        </p>
      </div>

      <div className="artwork-dimensions">
        <div className="artwork-dimensions-heading">
          <h3>Partition</h3>
        </div>
        <LengthField
          positiveOnly
          label="Length"
          valueMm={getFreestandingLengthMm(wall)}
          displayUnit={wallScope.displayUnit}
          parseUnit={wallScope.parseUnit}
          placeholder={wallPlaceholder}
          onCommit={onCommitLength}
          commitErrorFallback="Could not resize this partition."
        />
        <AngleField valueDeg={getFreestandingAngleDeg(wall)} onCommit={onCommitAngle} />
        <LengthField
          positiveOnly
          label="Thickness"
          valueMm={wall.thicknessMm}
          displayUnit={wallScope.displayUnit}
          parseUnit={wallScope.parseUnit}
          placeholder={wallPlaceholder}
          onCommit={onCommitThickness}
          commitErrorFallback="Could not change this partition's thickness."
        />
        <LengthField
          positiveOnly
          label="Height"
          valueMm={wall.heightMm}
          displayUnit={wallScope.displayUnit}
          parseUnit={wallScope.parseUnit}
          placeholder={wallPlaceholder}
          onCommit={onCommitHeight}
          commitErrorFallback="Could not change this partition's height."
        />
      </div>

      <Button className="inspector-action" variant="destructive" onClick={onDelete}>
        <TrashIcon aria-hidden="true" size={15} />
        Delete partition
      </Button>
    </form>
  );
}

// Degrees are unit-agnostic, so this is a plain number field (not a LengthField)
// that commits on blur/Enter and reverts an empty/NaN entry to the live value.
function AngleField({
  valueDeg,
  onCommit
}: {
  valueDeg: number;
  onCommit: (angleDeg: number) => Promise<void> | void;
}) {
  const formatted = String(Math.round(valueDeg * 10) / 10);
  const [draft, setDraft] = useState(formatted);
  useEffect(() => {
    setDraft(formatted);
  }, [formatted]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(formatted);
      return;
    }
    void onCommit(parsed);
  };

  return (
    <label className="field-row">
      <span>Angle (°)</span>
      <Input
        inputMode="decimal"
        value={draft}
        aria-label="Partition angle in degrees"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
      />
    </label>
  );
}
