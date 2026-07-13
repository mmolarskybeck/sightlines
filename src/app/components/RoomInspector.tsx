import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import type { DisplayUnit } from "../../domain/project";
import type { RectangleRoomDimensions } from "../../domain/geometry/walls";
import { getScopedUnitContext } from "./scopedUnits";
import { LengthField } from "./LengthField";
import { RoomDimensionFields } from "./RoomDimensionFields";
import { InspectorSection } from "./InspectorSection";
import { InspectorActionGroup } from "./InspectorActionGroup";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function RoomInspector({
  artworkCount,
  objectCount,
  rectangleDimensions,
  reshapeActive,
  roomHeightMm,
  roomName,
  unit,
  wallCount,
  onCommitDepth,
  onCommitHeight,
  onCommitWidth,
  onToggleReshape
}: {
  artworkCount: number;
  objectCount: number;
  rectangleDimensions: RectangleRoomDimensions | null;
  // Whether this room is currently the one in vertex/wall-split reshape
  // mode (PlanView renders the handles; this button just arms/disarms it).
  reshapeActive: boolean;
  roomHeightMm: number;
  roomName: string;
  unit: DisplayUnit;
  wallCount: number;
  onCommitDepth: (lengthMm: number) => Promise<void>;
  onCommitHeight: (heightMm: number) => Promise<void>;
  onCommitWidth: (lengthMm: number) => Promise<void>;
  onToggleReshape: () => void;
}) {
  const { displayUnit, parseUnit, placeholder } = getScopedUnitContext(unit, "wall");

  // Kept to one line on the panel; the multi-step how-to (split a wall,
  // delete a corner, escape to finish) moves into the button's tooltip
  // instead of stacking a second sentence onto the visible hint (see
  // ArtworkInspector's "Keep proportions" lock toggle for the same split).
  const reshapeHint = reshapeActive
    ? "Drag corners to reshape."
    : "Drag a wall's handle to move that wall.";
  const reshapeGuidance = reshapeActive
    ? "Drag corners to reshape. Use + to split a wall. Select a corner and press Delete to remove it. Escape to finish."
    : "Drag a wall's handle to move that wall. Edit shape to move corners or split walls.";

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <div className="room-shape-row">
        {/* Edit shape arms corner/split editing for every room. Not armed, a
            selected room shows wall-slide chips (rectangles show resize chips
            instead); the button swaps those for vertex/split handles. */}
        <p className="field-hint">{reshapeHint}</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-pressed={reshapeActive}
              className="inspector-action room-shape-action"
              variant={reshapeActive ? "primary" : "inspector"}
              onClick={onToggleReshape}
            >
              <PencilSimpleIcon aria-hidden="true" size={15} />
              {reshapeActive ? "Done editing shape" : "Edit shape"}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="bottom">
            {reshapeGuidance}
          </TooltipContent>
        </Tooltip>
      </div>

      {rectangleDimensions ? (
        <InspectorSection collapsible={false} title="Room dimensions">
          <RoomDimensionFields
            depthMm={rectangleDimensions.depthMm}
            onCommitDepth={onCommitDepth}
            onCommitWidth={onCommitWidth}
            unit={unit}
            widthMm={rectangleDimensions.widthMm}
          />
          <p className="field-hint">
            Width and depth update the paired walls for {roomName}.
          </p>
        </InspectorSection>
      ) : (
        <div className="constraint-panel">
          <div>
            <h3>Custom room shape</h3>
            <p>Numeric width and depth editing is available for rectangular rooms.</p>
          </div>
        </div>
      )}

      {/* Wall height stays a single compact field — its own "Height" label
          already says what it is, so it doesn't need a section heading like
          the width/depth pair above. */}
      <div className="field-group">
        <LengthField
          positiveOnly
          label="Height"
          valueMm={roomHeightMm}
          displayUnit={displayUnit}
          parseUnit={parseUnit}
          placeholder={placeholder}
          onCommit={onCommitHeight}
          commitErrorFallback="Could not resize this room's walls."
        />
        <p className="field-hint">
          Applies to all {wallCount} wall{wallCount === 1 ? "" : "s"} in {roomName}.
        </p>
      </div>

      {/* Counts are informational, not editable geometry — one quiet line
          instead of the old bordered property list keeps that distinction
          visible instead of implying these are more fields to fill in. */}
      <p className="field-hint">
        {wallCount} wall{wallCount === 1 ? "" : "s"} · {artworkCount} artwork
        {artworkCount === 1 ? "" : "s"} · {objectCount} object{objectCount === 1 ? "" : "s"}
      </p>
    </form>
  );
}
