import { DoorIcon } from "@phosphor-icons/react/dist/csr/Door";
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link";
import { RectangleDashedIcon } from "@phosphor-icons/react/dist/csr/RectangleDashed";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";
import type { OpeningKind } from "../../domain/placement/createOpening";
import type { DisplayUnit } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import {
  getPlaceholderForScope,
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "../../domain/units/unitSystem";
import { LengthField } from "./LengthField";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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
  onCommitHeight,
  onCommitLength,
  roomName,
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
  onCommitHeight: (heightMm: number) => Promise<void>;
  onCommitLength: (lengthMm: number) => Promise<void>;
  roomName: string;
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
      <div className="artwork-dimensions">
        <div className="artwork-dimensions-heading">
          <h3>Room height</h3>
        </div>
        <LengthField
          positiveOnly
          label="Height"
          valueMm={wallHeightMm}
          displayUnit={wallScope.displayUnit}
          parseUnit={wallScope.parseUnit}
          placeholder={wallPlaceholder}
          onCommit={onCommitHeight}
          commitErrorFallback="Could not resize this room's walls."
          focusHint={"Accepts 12', 12 ft, 144\", 365.8 cm, or 3.66 m."}
        />
        <p className="field-hint">
          Applies to every wall in {roomName}.
        </p>
      </div>
      {dimensionLink ? (
        <div className="constraint-panel" aria-label="Linked rectangle dimension">
          <LinkIcon aria-hidden="true" size={17} />
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="opening-add-chip"
                variant="inspector"
                onClick={() => onAddOpening("door")}
              >
                <DoorIcon aria-hidden="true" size={16} />
                <span>Door</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="opening-add-tooltip" side="bottom">
              A standard doorway reaching the floor. Artwork can&rsquo;t hang
              over it.
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="opening-add-chip"
                variant="inspector"
                onClick={() => onAddOpening("window")}
              >
                <SquareIcon aria-hidden="true" size={16} />
                <span>Window</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="opening-add-tooltip" side="bottom">
              A window centered on the wall&rsquo;s midline. Artwork can&rsquo;t
              hang over it.
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="opening-add-chip"
                variant="inspector"
                onClick={() => onAddOpening("blocked-zone")}
              >
                <RectangleDashedIcon aria-hidden="true" size={16} />
                <span>Blocked zone</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="opening-add-tooltip" side="bottom">
              Marks a region where artwork can&rsquo;t be hung — a vent,
              outlet, thermostat, or other obstruction.
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <dl className="property-list compact">
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
