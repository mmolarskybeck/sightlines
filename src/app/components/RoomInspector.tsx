import type { DisplayUnit } from "../../domain/project";
import type { RectangleRoomDimensions } from "../../domain/geometry/walls";
import { formatLength } from "../../domain/units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
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
  onCommitWidth: (lengthMm: number) => Promise<void>;
}) {
  const system = unitSystemFromDisplayUnit(unit);
  const wallUnit = getScopeUnits(system, "wall").displayUnit;

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
        <div>
          <dt>Wall height</dt>
          <dd>{formatLength(roomHeightMm, { unit: wallUnit })}</dd>
        </div>
      </dl>
    </form>
  );
}
