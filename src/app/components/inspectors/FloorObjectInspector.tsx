import { useEffect, useState } from "react";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { getOpeningKindLabel } from "../../../domain/placement/createOpening";
import type { BlockedZoneFloorObject, DisplayUnit, FloorObject } from "../../../domain/project";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import { Input } from "../ui/input";

// The floor-space position (X/Y), editable footprint (Width/Depth), and
// optional Angle/Height-off-floor fields shared by FloorObjectInspector (a
// floor blocked zone), CaseInspector's FloorCaseInspector, and ArtworkInspector's
// floor-placed branch. Same numeric commit-on-blur/Enter discipline as
// OpeningInspector — the tactile (plan drag) and numeric paths must always
// agree. Floor objects carry no wall bounds, so nothing here validates
// against a wall (see the store's updateFloorObject / placeArtworkOnFloor).
export function FloorPlacementFields({
  floorObject,
  onCommitPosition,
  onCommitSize,
  onCommitHeight,
  onCommitRotation,
  onCommitBaseHeight,
  unit
}: {
  floorObject: Pick<
    FloorObject,
    "xMm" | "yMm" | "widthMm" | "depthMm" | "heightMm" | "rotationDeg" | "baseHeightMm"
  >;
  onCommitPosition: (xMm: number, yMm: number) => void;
  onCommitSize: (widthMm: number, depthMm: number) => void;
  // Angle (rotationDeg) applies to every floor-object kind — FloorObjectBox
  // already rotates a blocked zone's flat wash and a case's box exactly like
  // it rotates artwork; only the numeric control to REACH an arbitrary angle
  // was missing (rotationDeg's one existing writer is wall→floor conversion
  // inheriting the source wall's angle, so every fresh placement sits at 0).
  // Optional purely so a caller that hasn't wired a commit handler yet keeps
  // compiling — omit the prop to hide the field, don't pass a no-op.
  onCommitRotation?: (rotationDeg: number) => void;
  // Height off the floor (baseHeightMm) is a BOTTOM-EDGE height for an object
  // hovering in open air on wires — see the TRAP comment on FloorObjectBase
  // in domain/project.ts (this is NOT wallYMm). Only artwork can plausibly
  // hover: a display case stands on its own legs (lifting the whole case
  // would float the legs) and a blocked zone is a flat floor-plane planning
  // wash, never a physical volume (see FloorObjectBox's blocked-zone
  // branch) — "how far off the floor" has no referent for either. This prop
  // is therefore never threaded through FloorObjectInspector or
  // FloorCaseInspector below; only the artwork floor branch passes it.
  onCommitBaseHeight?: (baseHeightMm: number) => void;
  // The object's VERTICAL extent (heightMm) — how tall the thing standing (or
  // hanging) on the floor actually is. Distinct from both neighbours above:
  // baseHeightMm is where its bottom edge sits, this is how far up it goes.
  //
  // Editable at all only because suspension made it matter: heightMm is set
  // ONCE, at placement, from the artwork's effective dimensions
  // (placeArtworkOnFloor), and editing the artwork's dimensions afterward
  // deliberately does NOT rebake the placement. Width and Depth always had
  // numeric repair paths; height did not, so a floor object placed before its
  // dimensions were known was stuck at its placeholder height forever. That was
  // survivable for a sculpture footprint and is not for a hanging board, whose
  // height is the dimension a curator most needs to get right — it drives both
  // the 3D box and the elevation ghost's floating span.
  //
  // FloorCaseInspector does NOT pass this: a case's heightMm is "overall, floor
  // to box top" and already has its own dedicated Height field there.
  onCommitHeight?: (heightMm: number) => void;
  unit: DisplayUnit;
}) {
  const position = getScopedUnitContext(unit, "openingPosition");
  const size = getScopedUnitContext(unit, "openingSize");

  return (
    <>
      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          label="X (floor)"
          valueMm={floorObject.xMm}
          displayUnit={position.displayUnit}
          parseUnit={position.parseUnit}
          placeholder={position.placeholder}
          onCommit={(xMm) => onCommitPosition(xMm, floorObject.yMm)}
        />
        <LengthField
          compact
          label="Y (floor)"
          valueMm={floorObject.yMm}
          displayUnit={position.displayUnit}
          parseUnit={position.parseUnit}
          placeholder={position.placeholder}
          onCommit={(yMm) => onCommitPosition(floorObject.xMm, yMm)}
        />
      </InspectorFieldGrid>

      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Width"
          valueMm={floorObject.widthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(widthMm) => onCommitSize(widthMm, floorObject.depthMm)}
        />
        <LengthField
          compact
          positiveOnly
          label="Depth"
          valueMm={floorObject.depthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(depthMm) => onCommitSize(floorObject.widthMm, depthMm)}
        />
      </InspectorFieldGrid>

      {onCommitHeight ? (
        <InspectorFieldGrid columns={2}>
          <LengthField
            compact
            positiveOnly
            label="Height"
            valueMm={floorObject.heightMm}
            displayUnit={size.displayUnit}
            parseUnit={size.parseUnit}
            placeholder={size.placeholder}
            onCommit={onCommitHeight}
          />
        </InspectorFieldGrid>
      ) : null}

      {onCommitBaseHeight || onCommitRotation ? (
        <InspectorFieldGrid columns={2}>
          {onCommitBaseHeight ? (
            <LengthField
              compact
              // Not positiveOnly: 0 is the documented "resting on the floor"
              // value (see baseHeightMm's doc comment), so a curator must be
              // able to type 0 back in to un-suspend the work. LengthField
              // only offers unrestricted-or-positive-only, and a genuinely
              // negative entry (bottom edge below the floor) has no real
              // meaning — same "nothing here validates" stance the rest of
              // this component already takes for x/y/width/depth in v1.
              label="Height off floor"
              valueMm={floorObject.baseHeightMm ?? 0}
              displayUnit={position.displayUnit}
              parseUnit={position.parseUnit}
              placeholder={position.placeholder}
              onCommit={onCommitBaseHeight}
            />
          ) : null}
          {onCommitRotation ? (
            <RotationField valueDeg={floorObject.rotationDeg} onCommit={onCommitRotation} />
          ) : null}
        </InspectorFieldGrid>
      ) : null}
    </>
  );
}

// Degrees are unit-agnostic, so LengthField (which parses length units) is
// the wrong control — same reasoning as FreestandingWallInspector's local
// AngleField (a different inspector file, out of this pass's scope; this is
// a deliberate small duplication rather than reaching into it).
//
// Range/wrap decision: rotationDeg feeds straight into MathUtils.degToRad
// with no normalization anywhere in the geometry pipeline (see
// FloorObjectBox's planRotationToYaw) — 400° and -320° already render
// identically to 40°. This field mirrors that: no wrap-to-0–360, negatives
// are accepted (rotate the other way without doing 360-minus-x by hand), and
// nothing clamps the range. A curator who spins an object all the way around
// a few times just accumulates a large stored number that still renders
// correctly.
const ANGLE_CLEAN_EPSILON_DEG = 0.05; // half the 0.1° display rounding step

function formatAngleDeg(valueDeg: number): string {
  return String(Math.round(valueDeg * 10) / 10);
}

function RotationField({
  valueDeg,
  onCommit
}: {
  valueDeg: number;
  onCommit: (rotationDeg: number) => void;
}) {
  const formatted = formatAngleDeg(valueDeg);
  const [input, setInput] = useState(formatted);

  // Resync whenever the committed value changes out from under us (a store
  // update, an undo, a sibling edit) — same rule as LengthField.
  useEffect(() => {
    setInput(formatted);
  }, [formatted]);

  // "Clean" = no pending edit: either the text matches what the committed
  // value would format as, or it parses back to (within rounding of) that
  // same value. Mirrors LengthField's isInputClean.
  const isClean = () => {
    const trimmed = input.trim();
    if (trimmed === formatted) return true;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && Math.abs(parsed - valueDeg) < ANGLE_CLEAN_EPSILON_DEG;
  };

  const commit = () => {
    // Blurring a field nobody edited (or one that round-trips to the same
    // value) must not write — see LengthField's isInputClean comment for the
    // click-eating bug a spurious re-commit caused there.
    if (isClean()) return;

    const trimmed = input.trim();
    const parsed = Number(trimmed);
    if (trimmed.length === 0 || !Number.isFinite(parsed)) {
      setInput(formatted);
      return;
    }

    onCommit(parsed);
    // Reformat immediately rather than waiting for the next `valueDeg` prop
    // round-trip (which may lag behind an async store commit) — same rule
    // LengthField's commit() follows.
    setInput(formatAngleDeg(parsed));
  };

  return (
    <Field compact label="Angle (°)">
      <Input
        aria-label="Angle in degrees"
        inputMode="decimal"
        value={input}
        onBlur={commit}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            // Abandon a pending edit rather than letting Escape bubble to a
            // global deselect-on-Escape handler — same rule as LengthField.
            if (isClean()) return;
            event.stopPropagation();
            setInput(formatted);
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          // Commit directly rather than delegating to blur(): LengthField
          // does the same (see its Enter branch) — blur() is a no-op in some
          // environments unless the element is truly the active element.
          commit();
        }}
      />
    </Field>
  );
}

// Numeric editor for a selected floor-placed blocked zone, mirroring
// OpeningInspector's structure (kind label, position/size fields, delete).
// Floor-placed artworks reuse FloorPlacementFields beneath ArtworkInspector
// instead — their identity/dimension editing already lives there.
export function FloorObjectInspector({
  floorObject,
  onCommitPosition,
  onCommitSize,
  onCommitRotation,
  onDelete,
  unit
}: {
  floorObject: BlockedZoneFloorObject;
  onCommitPosition: (xMm: number, yMm: number) => void;
  onCommitSize: (widthMm: number, depthMm: number) => void;
  // A blocked zone is a floor-plane keep-out annotation, not a physical
  // volume — it can absolutely sit at an angle to the room's walls (an
  // angled utility chase, a diagonal column footprint), so Angle is wired
  // here. There is deliberately no onCommitBaseHeight prop: "how far off the
  // floor" has no meaning for a flat area annotation (see the reasoning on
  // FloorPlacementFields' onCommitBaseHeight above).
  onCommitRotation?: (rotationDeg: number) => void;
  onDelete: () => void;
  unit: DisplayUnit;
}) {
  const kindLabel = getOpeningKindLabel(floorObject.kind);

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {/* No "Kind" row: the panel's subject header directly above already
          names it (e.g. "Blocked zone / Floor object"). */}
      <FloorPlacementFields
        floorObject={floorObject}
        onCommitPosition={onCommitPosition}
        onCommitSize={onCommitSize}
        onCommitRotation={onCommitRotation}
        unit={unit}
      />

      <div className="inspector-placement">
        <Button className="inspector-action inspector-danger" variant="destructive-ghost" onClick={onDelete}>
          <TrashIcon aria-hidden="true" size={15} />
          Delete {kindLabel.toLowerCase()}
        </Button>
      </div>
    </form>
  );
}
