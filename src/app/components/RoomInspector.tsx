import type { DisplayUnit } from "../../domain/project";
import type { RectangleRoomDimensions } from "../../domain/geometry/walls";
import {
  getPlaceholderForScope,
  getScopeUnits,
  unitSystemFromDisplayUnit
} from "../../domain/units/unitSystem";
import { LengthField } from "./LengthField";
import { RoomDimensionFields } from "./RoomDimensionFields";

export function RoomInspector({
  artworkCount,
  objectCount,
  rectangleDimensions,
  roomHeightMm,
  roomName,
  unit,
  wallCount,
  onCommitDepth,
  onCommitHeight,
  onCommitWidth
}: {
  artworkCount: number;
  objectCount: number;
  rectangleDimensions: RectangleRoomDimensions | null;
  roomHeightMm: number;
  roomName: string;
  unit: DisplayUnit;
  wallCount: number;
  onCommitDepth: (lengthMm: number) => Promise<void>;
  onCommitHeight: (heightMm: number) => Promise<void>;
  onCommitWidth: (lengthMm: number) => Promise<void>;
}) {
  const system = unitSystemFromDisplayUnit(unit);
  const { displayUnit, parseUnit } = getScopeUnits(system, "wall");
  const placeholder = getPlaceholderForScope(system, "wall");

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
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
