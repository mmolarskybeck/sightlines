import { useEffect, useState } from "react";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsHorizontal";
import { ArrowsInLineHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsInLineHorizontal";
import { ArrowsOutLineHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutLineHorizontal";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { DisplayUnit } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import {
  getPlaceholderForScope,
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "../../domain/units/unitSystem";
import { LengthField } from "./LengthField";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Button } from "./ui/button";

// Wall-length nudge per stepper press / ArrowUp-Down: a clean ¼″ for imperial,
// a round 10mm for metric — the same "smallest sensible hand adjustment" the
// arrow-key nudges use, matched to each system so the value lands on tidy
// numbers instead of a converted fraction.
const IMPERIAL_STEP_MM = 12.7;
const METRIC_STEP_MM = 10;

type ArrangeMode = "equal" | "inset" | "gap";

// Right-inspector panel for a multi-object selection (2+ placements picked in
// the plan/elevation view). Props-driven, same discipline as
// ArtworkInspector/OpeningInspector — nothing here reaches into the store, so
// the store's arrange/remove guards (the arrange-session actions,
// removeSelectedPlacements) are the only place the actual rules live; this
// component just renders whatever the caller decided the selection can do.
//
// The arrange controls speak the curator's physical language, never the
// engine's: the segmented control offers "Space evenly / From wall edges /
// Between works" (internal modes equal/inset/gap), only the chosen mode's
// value is editable, and the companion measurement it forces reads as plain
// "Calculated" text. A live arrange session (arrange.sessionActive) surfaces
// Apply/Cancel; committing/reverting is the caller's job.
export function SelectionInspector({
  arrange,
  arrangeDisabledReason,
  count,
  unit,
  wallName,
  onSetMode,
  onArrangeValue,
  onAcceptArrange,
  onCancelArrange,
  onRemoveAll
}: {
  count: number;
  unit: DisplayUnit;
  // The wall the selection lives on, for the section header; null falls back
  // to the generic "Arrange on wall".
  wallName: string | null;
  // null when the selection can't be arranged (not 2+ wall objects on one
  // wall) — see the arrange-session guards in store.ts. `mode` is the current
  // interpretation of the layout and is ALWAYS one of the three modes (a live
  // session's mode, "equal" when the freeform layout already reads as evenly
  // spaced, else the caller's remembered lastArrangeMode) — the panel never
  // sits in a no-mode state. The *IsMixed flags say whether a single companion
  // value can be trusted.
  arrange: {
    mode: ArrangeMode;
    insetMm: number;
    gapMm: number;
    insetIsMixed: boolean;
    gapIsMixed: boolean;
    equalSpacingMm: number;
    sessionActive: boolean;
  } | null;
  arrangeDisabledReason?: string;
  onSetMode: (mode: ArrangeMode) => void;
  onArrangeValue: (params: { insetMm: number } | { gapMm: number }) => void;
  onAcceptArrange: () => void;
  onCancelArrange: () => void;
  onRemoveAll: () => void;
}) {
  const system = unitSystemFromDisplayUnit(unit);
  // Margin/spacing are wall-length measurements, same natural unit as an
  // opening's X position (docs/plan.md's openingPosition scope) — inset and
  // gap are just two more offsets along the wall.
  const { displayUnit, parseUnit } = getScopeUnits(system, "openingPosition");
  const placeholder = getPlaceholderForScope(system, "openingPosition");
  const stepMm = system === "metric" ? METRIC_STEP_MM : IMPERIAL_STEP_MM;

  const formatValue = (valueMm: number) => formatLength(valueMm, { unit: displayUnit });

  // "Remove all" is destructive and irreversible-feeling, so it takes a two-
  // step confirm (same pattern as RoomsPanel's delete): the first click swaps
  // the row for "Remove N objects?" with confirm/keep buttons. "Objects" (not
  // "works") because the selection can mix artworks and openings, matching the
  // "N objects selected" header. The transient confirm resets whenever the
  // selection size changes, so a stale confirm can never fire against a
  // different selection.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  useEffect(() => {
    setConfirmingRemove(false);
  }, [count]);

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <h3>
        {count} object{count === 1 ? "" : "s"} selected
      </h3>

      <div className="artwork-dimensions">
        <div className="artwork-dimensions-heading">
          <h3>Arrange on {wallName ?? "wall"}</h3>
        </div>

        {arrange ? (
          <div className="arrange-controls">
            <ToggleGroup
              aria-label="Spacing method"
              className="arrange-modes"
              // Three-across segments, each an icon over a label that may wrap
              // to two lines. Horizontal orientation keeps Radix's roving
              // Left/Right arrow navigation.
              orientation="horizontal"
              type="single"
              value={arrange.mode}
              onValueChange={(value) => {
                // A Radix single toggle-group fires "" when the active segment
                // is clicked again (deselect). The displayed mode is often just
                // the remembered default (lastArrangeMode) with no live session
                // behind it, so a re-click must APPLY the mode, not deselect —
                // clicking "Space evenly" has to space evenly even when that
                // segment already reads as active.
                if (value === "equal" || value === "inset" || value === "gap") {
                  onSetMode(value);
                } else {
                  onSetMode(arrange.mode);
                }
              }}
            >
              <ToggleGroupItem className="arrange-mode" value="equal">
                <ArrowsOutLineHorizontalIcon aria-hidden="true" size={16} />
                <span>Space evenly</span>
              </ToggleGroupItem>
              <ToggleGroupItem className="arrange-mode" value="inset">
                <ArrowsInLineHorizontalIcon aria-hidden="true" size={16} />
                <span>From wall edges</span>
              </ToggleGroupItem>
              <ToggleGroupItem className="arrange-mode" value="gap">
                <ArrowsHorizontalIcon aria-hidden="true" size={16} />
                <span>Between works</span>
              </ToggleGroupItem>
            </ToggleGroup>

            {arrange.mode === "equal" ? (
              <div className="arrange-mode-body">
                <div className="arrange-readout">
                  <span className="arrange-readout-label">Equal distance</span>
                  <span className="arrange-readout-value-row">
                    <span className="arrange-readout-value">
                      {formatValue(arrange.equalSpacingMm)}
                    </span>
                  </span>
                </div>
                <p className="field-hint">Same from wall edges and between works.</p>
              </div>
            ) : arrange.mode === "inset" ? (
              <div className="arrange-mode-body">
                <LengthField
                  compact
                  label="Distance from each wall edge"
                  valueMm={arrange.insetMm}
                  displayUnit={displayUnit}
                  parseUnit={parseUnit}
                  placeholder={placeholder}
                  stepMm={stepMm}
                  onCommit={(insetMm) => onArrangeValue({ insetMm })}
                  onEnterWhenClean={onAcceptArrange}
                />
                <ArrangeCalculatedReadout
                  label="Distance between works"
                  value={arrange.gapIsMixed ? "Mixed" : formatValue(arrange.gapMm)}
                  isMixed={arrange.gapIsMixed}
                />
                <p className="field-hint">The group stays centered.</p>
              </div>
            ) : (
              <div className="arrange-mode-body">
                <LengthField
                  compact
                  label="Distance between works"
                  valueMm={arrange.gapMm}
                  displayUnit={displayUnit}
                  parseUnit={parseUnit}
                  placeholder={placeholder}
                  stepMm={stepMm}
                  onCommit={(gapMm) => onArrangeValue({ gapMm })}
                  onEnterWhenClean={onAcceptArrange}
                />
                <ArrangeCalculatedReadout
                  label="Distance from each wall edge"
                  value={arrange.insetIsMixed ? "Mixed" : formatValue(arrange.insetMm)}
                  isMixed={arrange.insetIsMixed}
                />
                <p className="field-hint">The group stays centered.</p>
              </div>
            )}

            {arrange.sessionActive ? (
              <div className="arrange-actions">
                <Button
                  className="inspector-action arrange-apply"
                  variant="primary"
                  onClick={onAcceptArrange}
                >
                  <CheckIcon aria-hidden="true" size={15} />
                  Apply
                </Button>
                <Button
                  className="inspector-action arrange-cancel"
                  variant="inspector"
                  onClick={onCancelArrange}
                >
                  <XIcon aria-hidden="true" size={15} />
                  Cancel
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="field-hint">{arrangeDisabledReason}</p>
        )}
      </div>

      <div className="inspector-placement">
        {confirmingRemove ? (
          <div className="remove-all-confirm">
            <span className="remove-all-confirm-label">
              Remove {count} object{count === 1 ? "" : "s"}?
            </span>
            <Button
              aria-label={`Remove ${count} selected object${count === 1 ? "" : "s"}`}
              className="arrange-confirm-btn arrange-confirm-yes"
              variant="destructive"
              onClick={() => {
                setConfirmingRemove(false);
                onRemoveAll();
              }}
            >
              <CheckIcon aria-hidden="true" size={15} />
            </Button>
            <Button
              aria-label="Keep the selection"
              className="arrange-confirm-btn arrange-confirm-no"
              variant="inspector"
              onClick={() => setConfirmingRemove(false)}
            >
              <XIcon aria-hidden="true" size={15} />
            </Button>
          </div>
        ) : (
          <Button
            className="inspector-action inspector-remove-all"
            variant="destructive"
            onClick={() => setConfirmingRemove(true)}
          >
            <TrashIcon aria-hidden="true" size={15} />
            Remove all
          </Button>
        )}
      </div>
    </form>
  );
}

// The one calculated companion readout: a small muted label on line 1, then the
// value (semibold, larger) on line 2 with the "Calculated" tag inline right
// after it. A "Mixed" value shows no tag — a mixed layout isn't a single
// calculated value.
function ArrangeCalculatedReadout({
  label,
  value,
  isMixed
}: {
  label: string;
  value: string;
  isMixed: boolean;
}) {
  return (
    <div className="arrange-readout">
      <span className="arrange-readout-label">{label}</span>
      <span className="arrange-readout-value-row">
        <span className="arrange-readout-value">{value}</span>
        {isMixed ? null : <span className="arrange-calculated">Calculated</span>}
      </span>
    </div>
  );
}
