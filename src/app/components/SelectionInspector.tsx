import { useEffect, useState } from "react";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsHorizontal";
import { ArrowsInLineHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsInLineHorizontal";
import { ArrowsOutLineHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutLineHorizontal";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { DisplayUnit, WallObject } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import type { ArrangeBoundary } from "../hooks/arrangeReadout";
import { LengthField } from "./LengthField";
import { InspectorSection } from "./InspectorSection";
import { InspectorNotice } from "./InspectorNotice";
import { InspectorActionGroup } from "./InspectorActionGroup";
import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
  UnderlineToggleGroup,
  UnderlineToggleGroupItem
} from "./ui/segmented";
import { Button } from "./ui/button";
import { Field } from "./ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";
import { getScopedUnitContext } from "./scopedUnits";

type ArrangeMode = "equal" | "inset" | "gap";
type InsetAnchor = "left" | "both" | "right";
type EvenZone = "wall" | "open";

// "From edges" names whichever wall or neighboring object was auto-detected.
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

// Hide the tag inside a field label so it is not appended to the input's
// accessible name. Readout tags remain announced.
function NeighborTag({ decorative = false }: { decorative?: boolean } = {}) {
  return (
    <span aria-hidden={decorative || undefined} className="arrange-tag">
      Neighbor
    </span>
  );
}

// Props-driven multi-selection inspector; arrange/remove rules stay in the store.
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
  // null falls back to the generic "Arrange on wall" heading.
  wallName: string | null;
  // null when the selection is not 2+ arrangeable objects on one wall.
  arrange: {
    mode: ArrangeMode;
    // "both" is the centered default for From edges.
    insetAnchor: InsetAnchor;
    // "wall" is the default Space evenly span.
    evenZone: EvenZone;
    insetMm: number;
    gapMm: number;
    // Distances from the group to the detected boundary on each side.
    leftEdgeDistanceMm: number;
    rightEdgeDistanceMm: number;
    // Auto-detected wall or nearest unselected neighbor on each side.
    leftBoundary: ArrangeBoundary;
    rightBoundary: ArrangeBoundary;
    insetIsMixed: boolean;
    gapIsMixed: boolean;
    equalSpacingMm: number;
    sessionActive: boolean;
  } | null;
  arrangeDisabledReason?: string;
  // Explains that arranging ignores openings in an otherwise valid selection.
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
  const { displayUnit, parseUnit, placeholder, stepMm } = getScopedUnitContext(unit, "openingPosition");

  const formatValue = (valueMm: number) => formatLength(valueMm, { unit: displayUnit });

  // Reset confirmation when the selection changes so it cannot remove a new selection.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  useEffect(() => {
    setConfirmingRemove(false);
  }, [count]);

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <h3>
        {count} object{count === 1 ? "" : "s"} selected
      </h3>

      <InspectorSection collapsible={false} title={`Arrange on ${wallName ?? "wall"}`}>
        {arrange ? (
          <div className="arrange-controls">
            {arrangeIgnoredNote ? (
              <InspectorNotice tone="info">{arrangeIgnoredNote}</InspectorNotice>
            ) : null}
            <SegmentedToggleGroup
              aria-label="Spacing method"
              className="arrange-modes"
              orientation="horizontal"
              type="single"
              value={arrange.mode}
              onValueChange={(value) => {
                // Radix sends "" when the active item is re-clicked; reapply it instead.
                if (value === "equal" || value === "inset" || value === "gap") {
                  onSetMode(value);
                } else {
                  onSetMode(arrange.mode);
                }
              }}
            >
              <SegmentedToggleGroupItem className="arrange-mode" value="equal">
                <ArrowsOutLineHorizontalIcon aria-hidden="true" size={16} />
                <span>Space evenly</span>
              </SegmentedToggleGroupItem>
              <SegmentedToggleGroupItem className="arrange-mode" value="inset">
                <ArrowsInLineHorizontalIcon aria-hidden="true" size={16} />
                <span>From edges</span>
              </SegmentedToggleGroupItem>
              <SegmentedToggleGroupItem className="arrange-mode" value="gap">
                <ArrowsHorizontalIcon aria-hidden="true" size={16} />
                <span>Between works</span>
              </SegmentedToggleGroupItem>
            </SegmentedToggleGroup>

            {arrange.mode === "equal" ? (
              <div className="arrange-mode-body">
                {/* A collapsed select rather than a segmented row: the zone is
                    a refinement of "Space evenly", not a peer decision, so the
                    enabled panel shows one value instead of two live options.
                    Radix Select never fires the ""-deselect the old toggle
                    needed a re-click guard for. */}
                <Field compact label="Space within">
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
                </Field>
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
                  <UnderlineToggleGroup
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
                    <UnderlineToggleGroupItem className="arrange-anchor-tab" value="left">
                      Left
                    </UnderlineToggleGroupItem>
                    <UnderlineToggleGroupItem className="arrange-anchor-tab" value="both">
                      Both
                    </UnderlineToggleGroupItem>
                    <UnderlineToggleGroupItem className="arrange-anchor-tab" value="right">
                      Right
                    </UnderlineToggleGroupItem>
                  </UnderlineToggleGroup>
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
                  label={edgeFieldLabel("left", arrange.leftBoundary)}
                  value={formatValue(arrange.leftEdgeDistanceMm)}
                  isMixed={false}
                  isNeighbor={arrange.leftBoundary.type === "object"}
                />
                <ArrangeCalculatedReadout
                  label={edgeFieldLabel("right", arrange.rightBoundary)}
                  value={formatValue(arrange.rightEdgeDistanceMm)}
                  isMixed={false}
                  isNeighbor={arrange.rightBoundary.type === "object"}
                />
                <p className="field-hint">
                  The group stays where it is. The side distances follow.
                </p>
                <p className="field-hint">
                  {bothEdgeCaption(arrange.leftBoundary, arrange.rightBoundary)}
                </p>
              </div>
            )}

            {arrange.sessionActive ? (
              <InspectorActionGroup split>
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
              </InspectorActionGroup>
            ) : null}
          </div>
        ) : (
          <InspectorNotice tone="caution">{arrangeDisabledReason}</InspectorNotice>
        )}
      </InspectorSection>

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
          <InspectorActionGroup>
            <Button
              className="inspector-action inspector-danger"
              variant="destructive-ghost"
              onClick={() => setConfirmingRemove(true)}
            >
              <TrashIcon aria-hidden="true" size={15} />
              Remove all
            </Button>
          </InspectorActionGroup>
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
