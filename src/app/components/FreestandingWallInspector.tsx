import { useEffect, useState } from "react";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { DisplayUnit, FreestandingWall } from "../../domain/project";
import {
  getFreestandingAngleDeg,
  getFreestandingLengthMm
} from "../../domain/geometry/freestandingWalls";
import {
  partitionAxisForWorldAxis,
  type PartitionClearances,
  type SideClearance
} from "../../domain/geometry/partitionSpacing";
import {
  FREESTANDING_CLEARANCE_SIDES,
  parseClearanceSide,
  type FreestandingClearanceSide
} from "../../domain/geometry/freestandingWalls";
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
  clearances,
  onCommitClearance,
  onViewFace,
  onDuplicate,
  onDelete
}: {
  wall: FreestandingWall;
  unit: DisplayUnit;
  onCommitLength: (lengthMm: number) => Promise<void> | void;
  onCommitAngle: (angleDeg: number) => Promise<void> | void;
  onCommitThickness: (thicknessMm: number) => Promise<void> | void;
  onCommitHeight: (heightMm: number) => Promise<void> | void;
  onCenter: (axis: "normal" | "axis") => Promise<void> | void;
  clearances: PartitionClearances | null;
  onCommitClearance: (
    side: FreestandingClearanceSide,
    distanceMm: number
  ) => Promise<void> | void;
  onViewFace: (face: "a" | "b") => void;
  onDuplicate: () => Promise<void> | void;
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
          Hang artwork on either face. Each side gets its own elevation view.
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

      {clearances ? (
        <InspectorSection collapsible={false} title="Distances">
          <InspectorFieldGrid columns={2}>
            {clearanceFields(clearances).map(({ side, clearance, fallbackLabel }) =>
              clearance.hit ? (
                <LengthField
                  key={`${wall.id}-${side}`}
                  label={clearanceLabel(clearance, fallbackLabel)}
                  valueMm={clearance.hit.distanceMm}
                  displayUnit={wallScope.displayUnit}
                  parseUnit={wallScope.parseUnit}
                  placeholder={wallPlaceholder}
                  onCommit={(distanceMm) => {
                    if (distanceMm < 0) throw new Error("Distance cannot be negative.");
                    return onCommitClearance(side, distanceMm);
                  }}
                  commitErrorFallback="Could not move this partition."
                />
              ) : null
            )}
          </InspectorFieldGrid>
        </InspectorSection>
      ) : null}

      <Button className="inspector-action" variant="inspector" onClick={() => void onDuplicate()}>
        <CopyIcon aria-hidden="true" size={15} />
        Duplicate partition
      </Button>

      <Button className="inspector-action inspector-danger" variant="destructive-ghost" onClick={onDelete}>
        <TrashIcon aria-hidden="true" size={15} />
        Delete partition
      </Button>
    </form>
  );
}

const CLEARANCE_FALLBACK_LABELS: Record<FreestandingClearanceSide, string> = {
  "normal-plus": "Side A",
  "normal-minus": "Side B",
  "span-minus": "End A",
  "span-plus": "End B"
};

function clearanceFields(clearances: PartitionClearances): {
  side: FreestandingClearanceSide;
  clearance: SideClearance;
  fallbackLabel: string;
}[] {
  return FREESTANDING_CLEARANCE_SIDES.map((side) => {
    const { axis, sign } = parseClearanceSide(side);
    return { side, clearance: clearances[axis][sign], fallbackLabel: CLEARANCE_FALLBACK_LABELS[side] };
  });
}

function clearanceLabel(clearance: SideClearance, fallback: string): string {
  const { xMm, yMm } = clearance.dirUnit;
  const axisEpsilon = 1e-6;
  if (Math.abs(yMm) <= axisEpsilon && Math.abs(xMm) > axisEpsilon) {
    return xMm > 0 ? "To right" : "To left";
  }
  if (Math.abs(xMm) <= axisEpsilon && Math.abs(yMm) > axisEpsilon) {
    return yMm > 0 ? "To down" : "To up";
  }
  return fallback;
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
