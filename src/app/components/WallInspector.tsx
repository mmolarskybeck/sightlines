import { DoorIcon } from "@phosphor-icons/react/dist/csr/Door";
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link";
import { RectangleDashedIcon } from "@phosphor-icons/react/dist/csr/RectangleDashed";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";
import type { OpeningKind } from "../../domain/placement/createOpening";
import type { DisplayUnit } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import {
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "../../domain/units/unitSystem";
import { getScopedUnitContext } from "./scopedUnits";
import { InspectorSection } from "./InspectorSection";
import { InspectorSummaryRow } from "./InspectorSummaryRow";
import { InspectorNotice } from "./InspectorNotice";
import { InspectorActionGroup } from "./InspectorActionGroup";
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
  const wall = getScopedUnitContext(unit, "wall");
  const system = wall.system;
  const otherSystem = system === "imperial" ? "metric" : "imperial";
  const wallScope = { displayUnit: wall.displayUnit, parseUnit: wall.parseUnit };
  const wallPlaceholder = wall.placeholder;
  // Centerline reads best in the natural size unit for each system, with the
  // opposite system's unit as a secondary gloss: imperial shows ft (cm),
  // metric shows cm (ft-in).
  const centerlinePrimary = getScopedUnitContext(unit, "openingSize").displayUnit;
  const centerlineSecondary = getScopeUnits(otherSystem, "openingSize").displayUnit;

  return (
    <form
      className="inspector-form"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="inspector-sections wall-size-sections">
        {/* Length and room height are the two anchors of a wall's geometry —
            one static (non-collapsible) section, not two separately-headed
            blocks, so they read as a single "Size" thought with one gap
            between them. */}
        <InspectorSection collapsible={false} title="Size">
          <LengthField
            positiveOnly
            label="Length"
            valueMm={wallLengthMm}
            displayUnit={wallScope.displayUnit}
            parseUnit={wallScope.parseUnit}
            placeholder={wallPlaceholder}
            onCommit={onCommitLength}
            commitErrorFallback="Could not resize this wall."
          />
          <LengthField
            positiveOnly
            label="Height"
            valueMm={wallHeightMm}
            displayUnit={wallScope.displayUnit}
            parseUnit={wallScope.parseUnit}
            placeholder={wallPlaceholder}
            onCommit={onCommitHeight}
            commitErrorFallback="Could not resize this room's walls."
            // Guidance while typing, not a permanent label — shows only while
            // focused, and stands in for both fields' accepted-format hint
            // plus the room-wide scope note (an error, when present, still
            // takes precedence over it).
            focusHint={`Applies to every wall in ${roomName}.`}
          />
        </InspectorSection>
      </div>

      {dimensionLink ? (
        <InspectorNotice
          icon={<LinkIcon aria-hidden="true" size={15} />}
          tone="info"
        >
          Linked with {dimensionLink.pairedWallName}, {dimensionLink.roomName}{" "}
          keeps opposing wall lengths linked.
        </InspectorNotice>
      ) : null}
      {lastGeometryEdit ? (
        <p className="field-hint">
          Last edit updated{" "}
          {changedWallNames.length > 0 ? changedWallNames.join(", ") : "no walls"}.
        </p>
      ) : null}

      <InspectorActionGroup className="wall-opening-actions" label="Add to this wall">
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
            Marks a region where artwork can&rsquo;t be hung: a vent,
            outlet, thermostat, or other obstruction.
          </TooltipContent>
        </Tooltip>
      </InspectorActionGroup>

      <InspectorSummaryRow
        label="Centerline"
        value={formatLength(centerlineMm, {
          unit: centerlinePrimary,
          secondaryUnit: centerlineSecondary
        })}
      />
    </form>
  );
}
