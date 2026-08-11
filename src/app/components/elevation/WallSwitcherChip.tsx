import { useRef } from "react";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import type { DisplayUnit } from "../../../domain/project";
import { ToolbarTooltipKbd } from "../toolbar/ToolbarTooltipKbd";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { WallSwitcher, type WallSwitcherEntry } from "./WallSwitcher";

// The chip only switches when there is an inventory to switch through AND the
// wall on screen is part of it — otherwise the caller falls back to a plain
// label. Exported so callers can pick their fallback without re-deriving it.
export function canSwitchWalls(walls: WallSwitcherEntry[], currentWallId: string | undefined) {
  return walls.length > 0 && walls.some((wall) => wall.id === currentWallId);
}

// Wall switcher chip for the elevation surfaces. Prev/next cycle through every
// placeable surface in room order (each room's perimeter walls then its
// partition faces, wrapping at the ends), and the WallSwitcher menu lists them
// all — grouped by room, faces sectioned under "Partitions", once more than one
// room exists.
//
// Lives outside ElevationView because an OPEN wall has no elevation to draw yet
// must stay navigable: the empty state renders the same chip, so the switcher
// never disappears mid-navigation.
export function WallSwitcherChip({
  walls,
  currentWallId,
  onSelectWall,
  unit
}: {
  walls: WallSwitcherEntry[];
  currentWallId: string;
  onSelectWall: (id: string) => void;
  unit: DisplayUnit;
}) {
  const previousWallButtonRef = useRef<HTMLButtonElement>(null);
  const nextWallButtonRef = useRef<HTMLButtonElement>(null);

  const currentWallIndex = walls.findIndex((wall) => wall.id === currentWallId);
  const stepWall = (delta: number) => {
    if (currentWallIndex < 0) return;
    const next = walls[(currentWallIndex + delta + walls.length) % walls.length];
    if (next) onSelectWall(next.id);
  };

  if (!canSwitchWalls(walls, currentWallId)) return null;

  return (
    // Switcher chip: the browser trigger leads (it carries the room, wall,
    // and dimensions itself) and the prev/next steppers dock behind a
    // hairline at the trailing edge, so the two-column menu can align with
    // the chip's leading edge and drop fully below it.
    <div
      className="surface-label surface-label-switcher"
      data-owns-arrow-keys
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const focusedStepper =
          event.target === previousWallButtonRef.current ||
          event.target === nextWallButtonRef.current;
        stepWall(direction);
        if (focusedStepper) {
          (direction === -1 ? previousWallButtonRef : nextWallButtonRef).current?.focus();
        }
      }}
    >
      <WallSwitcher
        walls={walls}
        unit={unit}
        currentWallId={currentWallId}
        onSelectWall={onSelectWall}
      />
      <span aria-hidden="true" className="surface-label-divider" />
      <div className="surface-label-steps">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Previous wall"
              className="surface-label-switch"
              ref={previousWallButtonRef}
              size="icon-sm"
              variant="ghost"
              onClick={() => stepWall(-1)}
            >
              <CaretLeftIcon aria-hidden="true" size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="bottom">
            Previous wall <ToolbarTooltipKbd hint="←" />
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Next wall"
              className="surface-label-switch"
              ref={nextWallButtonRef}
              size="icon-sm"
              variant="ghost"
              onClick={() => stepWall(1)}
            >
              <CaretRightIcon aria-hidden="true" size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="bottom">
            Next wall <ToolbarTooltipKbd hint="→" />
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
