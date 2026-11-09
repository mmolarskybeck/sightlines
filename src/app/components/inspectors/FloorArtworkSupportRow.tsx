import type { DisplayUnit, FloorSupportKind } from "../../../domain/project";
import type { FloorStandsOn } from "../../../domain/placement/floorRiders";
import { formatLength } from "../../../domain/units/length";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";
import { InspectorActionGroup } from "./InspectorActionGroup";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { InspectorSummaryRow } from "./InspectorSummaryRow";
import { Button } from "../ui/button";

// What a floor-placed work is standing on, as a READING with verbs — the floor
// twin of the wall inspector's "Support" row, and deliberately the same label
// and grammar (docs/decisions.md, 2026-09-18).
//
// NEVER A SELECT. The old StandsOnField offered Floor / Pedestal / Plinth /
// Suspended as four exclusive options, which was honest when a pedestal was a
// block stored ON the work. It is not honest now: a pedestal is its own object
// and a work stands on it because its footprint is over the top face at the
// right height (resolveFloorStandsOn). There is no field to write, so there is
// nothing for a select to bind to — the value is re-derived on every render,
// and each action MOVES GEOMETRY until the reading changes.
//
// "Rider" and "seat" are the internal words for this relationship and never
// appear here (floor-supports spec §7).
//
// ACTION SHAPE (the UI round's call): one compact InspectorActionGroup of
// tertiary chips under the row, all verbs visible, none behind a menu. At the
// inspector's 300px the three floor-state verbs wrap onto two lines, which is
// the cheaper cost: a "More" menu would hide "Put on plinth" from the only
// curator who needs to discover that plinths exist, and this panel is a working
// instrument, not a place to economise on a second line. A segmented pill is
// rejected outright — these are one-shot verbs, not a mode this work is in.
export function FloorArtworkSupportRow({
  isMonitor = false,
  // Keys the suspension-height field so a pending draft dies with the
  // selection rather than committing onto the next work.
  placementId,
  standsOn,
  unit,
  onCenterOnSupport,
  onCommitSuspensionHeight,
  onPutOnSupport,
  onSelectSupport,
  onSetOnFloor,
  onSuspend
}: {
  isMonitor?: boolean;
  placementId: string;
  // Derived on every render by resolveFloorStandsOn; never stored on either
  // side of the relationship.
  standsOn: FloorStandsOn;
  unit: DisplayUnit;
  onCenterOnSupport: () => void;
  onCommitSuspensionHeight: (baseHeightMm: number) => void;
  onPutOnSupport: (kind: FloorSupportKind) => void;
  onSelectSupport: () => void;
  onSetOnFloor: () => void;
  onSuspend: () => void;
}) {
  const size = getScopedUnitContext(unit, "openingSize");
  const position = getScopedUnitContext(unit, "openingPosition");
  const format = (mm: number) => formatLength(mm, { unit: size.displayUnit });

  const chip = (label: string, onClick: () => void) => (
    <Button
      key={label}
      className="inspector-action"
      size="sm"
      variant="ghost"
      onClick={onClick}
    >
      {label}
    </Button>
  );

  if (standsOn.kind === "support") {
    // The kind noun carries through every verb in the row: a panel that said
    // "Select plinth" beside "Center on pedestal" would read as two objects.
    const noun = supportNoun(standsOn.support.supportKind);
    const { widthMm, depthMm, heightMm } = standsOn.support;

    return (
      <>
        {/* The support's own size is a qualifier, not the answer: at 300px a
            three-axis imperial reading ran past the panel edge and shoved the
            actions off the row. The value states WHAT it stands on and the
            hint line under it states how big that is. */}
        <InspectorSummaryRow
          label="Support"
          value={`On ${noun}`}
          hint={`${format(widthMm)} × ${format(depthMm)} × ${format(heightMm)}`}
        />
        <InspectorActionGroup>
          {chip(`Select ${noun}`, onSelectSupport)}
          {chip(`Center on ${noun}`, onCenterOnSupport)}
          {chip("Set on floor", onSetOnFloor)}
        </InspectorActionGroup>
      </>
    );
  }

  if (standsOn.kind === "suspended") {
    return (
      <>
        <InspectorSummaryRow label="Support" value="Suspended" />
        {/* The one state that owns a number, so the field sits between the
            reading and the verbs that leave it. Not positiveOnly: typing 0
            here is itself "set it down" (see FloorPlacementFields). */}
        <InspectorFieldGrid key={placementId} columns={2}>
          <LengthField
            compact
            label="Height off floor"
            valueMm={standsOn.heightMm}
            displayUnit={position.displayUnit}
            parseUnit={position.parseUnit}
            placeholder={position.placeholder}
            onCommit={onCommitSuspensionHeight}
          />
        </InspectorFieldGrid>
        <InspectorActionGroup>
          {chip("Set on floor", onSetOnFloor)}
          {chip("Put on pedestal", () => onPutOnSupport("pedestal"))}
        </InspectorActionGroup>
      </>
    );
  }

  return (
    <>
      <InspectorSummaryRow label="Support" value="On the floor" />
      <InspectorActionGroup>
        {chip("Put on pedestal", () => onPutOnSupport("pedestal"))}
        {chip("Put on plinth", () => onPutOnSupport("plinth"))}
        {/* A box monitor never hangs on wires — the rule the elevation ghost,
            CrtMonitorMesh and resolveFloorStandsOn already apply, so offering
            the verb would be offering a no-op. */}
        {isMonitor ? null : chip("Suspend", onSuspend)}
      </InspectorActionGroup>
    </>
  );
}

function supportNoun(kind: FloorSupportKind): string {
  return kind === "plinth" ? "plinth" : "pedestal";
}
