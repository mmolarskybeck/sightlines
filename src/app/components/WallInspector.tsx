import { DoorOpen, Link2, Square, SquareDashed } from "lucide-react";
import type { OpeningKind } from "../../domain/placement/createOpening";
import type { DisplayUnit } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import {
  getPlaceholderForScope,
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "../../domain/units/unitSystem";
import { LengthField } from "./LengthField";

export type WallDimensionLink = {
  pairedWallName: string;
  roomName: string;
};

export function WallInspector({
  centerlineMm,
  changedWallNames,
  dimensionLink,
  lastGeometryEdit,
  onAddOpening,
  onCommitLength,
  unit,
  wallHeightMm,
  wallLengthMm,
  wallName
}: {
  centerlineMm: number;
  changedWallNames: string[];
  dimensionLink: WallDimensionLink | null;
  lastGeometryEdit: {
    anchorVertexId: string;
    changedWallIds: string[];
  } | null;
  onAddOpening: (kind: OpeningKind) => void;
  onCommitLength: (lengthMm: number) => Promise<void>;
  unit: DisplayUnit;
  wallHeightMm: number;
  wallLengthMm: number;
  wallName: string;
}) {
  const system = unitSystemFromDisplayUnit(unit);
  const otherSystem = system === "imperial" ? "metric" : "imperial";
  const wallScope = getScopeUnits(system, "wall");
  const wallPlaceholder = getPlaceholderForScope(system, "wall");
  // Centerline reads best in the natural size unit for each system, with the
  // opposite system's unit as a secondary gloss: imperial shows ft (cm),
  // metric shows cm (ft-in).
  const centerlinePrimary = getScopeUnits(system, "openingSize").displayUnit;
  const centerlineSecondary = getScopeUnits(otherSystem, "openingSize").displayUnit;

  return (
    <form
      className="inspector-form"
      onSubmit={(event) => event.preventDefault()}
    >
      <LengthField
        positiveOnly
        label="Length"
        valueMm={wallLengthMm}
        displayUnit={wallScope.displayUnit}
        parseUnit={wallScope.parseUnit}
        placeholder={wallPlaceholder}
        onCommit={onCommitLength}
        commitErrorFallback="Could not resize this wall."
        // Guidance while typing, not a permanent label — shows only while
        // focused. An error, when present, takes precedence.
        focusHint={"Accepts 28', 28 ft, 336\", 853.4 cm, or 8.53 m."}
      />
      {dimensionLink ? (
        <div className="constraint-panel" aria-label="Linked rectangle dimension">
          <Link2 aria-hidden="true" size={17} />
          <div>
            <h3>{wallName} + {dimensionLink.pairedWallName}</h3>
            <p>{dimensionLink.roomName} keeps opposing wall lengths linked.</p>
          </div>
        </div>
      ) : null}
      {lastGeometryEdit ? (
        <p className="field-hint">
          Last edit updated{" "}
          {changedWallNames.length > 0 ? changedWallNames.join(", ") : "no walls"}.
        </p>
      ) : null}

      <div className="opening-add-row">
        <span>Add to this wall</span>
        <div className="opening-add-buttons">
          <button className="inspector-action" type="button" onClick={() => onAddOpening("door")}>
            <DoorOpen aria-hidden="true" size={15} />
            Door
          </button>
          <button className="inspector-action" type="button" onClick={() => onAddOpening("window")}>
            <Square aria-hidden="true" size={15} />
            Window
          </button>
          <button
            className="inspector-action"
            type="button"
            onClick={() => onAddOpening("blocked-zone")}
          >
            <SquareDashed aria-hidden="true" size={15} />
            Blocked zone
          </button>
        </div>
      </div>

      <dl className="property-list compact">
        <div>
          <dt>Height</dt>
          <dd>{formatLength(wallHeightMm, { unit: wallScope.displayUnit })}</dd>
        </div>
        <div>
          <dt>Centerline</dt>
          <dd>
            {formatLength(centerlineMm, {
              unit: centerlinePrimary,
              secondaryUnit: centerlineSecondary
            })}
          </dd>
        </div>
      </dl>
    </form>
  );
}
