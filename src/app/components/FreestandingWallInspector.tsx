import { useEffect, useState } from "react";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { DisplayUnit, FreestandingWall } from "../../domain/project";
import {
  getFreestandingAngleDeg,
  getFreestandingLengthMm
} from "../../domain/geometry/freestandingWalls";
import { partitionAxisForWorldAxis } from "../../domain/geometry/partitionSpacing";
import { getScopedUnitContext } from "./scopedUnits";
import { LengthField } from "./LengthField";
import { InspectorSection } from "./InspectorSection";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { InspectorActionGroup } from "./InspectorActionGroup";
import { Button } from "./ui/button";
import { Field } from "./ui/field";
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
  onCenter,
  onViewFace,
  onDelete
}: {
  wall: FreestandingWall;
  unit: DisplayUnit;
  onCommitLength: (lengthMm: number) => Promise<void> | void;
  onCommitAngle: (angleDeg: number) => Promise<void> | void;
  onCommitThickness: (thicknessMm: number) => Promise<void> | void;
  onCommitHeight: (heightMm: number) => Promise<void> | void;
  onCenter: (axis: "normal" | "axis") => Promise<void> | void;
  onViewFace: (face: "a" | "b") => void;
  onDelete: () => void;
}) {
  const { displayUnit, parseUnit, placeholder } = getScopedUnitContext(unit, "wall");
  const wallScope = { displayUnit, parseUnit };
  const wallPlaceholder = placeholder;

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <div className="inspector-placement">
        <InspectorActionGroup label="View a face in elevation">
          <Button className="inspector-action" variant="inspector" onClick={() => onViewFace("a")}>
            View side A
          </Button>
          <Button className="inspector-action" variant="inspector" onClick={() => onViewFace("b")}>
            View side B
          </Button>
        </InspectorActionGroup>
        <p className="field-hint">
          Hang artwork on either face — each side gets its own elevation view.
        </p>
      </div>

      <div className="inspector-placement">
        <InspectorActionGroup label="Center this partition">
          <Button
            className="inspector-action"
            variant="inspector"
            onClick={() => void onCenter(partitionAxisForWorldAxis(wall, "x"))}
          >
            Center left–right
          </Button>
          <Button
            className="inspector-action"
            variant="inspector"
            onClick={() => void onCenter(partitionAxisForWorldAxis(wall, "y"))}
          >
            Center up–down
          </Button>
        </InspectorActionGroup>
      </div>

      <InspectorSection collapsible={false} title="Partition">
        <InspectorFieldGrid columns={2}>
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
        </InspectorFieldGrid>
        <InspectorFieldGrid columns={2}>
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
        </InspectorFieldGrid>
      </InspectorSection>

      <Button className="inspector-action inspector-danger" variant="destructive-ghost" onClick={onDelete}>
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
    <Field label="Angle (°)">
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
    </Field>
  );
}
