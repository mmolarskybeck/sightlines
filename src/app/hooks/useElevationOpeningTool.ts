import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { Vector2 } from "../../domain/geometry/dragResize";
import type { WallObject } from "../../domain/project";
import { type InsertToolKind } from "../../domain/placement/createOpening";
import { getDefaultInsertToolSizeMm } from "../../domain/placement/createWallText";
import type { Guide, SnapTargetIds } from "../../domain/snapping/resolveSnap";

type ElevationPlacementResult = {
  point: Vector2;
  activeGuides: Guide[];
  snapTargetIds: SnapTargetIds;
  brokenBarrierIds: string[];
  blocked: boolean;
};

type OpeningToolGhostState = {
  centerMm: Vector2;
  sizeMm: { widthMm: number; heightMm: number };
  activeGuides: Guide[];
};

// The elevation opening/insert-tool ghost cluster, lifted out of ElevationView
// verbatim. It owns the tool's snap hysteresis ref; the ghost state itself
// stays in the view (the JSX renders it) and its setter is passed through.
export function useElevationOpeningTool(options: {
  activeTool: InsertToolKind | null;
  wallId: string | undefined;
  onToolChange: ((tool: InsertToolKind | null) => void) | undefined;
  onPlaceOpeningOnElevation:
    | ((kind: InsertToolKind, wallId: string, xMm: number, yMm: number) => void)
    | undefined;
  setOpeningToolGhost: (ghost: OpeningToolGhostState | null) => void;
  toWallLocalMm: (clientX: number, clientY: number) => Vector2 | null;
  wallObjectsOnThisWall: WallObject[];
  resolveElevationPlacement: (
    proposed: Vector2,
    sizeMm: { widthMm: number; heightMm: number },
    neighbors: WallObject[],
    movingKind: WallObject["kind"],
    movingKinds: WallObject["kind"][],
    previousSnapTargetIds: SnapTargetIds | undefined,
    precisionBypass: boolean,
    brokenBarrierIds: ReadonlySet<string>
  ) => ElevationPlacementResult;
  moveDrag: unknown;
  marquee: unknown;
  dropGhost: unknown;
}) {
  const {
    activeTool,
    wallId,
    onToolChange,
    onPlaceOpeningOnElevation,
    setOpeningToolGhost,
    toWallLocalMm,
    wallObjectsOnThisWall,
    resolveElevationPlacement,
    moveDrag,
    marquee,
    dropGhost
  } = options;

  const openingToolSnapTargetIdsRef = useRef<SnapTargetIds | undefined>(undefined);

  const openingToolSize = activeTool ? getDefaultInsertToolSizeMm(activeTool) : null;

  // Opening insertion uses the same live snap/barrier resolver as an elevation
  // move. The only difference is that the preview starts from the pointer and
  // the committed result creates a new wall object instead of moving one.
  // Doors must sit on the floorline, so their preview y is pinned to heightMm/2.
  function resolveOpeningTool(proposed: Vector2) {
    if (!activeTool || !openingToolSize) return null;
    const result = resolveElevationPlacement(
      proposed,
      openingToolSize,
      wallObjectsOnThisWall,
      activeTool,
      [activeTool],
      openingToolSnapTargetIdsRef.current,
      false,
      new Set()
    );
    openingToolSnapTargetIdsRef.current = result.snapTargetIds;

    // Doors sit on the floorline: pin their preview y to the center position
    // (bottom edge at y=0 means center at height/2).
    if (activeTool === "door") {
      return {
        ...result,
        point: {
          ...result.point,
          yMm: openingToolSize.heightMm / 2
        }
      };
    }

    return result;
  }

  function handleOpeningToolPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!activeTool || !openingToolSize || moveDrag || marquee || dropGhost) return;
    const pointerMm = toWallLocalMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const result = resolveOpeningTool(pointerMm);
    if (!result) return;
    setOpeningToolGhost({
      centerMm: result.point,
      sizeMm: openingToolSize,
      activeGuides: result.activeGuides
    });
  }

  function handleOpeningToolPointerLeave() {
    setOpeningToolGhost(null);
    openingToolSnapTargetIdsRef.current = undefined;
  }

  function handleOpeningToolClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (!activeTool || !openingToolSize || !wallId || !onPlaceOpeningOnElevation) return;
    if (moveDrag || marquee) return;

    const pointerMm = toWallLocalMm(event.clientX, event.clientY);
    if (!pointerMm) return;
    const result = resolveOpeningTool(pointerMm);
    if (!result || result.blocked) return;

    const kind = activeTool;
    onToolChange?.(null);
    void onPlaceOpeningOnElevation(kind, wallId, result.point.xMm, result.point.yMm);
  }

  useEffect(() => {
    setOpeningToolGhost(null);
    openingToolSnapTargetIdsRef.current = undefined;
  }, [activeTool, wallId]);

  useEffect(() => {
    if (!activeTool) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onToolChange?.(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTool, onToolChange]);

  return {
    handleOpeningToolPointerMove,
    handleOpeningToolPointerLeave,
    handleOpeningToolClick
  };
}
