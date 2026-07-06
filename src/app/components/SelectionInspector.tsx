import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { DisplayUnit } from "../../domain/project";
import {
  getPlaceholderForScope,
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "../../domain/units/unitSystem";
import { LengthField } from "./LengthField";
import { Button } from "./ui/button";

// Right-inspector panel for a multi-object selection (2+ placements picked
// in the plan/elevation view). Props-driven, same discipline as
// ArtworkInspector/OpeningInspector — nothing here reaches into the store,
// so the store's arrange/remove guards (arrangeSelectedOnWall,
// removeSelectedPlacements) are the only place the actual rules live; this
// component just renders whatever the caller decided the selection can do.
export function SelectionInspector({
  arrange,
  arrangeDisabledReason,
  count,
  onArrange,
  onRemoveAll,
  unit
}: {
  count: number;
  unit: DisplayUnit;
  // null when the selection can't be arranged (not 2+ wall objects on one
  // wall) — see arrangeSelectedOnWall's guards in store.ts.
  arrange: { insetMm: number; gapMm: number } | null;
  arrangeDisabledReason?: string;
  onArrange: (params: { insetMm: number } | { gapMm: number } | { equal: true }) => void;
  onRemoveAll: () => void;
}) {
  const system = unitSystemFromDisplayUnit(unit);
  // Margin/spacing are wall-length measurements, same natural unit as an
  // opening's X position (docs/plan.md's openingPosition scope) — inset and
  // gap are just two more offsets along the wall.
  const { displayUnit, parseUnit } = getScopeUnits(system, "openingPosition");
  const placeholder = getPlaceholderForScope(system, "openingPosition");

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <h3>
        {count} object{count === 1 ? "" : "s"} selected
      </h3>

      <div className="artwork-dimensions">
        <div className="artwork-dimensions-heading">
          <h3>Arrange on wall</h3>
        </div>

        {arrange ? (
          <>
            <div className="artwork-dimensions-grid">
              <LengthField
                compact
                label="Wall margin"
                valueMm={arrange.insetMm}
                displayUnit={displayUnit}
                parseUnit={parseUnit}
                placeholder={placeholder}
                onCommit={(insetMm) => onArrange({ insetMm })}
              />
              <LengthField
                compact
                label="Spacing"
                valueMm={arrange.gapMm}
                displayUnit={displayUnit}
                parseUnit={parseUnit}
                placeholder={placeholder}
                onCommit={(gapMm) => onArrange({ gapMm })}
              />
            </div>

            <div className="inspector-placement">
              <Button
                className="inspector-action"
                variant="inspector"
                onClick={() => onArrange({ equal: true })}
              >
                Distribute evenly
              </Button>
            </div>
          </>
        ) : (
          <p className="field-hint">{arrangeDisabledReason}</p>
        )}
      </div>

      <div className="inspector-placement">
        <Button className="inspector-action" variant="destructive" onClick={onRemoveAll}>
          <TrashIcon aria-hidden="true" size={15} />
          Remove all
        </Button>
      </div>
    </form>
  );
}
