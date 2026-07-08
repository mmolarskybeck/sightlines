import { useEffect, useState } from "react";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsHorizontal";
import { ArrowsInLineHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsInLineHorizontal";
import { ArrowsOutLineHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutLineHorizontal";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { DisplayUnit, WallObject } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import {
  getPlaceholderForScope,
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "../../domain/units/unitSystem";
import type { ArrangeBoundary } from "../hooks/arrangeReadout";
import { LengthField } from "./LengthField";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";

// Wall-length nudge per stepper press / ArrowUp-Down: a clean ¼″ for imperial,
// a round 10mm for metric — the same "smallest sensible hand adjustment" the
// arrow-key nudges use, matched to each system so the value lands on tidy
// numbers instead of a converted fraction.
const IMPERIAL_STEP_MM = 12.7;
const METRIC_STEP_MM = 10;

type ArrangeMode = "equal" | "inset" | "gap";
type InsetAnchor = "left" | "both" | "right";
type EvenZone = "wall" | "open";

// "From edges" is deliberately agnostic about what it measures to — a wall
// has an edge, a neighbouring artwork or opening has an edge, and the panel
// never asks the curator to choose which; it states whatever detectBoundary
// found. These turn one ArrangeBoundary into the three copy surfaces that
// need it: the editable field's own label, its "on the {side}" phrasing, and
// the one-line caption confirming the target for anyone not watching the
// canvas closely.
function nearestNounFor(kind: WallObject["kind"]): string {
  switch (kind) {
    case "artwork":
      return "artwork";
    case "door":
      return "door";
    case "window":
      return "window";
    case "blocked-zone":
      return "blocked zone";
  }
}

function edgeFieldLabel(side: "left" | "right", boundary: ArrangeBoundary): string {
  return boundary.type === "wall"
    ? `Distance from ${side} wall edge`
    : `Distance from ${boundary.name} on the ${side}`;
}

function edgeCaption(side: "left" | "right", boundary: ArrangeBoundary): string {
  return boundary.type === "wall"
    ? `Measuring to ${side} wall edge.`
    : `Measuring to nearest ${nearestNounFor(boundary.kind)} on the ${side}.`;
}

function bothEdgeCaption(left: ArrangeBoundary, right: ArrangeBoundary): string {
  if (left.type === "wall" && right.type === "wall") return "Measuring to each wall edge.";
  const leftPhrase =
    left.type === "wall" ? "left wall edge" : `nearest ${nearestNounFor(left.kind)} on the left`;
  const rightPhrase =
    right.type === "wall"
      ? "right wall edge"
      : `nearest ${nearestNounFor(right.kind)} on the right`;
  return `Measuring to ${leftPhrase} and ${rightPhrase}.`;
}

// The same quiet gray pill "Calculated" already uses, reused verbatim per the
// panel's one-tag visual grammar — a curator can tell at a glance that a
// number moves if that neighbour moves, without reading the caption.
//
// `decorative` hides it from the accessible name: a labelBadge sits inside
// the LengthField's own <label>, and a browser folds ALL of a label's text
// content into the input's accessible name — without this the field would
// announce as e.g. "Distance from Portrait Study on the leftNeighbor". The
// label text already names the neighbour, so hiding the tag there loses
// nothing; the ArrangeCalculatedReadout usage isn't inside a <label> at all,
// so it stays announced normally.
function NeighborTag({ decorative = false }: { decorative?: boolean } = {}) {
  return (
    <span aria-hidden={decorative || undefined} className="arrange-tag">
      Neighbor
    </span>
  );
}

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
  arrangeIgnoredNote,
  count,
  unit,
  wallName,
  onSetMode,
  onSetAnchor,
  onSetEvenZone,
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
    // Which side the "From edges" mode measures from. Only affects the
    // inset-mode body; "both" is the centred default.
    insetAnchor: InsetAnchor;
    // Which span "Space evenly" distributes across. Only affects the equal-mode
    // body; "wall" is the whole-wall default.
    evenZone: EvenZone;
    insetMm: number;
    gapMm: number;
    // Distance from the group's leftmost/rightmost edge to whatever
    // leftBoundary/rightBoundary detected on that side — the two single-
    // sided measurements the left/right/both anchors edit and read back.
    leftEdgeDistanceMm: number;
    rightEdgeDistanceMm: number;
    // What "From edges" measures against on each side: the wall, or the
    // nearest unselected neighbour beside the group (auto-detected — there is
    // no manual wall-vs-neighbour toggle). Drives the field label, the
    // "Neighbor" tag, and the caption.
    leftBoundary: ArrangeBoundary;
    rightBoundary: ArrangeBoundary;
    insetIsMixed: boolean;
    gapIsMixed: boolean;
    equalSpacingMm: number;
    sessionActive: boolean;
  } | null;
  arrangeDisabledReason?: string;
  // Set when the selection IS arrangeable but also contains openings (doors/
  // windows/blocked zones), which arranging ignores rather than blocks — shown
  // so that artwork-only scope is explicit instead of silent.
  arrangeIgnoredNote?: string;
  onSetMode: (mode: ArrangeMode) => void;
  onSetAnchor: (anchor: InsetAnchor) => void;
  onSetEvenZone: (zone: EvenZone) => void;
  onArrangeValue: (
    params: { insetMm: number; anchor: InsetAnchor } | { gapMm: number }
  ) => void;
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
            {arrangeIgnoredNote ? (
              <p className="field-hint">{arrangeIgnoredNote}</p>
            ) : null}
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
                <span>From edges</span>
              </ToggleGroupItem>
              <ToggleGroupItem className="arrange-mode" value="gap">
                <ArrowsHorizontalIcon aria-hidden="true" size={16} />
                <span>Between works</span>
              </ToggleGroupItem>
            </ToggleGroup>

            {arrange.mode === "equal" ? (
              <div className="arrange-mode-body">
                {/* A collapsed select rather than a segmented row: the zone is
                    a refinement of "Space evenly", not a peer decision, so the
                    enabled panel shows one value instead of two live options.
                    Radix Select never fires the ""-deselect the old toggle
                    needed a re-click guard for. */}
                <label className="field-row compact">
                  <span>Space within</span>
                  <Select
                    value={arrange.evenZone}
                    onValueChange={(value) => onSetEvenZone(value as EvenZone)}
                  >
                    <SelectTrigger aria-label="Space within">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wall">Whole wall</SelectItem>
                      <SelectItem value="open">Open space</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <div className="arrange-readout">
                  <span className="arrange-readout-label">Equal distance</span>
                  <span className="arrange-readout-value-row">
                    <span className="arrange-readout-value">
                      {formatValue(arrange.equalSpacingMm)}
                    </span>
                  </span>
                </div>
                <p className="field-hint">
                  {arrange.evenZone === "open"
                    ? "Same from the open space's edges and between works."
                    : "Same from wall edges and between works."}
                </p>
              </div>
            ) : arrange.mode === "inset" ? (
              <div className="arrange-mode-body">
                {/* Underline tabs, not a segmented row: the anchor is a
                    refinement of "From edges", not a peer decision — a plain
                    side choice now that the target on either side is
                    auto-detected (wall or nearest neighbour), never picked
                    manually. No re-click deselect guard needed: unlike the
                    mode toggle, re-choosing the active anchor is a no-op
                    (onSetAnchor never moves anything on its own). */}
                <div className="arrange-anchor-row">
                  <span className="arrange-anchor-label">Measured from</span>
                  <ToggleGroup
                    aria-label="Measured from"
                    className="arrange-anchor-tabs"
                    orientation="horizontal"
                    type="single"
                    value={arrange.insetAnchor}
                    onValueChange={(value) => {
                      if (value === "left" || value === "both" || value === "right") {
                        onSetAnchor(value);
                      }
                    }}
                  >
                    <ToggleGroupItem
                      className="arrange-anchor-tab"
                      value="left"
                      variant="tab"
                      size="sm"
                    >
                      Left
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      className="arrange-anchor-tab"
                      value="both"
                      variant="tab"
                      size="sm"
                    >
                      Both
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      className="arrange-anchor-tab"
                      value="right"
                      variant="tab"
                      size="sm"
                    >
                      Right
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                {arrange.insetAnchor === "both" ? (
                  <>
                    <LengthField
                      compact
                      label="Distance from each edge"
                      labelBadge={
                        arrange.leftBoundary.type === "object" ||
                        arrange.rightBoundary.type === "object"
                          ? <NeighborTag decorative />
                          : null
                      }
                      valueMm={arrange.leftEdgeDistanceMm}
                      displayUnit={displayUnit}
                      parseUnit={parseUnit}
                      placeholder={placeholder}
                      stepMm={stepMm}
                      onCommit={(insetMm) => onArrangeValue({ insetMm, anchor: "both" })}
                      onEnterWhenClean={onAcceptArrange}
                    />
                    <ArrangeCalculatedReadout
                      label="Distance between works"
                      value={arrange.gapIsMixed ? "Mixed" : formatValue(arrange.gapMm)}
                      isMixed={arrange.gapIsMixed}
                    />
                    <p className="field-hint">
                      {bothEdgeCaption(arrange.leftBoundary, arrange.rightBoundary)}
                    </p>
                  </>
                ) : arrange.insetAnchor === "left" ? (
                  <>
                    <LengthField
                      compact
                      label={edgeFieldLabel("left", arrange.leftBoundary)}
                      labelBadge={
                        arrange.leftBoundary.type === "object" ? <NeighborTag decorative /> : null
                      }
                      valueMm={arrange.leftEdgeDistanceMm}
                      displayUnit={displayUnit}
                      parseUnit={parseUnit}
                      placeholder={placeholder}
                      stepMm={stepMm}
                      onCommit={(insetMm) => onArrangeValue({ insetMm, anchor: "left" })}
                      onEnterWhenClean={onAcceptArrange}
                    />
                    <ArrangeCalculatedReadout
                      label={edgeFieldLabel("right", arrange.rightBoundary)}
                      value={formatValue(arrange.rightEdgeDistanceMm)}
                      isMixed={false}
                      isNeighbor={arrange.rightBoundary.type === "object"}
                    />
                    <p className="field-hint">{edgeCaption("left", arrange.leftBoundary)}</p>
                  </>
                ) : (
                  <>
                    <LengthField
                      compact
                      label={edgeFieldLabel("right", arrange.rightBoundary)}
                      labelBadge={
                        arrange.rightBoundary.type === "object" ? <NeighborTag decorative /> : null
                      }
                      valueMm={arrange.rightEdgeDistanceMm}
                      displayUnit={displayUnit}
                      parseUnit={parseUnit}
                      placeholder={placeholder}
                      stepMm={stepMm}
                      onCommit={(insetMm) => onArrangeValue({ insetMm, anchor: "right" })}
                      onEnterWhenClean={onAcceptArrange}
                    />
                    <ArrangeCalculatedReadout
                      label={edgeFieldLabel("left", arrange.leftBoundary)}
                      value={formatValue(arrange.leftEdgeDistanceMm)}
                      isMixed={false}
                      isNeighbor={arrange.leftBoundary.type === "object"}
                    />
                    <p className="field-hint">{edgeCaption("right", arrange.rightBoundary)}</p>
                  </>
                )}
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
                <p className="field-hint">
                  The group stays where it is — the wall-edge distances follow.
                </p>
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
            className="inspector-action inspector-danger"
            variant="destructive-ghost"
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

// The calculated companion readout: a small muted label on line 1, then the
// value (semibold, larger) on line 2 with its tag(s) inline right after it —
// "Calculated" (a "Mixed" value shows none, since a mixed layout isn't a
// single calculated value) and, when the value is measured against a
// neighbour rather than a wall, "Neighbor" alongside it.
function ArrangeCalculatedReadout({
  label,
  value,
  isMixed,
  isNeighbor = false
}: {
  label: string;
  value: string;
  isMixed: boolean;
  isNeighbor?: boolean;
}) {
  return (
    <div className="arrange-readout">
      <span className="arrange-readout-label">{label}</span>
      <span className="arrange-readout-value-row">
        <span className="arrange-readout-value">{value}</span>
        {isMixed ? null : <span className="arrange-tag">Calculated</span>}
        {isNeighbor ? <NeighborTag /> : null}
      </span>
    </div>
  );
}
