import { CompassIcon } from "@phosphor-icons/react/dist/csr/Compass";
import { DoorIcon } from "@phosphor-icons/react/dist/csr/Door";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { WallIcon } from "@phosphor-icons/react/dist/csr/Wall";
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link";
import { RectangleDashedIcon } from "@phosphor-icons/react/dist/csr/RectangleDashed";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";
import { TextAlignLeftIcon } from "@phosphor-icons/react/dist/csr/TextAlignLeft";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { ResizeAnchor } from "../../../domain/geometry/editRoom";
import type { InsertToolKind } from "../../../domain/placement/createOpening";
import type { DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import { getScopeUnits } from "../../../domain/units/unitSystem";
import { getScopedUnitContext } from "../shared/scopedUnits";
// Same glyph the Case insert tool uses, so the chip and the toolbar name the
// same object.
import { CaseGlyph, ShelfGlyph } from "../toolbar/toolbarGlyphs";
import { InspectorSection } from "./InspectorSection";
import { InspectorSummaryRow } from "./InspectorSummaryRow";
import { InspectorNotice } from "./InspectorNotice";
import { InspectorActionGroup } from "./InspectorActionGroup";
import { LengthField } from "../shared/LengthField";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
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
  canSetNorth = false,
  centerlineMm,
  changedWallNames,
  dimensionLink,
  isOpenSide = false,
  lastGeometryEdit,
  onAddCase,
  onAddOpening,
  onAddShelf,
  onCommitHeight,
  onCommitLength,
  onOpenWall,
  onRenameWall,
  onRestoreWall,
  onSetNorthWall,
  polygonLengthEditing = false,
  roomName,
  unit,
  wallHeightMm,
  wallLengthMm,
  wallName
}: {
  // False for any room that is not a quadrilateral — there is no compass to
  // assign, so the action is hidden rather than offered and refused.
  canSetNorth?: boolean;
  centerlineMm: number;
  changedWallNames: string[];
  dimensionLink: WallDimensionLink | null;
  isOpenSide?: boolean;
  lastGeometryEdit: {
    anchorVertexId: string;
    changedWallIds: string[];
  } | null;
  onAddCase: () => void;
  onAddOpening: (kind: InsertToolKind) => void;
  onAddShelf: () => void;
  onCommitHeight: (heightMm: number) => Promise<void>;
  onCommitLength: (lengthMm: number, anchor: ResizeAnchor) => Promise<void>;
  onOpenWall: () => void;
  onRenameWall: (name: string) => void;
  onRestoreWall: () => void;
  onSetNorthWall: () => void;
  polygonLengthEditing?: boolean;
  roomName: string;
  unit: DisplayUnit;
  wallHeightMm: number;
  wallLengthMm: number;
  wallName: string;
}) {
  const [nameDraft, setNameDraft] = useState(wallName);
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

  // Resync whenever the committed name changes out from under us, the way
  // LengthField resyncs on its value: App keys this inspector on the wall id,
  // so a selection change remounts — but a rename from the rooms panel (or an
  // undo, or "Use as North wall") keeps the same wall selected and must not
  // leave a stale draft here to commit back over it.
  useEffect(() => {
    setNameDraft(wallName);
  }, [wallName]);

  // Same shape as LengthField's commit: blur or Enter commits, Escape restores
  // the last committed value. A wall must always be named, so an empty field
  // reverts instead of clearing.
  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed.length === 0) {
      setNameDraft(wallName);
      return;
    }
    if (trimmed === wallName) return;
    onRenameWall(trimmed);
  };

  return (
    <form
      className="inspector-form"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="inspector-sections wall-size-sections">
        {/* The name leads: it is what the elevation header, the wall switcher
            and every PDF page title read, so it belongs above the geometry
            rather than buried under it. */}
        <InspectorSection collapsible={false} title="Wall">
          <Field label="Name">
            <Input
              value={nameDraft}
              onBlur={commitName}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Escape") {
                  // stopPropagation for the same reason LengthField does it: a
                  // global deselect-on-Escape must not eat a field revert. A
                  // clean field passes Escape through.
                  if (nameDraft === wallName) return;
                  event.stopPropagation();
                  setNameDraft(wallName);
                  return;
                }
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.currentTarget.blur();
              }}
            />
          </Field>
        </InspectorSection>
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
                    className="wall-length-anchor-toggle seg-compact--lg"
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

      {/* An open wall has no surface, so the whole "add" category is
          unavailable — hidden rather than disabled, because five dead controls
          under a label promising something impossible explains nothing. The
          Size fields above stay live: the wall's endpoints still define the
          room's shape, and for a polygon room this is the only place to resize
          that edge numerically. */}
      {isOpenSide ? (
        <>
          <InspectorNotice
            icon={<DoorOpenIcon aria-hidden="true" size={15} />}
            tone="info"
          >
            {/* Three jobs, three sentences: the state now, what the button
                below does, and the one thing it deliberately does not do.
                Restore rebuilds geometry only — the wall objects were deleted
                when it opened, so undo is the sole route back to them. */}
            This wall is open, so {roomName} has no surface on this side. Restoring it
            will rebuild that surface, but not what was on it. Only undo will bring
            those back.
          </InspectorNotice>
          <InspectorActionGroup>
            <Button className="inspector-action" variant="inspector" onClick={onRestoreWall}>
              <WallIcon aria-hidden="true" size={15} />
              Restore wall
            </Button>
          </InspectorActionGroup>
        </>
      ) : (
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="opening-add-chip"
              variant="inspector"
              onClick={onAddCase}
            >
              <CaseGlyph aria-hidden="true" size={16} />
              <span>Wall case</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent className="opening-add-tooltip" side="bottom">
            Vitrine hung on the wall at waist height, centered. Does not block
            artwork placement.
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="opening-add-chip"
              variant="inspector"
              onClick={onAddShelf}
            >
              <ShelfGlyph aria-hidden="true" size={16} />
              <span>Shelf</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent className="opening-add-tooltip" side="bottom">
            Shelf centered on the wall. Works dragged onto it stand on its top
            edge and travel with it.
          </TooltipContent>
        </Tooltip>
      </InspectorActionGroup>
      )}

      {/* Centerline is a hanging-height readout: meaningless without a surface,
          and a static row has no affordance to explain its own absence. */}
      {isOpenSide ? null : (
        <InspectorSummaryRow
          label="Centerline"
          value={formatLength(centerlineMm, {
            unit: centerlinePrimary,
            secondaryUnit: centerlineSecondary
          })}
        />
      )}

      {isOpenSide && !canSetNorth ? null : (
        <InspectorActionGroup>
          {/* Relabels the whole room, not just this wall — the confirm App
              raises when custom names are at stake says so. Available on an
              open wall too: the wall record is still in the loop, so it can
              still be the room's north. */}
          {canSetNorth ? (
            <Button className="inspector-action" variant="inspector" onClick={onSetNorthWall}>
              <CompassIcon aria-hidden="true" size={15} />
              Use as North wall
            </Button>
          ) : null}
          {/* Not a TrashIcon: this doesn't delete the wall record, it removes
              the surface — the room's edge stays. `destructive-ghost` is still
              right, because the wall's contents really are destroyed. */}
          {isOpenSide ? null : (
            <Button
              className="inspector-action inspector-danger"
              variant="destructive-ghost"
              onClick={onOpenWall}
            >
              <DoorOpenIcon aria-hidden="true" size={15} />
              Open this wall
            </Button>
          )}
        </InspectorActionGroup>
      )}
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
