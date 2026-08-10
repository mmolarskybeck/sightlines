import { WallIcon } from "@phosphor-icons/react/dist/csr/Wall";
import { Button } from "../ui/button";

// Three states, matching the reasons the Elevation tab can have nothing
// to draw: no rooms exist yet, or rooms exist but no wall is selected. The
// glyph is decorative shorthand for "a wall elevation" (outline + a
// centerline hint, echoing the real elevation drawing's own `.wall-fill`/
// `.centerline` treatment) — it carries no information of its own, so it's
// hidden from assistive tech and the copy alone stays the readable message.
export function ElevationEmptyState({
  hasRooms,
  openWallName,
  onRestoreWall
}: {
  hasRooms: boolean;
  // Set when the selected wall is OPEN — a third state, distinct from "nothing
  // selected": there is a wall, it just has no surface to draw.
  openWallName?: string;
  onRestoreWall?: () => void;
}) {
  const isOpenWall = openWallName !== undefined;
  const copy = isOpenWall
    ? `${openWallName} is open, so there is no surface to elevate.`
    : hasRooms
      ? "Select a wall from the Gallery list to see its elevation."
      : "Add a room, then select a wall to see its elevation.";

  return (
    <div className="drawing-surface-empty">
      <div className="canvas-empty">
        <svg
          aria-hidden="true"
          className="canvas-empty-glyph"
          focusable="false"
          viewBox="0 0 120 84"
        >
          {/* For an open wall the outline itself goes dashed: the boundary is
              still where it was, there is simply no surface on it. */}
          <rect
            height="68"
            rx="2"
            width="104"
            x="8"
            y="8"
            strokeDasharray={isOpenWall ? "4 6" : undefined}
          />
          <line strokeDasharray="4 4" x1="8" x2="112" y1="42" y2="42" />
        </svg>
        <p className="empty-copy">{copy}</p>
        {onRestoreWall ? (
          <Button className="inspector-action" variant="inspector" onClick={onRestoreWall}>
            <WallIcon aria-hidden="true" size={15} />
            Restore wall
          </Button>
        ) : null}
      </div>
    </div>
  );
}
