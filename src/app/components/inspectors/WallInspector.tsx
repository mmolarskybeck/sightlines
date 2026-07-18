import { DoorIcon } from "@phosphor-icons/react/dist/csr/Door";
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link";
import { RectangleDashedIcon } from "@phosphor-icons/react/dist/csr/RectangleDashed";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";
import { TextAlignLeftIcon } from "@phosphor-icons/react/dist/csr/TextAlignLeft";
import { useEffect, useId, useRef, useState } from "react";
import type { ResizeAnchor } from "../../../domain/geometry/editRoom";
import type { InsertToolKind } from "../../../domain/placement/createOpening";
import type { DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import {
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "../../../domain/units/unitSystem";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { InspectorSection } from "./InspectorSection";
import { InspectorSummaryRow } from "./InspectorSummaryRow";
import { InspectorNotice } from "./InspectorNotice";
import { InspectorActionGroup } from "./InspectorActionGroup";
import { LengthField } from "../shared/LengthField";
import { Button } from "../ui/button";
import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem
} from "../ui/segmented";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

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
  polygonLengthEditing = false,
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
  onAddOpening: (kind: InsertToolKind) => void;
  onCommitHeight: (heightMm: number) => Promise<void>;
  onCommitLength: (lengthMm: number, anchor: ResizeAnchor) => Promise<void>;
  polygonLengthEditing?: boolean;
  roomName: string;
  unit: DisplayUnit;
  wallHeightMm: number;
  wallLengthMm: number;
  wallName: string;
}) {
  const [fixedLengthAnchor, setFixedLengthAnchor] = useState<ResizeAnchor>("start");
  const fixedLengthAnchorRef = useRef<ResizeAnchor>("start");
  const [lengthGroupFocused, setLengthGroupFocused] = useState(false);
  const [lengthDirty, setLengthDirty] = useState(false);
  const lengthAnchorLabelId = useId();
  const lengthAnchorHintId = useId();
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
  const formattedWallLength = formatLength(wallLengthMm, {
    unit: wallScope.displayUnit
  });
  const movingEndpoint: ResizeAnchor =
    fixedLengthAnchor === "start" ? "end" : "start";
  const selectMovingEndpoint = (endpoint: ResizeAnchor) => {
    const fixedAnchor = endpoint === "start" ? "end" : "start";
    fixedLengthAnchorRef.current = fixedAnchor;
    setFixedLengthAnchor(fixedAnchor);
  };

  useEffect(() => {
    setLengthDirty(false);
  }, [wallLengthMm, wallName, wallScope.displayUnit]);

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
          <div
            className="wall-length-edit-group"
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setLengthGroupFocused(false);
              }
            }}
            onChangeCapture={(event) => {
              if (event.target instanceof HTMLInputElement) {
                setLengthDirty(event.target.value !== formattedWallLength);
              }
            }}
            onFocusCapture={() => setLengthGroupFocused(true)}
            onKeyDownCapture={(event) => {
              if (event.key === "Escape") setLengthDirty(false);
            }}
          >
            <LengthField
              positiveOnly
              label="Length"
              valueMm={wallLengthMm}
              displayUnit={wallScope.displayUnit}
              parseUnit={wallScope.parseUnit}
              placeholder={wallPlaceholder}
              onCommit={async (lengthMm) => {
                await onCommitLength(lengthMm, fixedLengthAnchorRef.current);
                setLengthDirty(false);
              }}
              commitErrorFallback="Could not resize this wall."
            />
            {polygonLengthEditing && (lengthGroupFocused || lengthDirty) ? (
              <div className="inspector-row wall-length-anchor-row">
                <span className="inspector-row-label" id={lengthAnchorLabelId}>
                  Move endpoint
                </span>
                <div className="inspector-row-control">
                  <SegmentedToggleGroup
                    aria-describedby={lengthAnchorHintId}
                    aria-labelledby={lengthAnchorLabelId}
                    className="wall-length-anchor-toggle"
                    type="single"
                    value={movingEndpoint}
                    onValueChange={(value) => {
                      if (value === "start" || value === "end") {
                        selectMovingEndpoint(value);
                      }
                    }}
                  >
                    <SegmentedToggleGroupItem
                      value="start"
                      onPointerDown={() => selectMovingEndpoint("start")}
                    >
                      <WallLengthAnchorIcon movingEndpoint="start" />
                      <span>Start</span>
                    </SegmentedToggleGroupItem>
                    <SegmentedToggleGroupItem
                      value="end"
                      onPointerDown={() => selectMovingEndpoint("end")}
                    >
                      <WallLengthAnchorIcon movingEndpoint="end" />
                      <span>End</span>
                    </SegmentedToggleGroupItem>
                  </SegmentedToggleGroup>
                  <p className="field-hint wall-length-anchor-hint" id={lengthAnchorHintId}>
                    The other endpoint stays in place.
                  </p>
                </div>
              </div>
            ) : null}
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
            Doorway reaches the floor. Blocks artwork placement.
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
            Window is centered on the wall. Blocks artwork placement.
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
            Marks an area that blocks artwork placement, such as a vent or outlet.
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="opening-add-chip"
              variant="inspector"
              onClick={() => onAddOpening("wall-text")}
            >
              <TextAlignLeftIcon aria-hidden="true" size={16} />
              <span>Wall text</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent className="opening-add-tooltip" side="bottom">
            Text panel is centered on the wall. Does not block artwork placement.
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

// A compact diagram keeps the choice spatial without asking an icon to carry
// the meaning alone: the outlined endpoint is the one that moves, while the
// filled endpoint stays in place.
function WallLengthAnchorIcon({ movingEndpoint }: { movingEndpoint: ResizeAnchor }) {
  const movingX = movingEndpoint === "start" ? 3 : 17;
  const fixedX = movingEndpoint === "start" ? 17 : 3;

  return (
    <svg
      aria-hidden="true"
      className="wall-length-anchor-icon"
      focusable="false"
      viewBox="0 0 20 10"
    >
      <line x1="3" x2="17" y1="5" y2="5" />
      <circle className="wall-length-anchor-fixed" cx={fixedX} cy="5" r="2.25" />
      <circle className="wall-length-anchor-moving" cx={movingX} cy="5" r="1.75" />
    </svg>
  );
}
