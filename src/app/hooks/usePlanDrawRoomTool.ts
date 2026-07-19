import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { Vector2 } from "../../domain/geometry/dragResize";
import type { FloorWall } from "../../domain/geometry/planObjects";
import { isSimplePolygon, type Point } from "../../domain/geometry/polygon";
import { snapDrawPointToRooms, type DrawRoomSnap } from "../../domain/geometry/drawSnapping";
import {
  drawCloseOnWall,
  drawSegmentInvalid,
  isWithinClose
} from "../../domain/geometry/drawRoomTool";
import type { DrawState } from "../components/plan/types";

// Polygon-room close-target radius in screen pixels.
const CLOSE_HANDLE_PX = 12;
// Ignore points that would create a zero-length wall.
const MIN_DRAW_SPACING_MM = 10;

// The polygon-room draw gesture, lifted out of PlanView verbatim: the transient
// draw state (points + rubber-band cursor), its arming/keyboard effects, and
// the pointer/click handlers the capture overlay wires up. Pure snap/validity
// predicates live in domain/geometry/drawRoomTool. snapDrawPoint is threaded in
// because the grid/previous-axis snap it performs is shared with the other draw
// gestures (rectangle, partition) that stay in PlanView.
export function usePlanDrawRoomTool(options: {
  drawRoomActive: boolean;
  toSvgMm: (clientX: number, clientY: number) => Vector2 | null;
  floorWallsForTool: FloorWall[];
  snapThresholdMm: number;
  pixelsPerMm: number;
  snapDrawPoint: (pointerMm: Vector2, prev: Vector2 | null, shiftKey: boolean) => Vector2;
  suppressNextToolClickRef: MutableRefObject<boolean>;
  onAddPolygonRoom: ((pointsFloorMm: Point[]) => void) | undefined;
  onDrawRoomChange: ((active: boolean) => void) | undefined;
}) {
  const {
    drawRoomActive,
    toSvgMm,
    floorWallsForTool,
    snapThresholdMm,
    pixelsPerMm,
    snapDrawPoint,
    suppressNextToolClickRef,
    onAddPolygonRoom,
    onDrawRoomChange
  } = options;

  // Ref lets keyboard handlers read current points without resubscribing.
  const [draw, setDraw] = useState<DrawState | null>(null);
  const drawRef = useRef<DrawState | null>(null);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Arming starts fresh; disarming discards uncommitted points.
  useEffect(() => {
    setDraw(
      drawRoomActive
        ? { points: [], cursorMm: null, invalid: false, closing: false, snap: null }
        : null
    );
  }, [drawRoomActive]);

  // Enter closes, Backspace removes a point, and Escape cancels.
  useEffect(() => {
    if (!drawRoomActive) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onDrawRoomChange?.(false);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        attemptCloseDraw();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        setDraw((state) =>
          state
            ? { ...state, points: state.points.slice(0, -1), invalid: false, closing: false, snap: null }
            : state
        );
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawRoomActive]);

  // Existing-room snapping outranks grid; Shift axis-lock applies afterward.
  function snapDrawCandidate(
    pointerMm: Vector2,
    prev: Vector2 | null,
    shiftKey: boolean
  ): { point: Vector2; snap: DrawRoomSnap | null } {
    const snap = snapDrawPointToRooms(pointerMm, floorWallsForTool, snapThresholdMm);
    if (!snap) {
      return { point: snapDrawPoint(pointerMm, prev, shiftKey), snap: null };
    }
    let point: Vector2 = { xMm: snap.pointMm.xMm, yMm: snap.pointMm.yMm };
    if (shiftKey && prev) {
      const dx = Math.abs(pointerMm.xMm - prev.xMm);
      const dy = Math.abs(pointerMm.yMm - prev.yMm);
      point =
        dx >= dy ? { xMm: point.xMm, yMm: prev.yMm } : { xMm: prev.xMm, yMm: point.yMm };
    }
    return { point, snap };
  }

  function closeRadiusMm(): number {
    return pixelsPerMm > 0 ? CLOSE_HANDLE_PX / pixelsPerMm : 0;
  }

  function attemptCloseDraw() {
    const current = drawRef.current;
    if (!current || current.points.length < 3) return;
    if (!isSimplePolygon(current.points)) {
      setDraw((state) => (state ? { ...state, invalid: true } : state));
      return;
    }
    onAddPolygonRoom?.(current.points.map((point) => ({ xMm: point.xMm, yMm: point.yMm })));
    onDrawRoomChange?.(false);
  }

  function handleDrawPointerMove(event: ReactPointerEvent<SVGRectElement>) {
    const current = drawRef.current;
    if (!current) return;
    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    if (isWithinClose(current.points, pointerMm, closeRadiusMm())) {
      setDraw((state) =>
        state
          ? { ...state, cursorMm: state.points[0], invalid: false, closing: true, snap: null }
          : state
      );
      return;
    }

    const prev = current.points.at(-1) ?? null;
    const { point: candidate, snap } = snapDrawCandidate(pointerMm, prev, event.shiftKey);
    // Preview a shared-wall close with the same affordance as the first vertex.
    const willClose = drawCloseOnWall(current.points, candidate, snap, floorWallsForTool);
    const invalid = !willClose && drawSegmentInvalid(current.points, candidate);
    setDraw((state) =>
      state ? { ...state, cursorMm: candidate, invalid, closing: willClose, snap } : state
    );
  }

  function handleDrawClick(event: ReactMouseEvent<SVGRectElement>) {
    // Prevent the SVG background/tool handler from also running.
    event.stopPropagation();
    // Swallow the trailing click from a space/middle-button pan.
    if (suppressNextToolClickRef.current) {
      suppressNextToolClickRef.current = false;
      return;
    }
    const current = drawRef.current;
    if (!current) return;
    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    if (isWithinClose(current.points, pointerMm, closeRadiusMm())) {
      attemptCloseDraw();
      return;
    }

    const prev = current.points.at(-1) ?? null;
    const { point: candidate, snap } = snapDrawCandidate(pointerMm, prev, event.shiftKey);
    // Shared-wall close precedes minimum spacing so a nearby close still completes.
    if (drawCloseOnWall(current.points, candidate, snap, floorWallsForTool)) {
      const closedPoints = [...current.points, candidate];
      onAddPolygonRoom?.(closedPoints.map((point) => ({ xMm: point.xMm, yMm: point.yMm })));
      onDrawRoomChange?.(false);
      return;
    }
    if (
      prev &&
      Math.hypot(candidate.xMm - prev.xMm, candidate.yMm - prev.yMm) < MIN_DRAW_SPACING_MM
    ) {
      return;
    }
    if (drawSegmentInvalid(current.points, candidate)) {
      setDraw((state) => (state ? { ...state, invalid: true } : state));
      return;
    }
    setDraw((state) =>
      state
        ? {
            points: [...state.points, candidate],
            cursorMm: candidate,
            invalid: false,
            closing: false,
            snap
          }
        : state
    );
  }

  return { draw, handleDrawPointerMove, handleDrawClick };
}
