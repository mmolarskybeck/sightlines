import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import type { DisplayUnit } from "../../domain/project";
import type { RectangleRoomDimensions } from "../../domain/geometry/walls";
import {
  getPlaceholderForScope,
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "../../domain/units/unitSystem";
import { LengthField } from "./LengthField";
import { RoomDimensionFields } from "./RoomDimensionFields";
import { Button } from "./ui/button";

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
  const system = unitSystemFromDisplayUnit(unit);
  const { displayUnit, parseUnit } = getScopeUnits(system, "wall");
  const placeholder = getPlaceholderForScope(system, "wall");

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <div className="inspector-placement">
        {/* Non-rectangular rooms show their reshape handles whenever they're
            selected, so the arm/disarm button only exists for rectangles
            (where it swaps the width/depth resize handles for reshape ones). */}
        {rectangleDimensions ? (
          <>
            <Button
              aria-pressed={reshapeActive}
              className="inspector-action"
              variant={reshapeActive ? "primary" : "inspector"}
              onClick={onToggleReshape}
            >
              <PencilSimpleIcon aria-hidden="true" size={15} />
              {reshapeActive ? "Done editing shape" : "Edit shape"}
            </Button>
            <p className="field-hint">
              {reshapeActive
                ? "Drag a corner or a wall to reshape the room, or click a wall's + to split it. Escape to finish."
                : "Drag corners, split walls, or remove a corner to change this room's outline."}
            </p>
          </>
        ) : (
          <p className="field-hint">
            Drag a corner or a wall to reshape the room, click a wall's + to
            split it, or select a corner and press Delete to remove it.
          </p>
        )}
      </div>

      {rectangleDimensions ? (
        <div className="artwork-dimensions">
          <div className="artwork-dimensions-heading">
            <h3>Room dimensions</h3>
          </div>
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
        </div>
      ) : (
        <div className="constraint-panel">
          <div>
            <h3>Custom room shape</h3>
            <p>Numeric width and depth editing is available for rectangular rooms.</p>
          </div>
        </div>
      )}

      <div className="artwork-dimensions">
        <div className="artwork-dimensions-heading">
          <h3>Wall height</h3>
        </div>
        <LengthField
          positiveOnly
          label="Height"
          valueMm={roomHeightMm}
          displayUnit={displayUnit}
          parseUnit={parseUnit}
          placeholder={placeholder}
          onCommit={onCommitHeight}
          commitErrorFallback="Could not resize this room's walls."
          focusHint={"Accepts 12', 12 ft, 144\", 365.8 cm, or 3.66 m."}
        />
        <p className="field-hint">
          Applies to all {wallCount} wall{wallCount === 1 ? "" : "s"} in {roomName}.
        </p>
      </div>

      <dl className="property-list compact">
        <div>
          <dt>Objects</dt>
          <dd>{objectCount}</dd>
        </div>
        <div>
          <dt>Artworks</dt>
          <dd>{artworkCount}</dd>
        </div>
        <div>
          <dt>Walls</dt>
          <dd>{wallCount}</dd>
        </div>
      </dl>
    </form>
  );
}
