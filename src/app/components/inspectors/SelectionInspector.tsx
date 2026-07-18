import { useEffect, useState } from "react";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsHorizontal";
import { ArrowsInLineHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsInLineHorizontal";
import { ArrowsOutLineHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutLineHorizontal";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { ArtworkFrame, DisplayUnit, WallObject } from "../../../domain/project";
import { FRAME_FINISHES } from "../../../domain/framing";
import { formatLength } from "../../../domain/units/length";
import type { ArrangeBoundary } from "../../hooks/arrangeReadout";
import { LengthField } from "../shared/LengthField";
import { InspectorSection } from "./InspectorSection";
import { InspectorNotice } from "./InspectorNotice";
import { InspectorActionGroup } from "./InspectorActionGroup";
import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
  UnderlineToggleGroup,
  UnderlineToggleGroupItem
} from "../ui/segmented";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { getScopedUnitContext } from "../shared/scopedUnits";

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
  selectionKey,
  unit,
  wallName,
  onSetMode,
  onSetAnchor,
  onSetEvenZone,
  onArrangeValue,
  onAcceptArrange,
  onCancelArrange,
  matFrame,
  onRemoveAll
}: {
  count: number;
  // Order-insensitive identity of the selected ids. Draft state (mat/frame
  // values, the remove confirmation) must reset when the selection changes to
  // a *different* set of the same size, so count alone is not enough.
  selectionKey: string;
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
  // Bulk mat & frame for the selected works, rendered as an inline collapsible
  // section (same grammar as the single-artwork inspector's Mat & frame).
  // Undefined when no selected object resolves to an artwork placement
  // (openings/blocked zones have no framing), which is what hides the section.
  matFrame?: {
    // Works the apply will actually change; skipped are frame-inclusive ones
    // the store refuses (their stored size already contains the frame).
    targetCount: number;
    skippedCount: number;
    onApply: (changes: { matWidthMm?: number; frame?: ArtworkFrame }) => void;
  };
  onRemoveAll: () => void;
}) {
  const { displayUnit, parseUnit, placeholder, stepMm } = getScopedUnitContext(unit, "openingPosition");

  const formatValue = (valueMm: number) => formatLength(valueMm, { unit: displayUnit });

  // Reset confirmation when the selection changes so it cannot remove a new selection.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  useEffect(() => {
    setConfirmingRemove(false);
  }, [selectionKey]);

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
                      value={
                        arrange.gapIsMixed
                          ? "Mixed"
                          : // A negative average gap means the selection's members overlap
                            // along x (e.g. a stacked/salon column) — print the overlap
                            // magnitude instead of a negative distance, matching the canvas
                            // dimension lines, which drop overlap segments entirely.
                            arrange.gapMm < -0.5
                            ? `Overlapping ${formatValue(-arrange.gapMm)}`
                            : formatValue(arrange.gapMm)
                      }
                      isMixed={arrange.gapIsMixed}
                      hideTag={!arrange.gapIsMixed && arrange.gapMm < -0.5}
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

      {/* Bulk mat & frame lives inline, mirroring the single-artwork
          inspector's section of the same name — closed at rest so the arrange
          controls stay the panel's lead. Only rendered when the selection
          holds at least one artwork placement. */}
      {matFrame ? (
        <MatFrameSection selectionKey={selectionKey} matFrame={matFrame} unit={unit} />
      ) : null}

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

// Sensible default frame face width (~1 in) when a curator picks a finish
// before typing a width — same rule as the single inspector's FramingSection:
// the frame is only ever created with a real width.
const DEFAULT_FRAME_WIDTH_MM = 25.4;

// Bulk mat & frame as an inline disclosure — the multi-selection counterpart
// of ArtworkInspector's Mat & frame section, sharing its field vocabulary
// (Mat/Frame pair, Finish row). Unlike the single inspector it edits a local
// DRAFT, not live values (the picked works may differ), and commits through
// one explicit Apply so a half-typed band never touches N works. Open ≈ the
// arrange session: the Apply/Cancel pair uses the same split action-group
// treatment. Applying always sets BOTH bands — an empty band means "none" —
// so one apply can set or strip framing across the whole selection.
function MatFrameSection({
  selectionKey,
  matFrame,
  unit
}: {
  selectionKey: string;
  matFrame: {
    targetCount: number;
    skippedCount: number;
    onApply: (changes: { matWidthMm?: number; frame?: ArtworkFrame }) => void;
  };
  unit: DisplayUnit;
}) {
  const { displayUnit, parseUnit, system } = getScopedUnitContext(unit, "artwork");

  const [open, setOpen] = useState(false);
  const [matWidthMm, setMatWidthMm] = useState<number | undefined>(undefined);
  const [frame, setFrame] = useState<ArtworkFrame | undefined>(undefined);

  // A new selection is a new draft: stale band values from the previous pick
  // must never ride into an apply against different works — including a
  // different set of the same size, hence identity-keyed, not count-keyed.
  useEffect(() => {
    setOpen(false);
    setMatWidthMm(undefined);
    setFrame(undefined);
  }, [selectionKey]);

  const resetDraft = () => {
    setMatWidthMm(undefined);
    setFrame(undefined);
  };

  // Band-width examples, not conversions — same concrete examples as the
  // single inspector (the fields take the width of the BAND).
  const matPlaceholder = system === "imperial" ? 'e.g. 3"' : "e.g. 75 mm";
  const framePlaceholder = system === "imperial" ? 'e.g. 1"' : "e.g. 25 mm";

  return (
    <InspectorSection open={open} title="Mat & frame" onOpenChange={setOpen}>
      <div className="field-pair-grid">
        <LengthField
          compact
          clearable
          positiveOnly
          label="Mat"
          valueMm={matWidthMm}
          displayUnit={displayUnit}
          parseUnit={parseUnit}
          placeholder={matPlaceholder}
          onClear={() => setMatWidthMm(undefined)}
          onCommit={(valueMm) => setMatWidthMm(valueMm)}
        />
        <LengthField
          compact
          clearable
          positiveOnly
          label="Frame"
          valueMm={frame?.widthMm}
          displayUnit={displayUnit}
          parseUnit={parseUnit}
          placeholder={framePlaceholder}
          // Clearing the frame width removes the frame entirely; setting it
          // keeps (or defaults) the finish — same rule as the inspector.
          onClear={() => setFrame(undefined)}
          onCommit={(valueMm) =>
            setFrame((current) => ({ widthMm: valueMm, finish: current?.finish ?? "black" }))
          }
        />
        {/* Finish spans the grid as its own full row below the Mat | Frame
            pair — same stacked-label treatment, edges flush with the pair. */}
        <Field compact className="matframe-finish" label="Finish">
          <Select
            value={frame?.finish ?? "black"}
            onValueChange={(value) =>
              setFrame((current) => ({
                widthMm: current?.widthMm ?? DEFAULT_FRAME_WIDTH_MM,
                finish: value as ArtworkFrame["finish"]
              }))
            }
          >
            <SelectTrigger aria-label="Frame finish">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FRAME_FINISHES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <p className="field-hint">
        Leave a band empty to remove it. Changes apply everywhere these works are used.
      </p>

      {matFrame.skippedCount > 0 ? (
        <p className="field-hint">
          {matFrame.skippedCount === 1
            ? "1 selected work includes the frame in its size and will be skipped."
            : `${matFrame.skippedCount} selected works include the frame in their size and will be skipped.`}
        </p>
      ) : null}

      {/* Content-width chips, not the arrange pair's equal split: the apply
          label carries the live work count ("Apply to 12 works"), so it must
          be free to grow — and when an arrange session is active both pairs
          are on screen, so the count is also what disambiguates the two
          Applies. */}
      <InspectorActionGroup>
        <Button
          className="inspector-action arrange-apply"
          disabled={matFrame.targetCount === 0}
          variant="primary"
          onClick={() => matFrame.onApply({ matWidthMm, frame })}
        >
          <CheckIcon aria-hidden="true" size={15} />
          Apply to {matFrame.targetCount} work{matFrame.targetCount === 1 ? "" : "s"}
        </Button>
        <Button
          className="inspector-action arrange-cancel"
          variant="inspector"
          onClick={() => {
            resetDraft();
            setOpen(false);
          }}
        >
          <XIcon aria-hidden="true" size={15} />
          Cancel
        </Button>
      </InspectorActionGroup>
    </InspectorSection>
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
  isNeighbor = false,
  hideTag = false
}: {
  label: string;
  value: string;
  isMixed: boolean;
  isNeighbor?: boolean;
  // Suppresses the "Calculated" tag for states where the value isn't a
  // single calculated distance, e.g. the "Overlapping <length>" readout.
  hideTag?: boolean;
}) {
  return (
    <div className="arrange-readout">
      <span className="arrange-readout-label">{label}</span>
      <span className="arrange-readout-value-row">
        <span className="arrange-readout-value">{value}</span>
        {isMixed || hideTag ? null : <span className="arrange-tag">Calculated</span>}
        {isNeighbor ? <NeighborTag /> : null}
      </span>
    </div>
  );
}
