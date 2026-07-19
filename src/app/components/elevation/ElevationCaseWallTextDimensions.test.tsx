// Covers the fix that folds wall cases and wall texts into
// wallObjectsOnThisWall (ElevationView.tsx) so they participate in the same
// dimension-line / marquee stack as artworks and openings — previously only
// elevationScene.artworks + .openings fed that array, so a lone selected case
// or wall text drew no margin dims and a marquee couldn't pick either up.
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWallCase } from "../../../domain/placement/createCase";
import { createWallTextPlacement } from "../../../domain/placement/createWallText";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { getWallsWithGeometry } from "../../../domain/geometry/walls";
import { FIT_VIEWPORT } from "../../../domain/viewport/viewport2d";
import { useAppStore } from "../../store";
import { TooltipProvider } from "../ui/tooltip";
import { ElevationView } from "./ElevationView";
import type { WallObject } from "../../../domain/project";

class MockResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 1000, height: 600 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  unobserve() {}
  disconnect() {}
}

class MockPointerEvent extends MouseEvent {
  readonly isPrimary: boolean;
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.isPrimary = init.isPrimary ?? true;
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("PointerEvent", MockPointerEvent);
  // Identity client→SVG-userspace mapping (same trick as
  // ElevationMeasurement.test.tsx): matrixTransform ignores the supplied
  // matrix and just echoes back whatever x/y was set on the point, so
  // toWallLocalMm resolves to {xMm: clientX, yMm: wallHeightMm - clientY}.
  (SVGSVGElement.prototype as unknown as { createSVGPoint: () => unknown }).createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform() {
      return { x: (this as { x: number }).x, y: (this as { y: number }).y };
    }
  });
  (SVGSVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({
    inverse: () => ({})
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState(initialStoreState, true);
});

function setupWall(wallObjects: WallObject[]) {
  const project = createSampleProject();
  const wall = getWallsWithGeometry(project.floor.rooms[0].room)[0];
  const withObjects = { ...project, wallObjects };
  useAppStore.setState({ project: withObjects });
  return { project: withObjects, wall };
}

describe("Elevation dimension lines and marquee include cases and wall text", () => {
  it("draws a margin dimension line for a lone selected wall case", () => {
    const { wall } = setupWall([]);
    const displayCase = createWallCase(wall.id, wall.lengthMm / 2);
    useAppStore.setState((state) => ({
      project: { ...state.project!, wallObjects: [displayCase] }
    }));

    const { container } = render(
      <TooltipProvider>
        <ElevationView
          centerlineMm={inchesCenterline()}
          gridPrecisionFloorMm={null}
          gridVisible={false}
          selectedObjectIds={[displayCase.id]}
          snapToGrid={false}
          unit="ft"
          wallHeightMm={wall.heightMm}
          wallId={wall.id}
          wallLengthMm={wall.lengthMm}
          wallName={wall.name}
          viewport={FIT_VIEWPORT}
          onViewportChange={() => {}}
        />
      </TooltipProvider>
    );

    expect(container.querySelectorAll(".dimension-line").length).toBeGreaterThan(0);
  });

  it("draws a margin dimension line for a lone selected wall text", () => {
    const { wall } = setupWall([]);
    const wallText = createWallTextPlacement(wall.id, wall.lengthMm / 2, inchesCenterline());
    useAppStore.setState((state) => ({
      project: { ...state.project!, wallObjects: [wallText] }
    }));

    const { container } = render(
      <TooltipProvider>
        <ElevationView
          centerlineMm={inchesCenterline()}
          gridPrecisionFloorMm={null}
          gridVisible={false}
          selectedObjectIds={[wallText.id]}
          snapToGrid={false}
          unit="ft"
          wallHeightMm={wall.heightMm}
          wallId={wall.id}
          wallLengthMm={wall.lengthMm}
          wallName={wall.name}
          viewport={FIT_VIEWPORT}
          onViewportChange={() => {}}
        />
      </TooltipProvider>
    );

    expect(container.querySelectorAll(".dimension-line").length).toBeGreaterThan(0);
  });

  it("picks up a wall case in a marquee rubber-band selection", () => {
    const { wall } = setupWall([]);
    // Centered near the wall's start so the marquee doesn't need to sweep far.
    const displayCase = createWallCase(wall.id, 1000);
    useAppStore.setState((state) => ({
      project: { ...state.project!, wallObjects: [displayCase] }
    }));

    const onMarqueeSelect = vi.fn();
    const { container } = render(
      <TooltipProvider>
        <ElevationView
          centerlineMm={inchesCenterline()}
          gridPrecisionFloorMm={null}
          gridVisible={false}
          onMarqueeSelect={onMarqueeSelect}
          snapToGrid={false}
          unit="ft"
          wallHeightMm={wall.heightMm}
          wallId={wall.id}
          wallLengthMm={wall.lengthMm}
          wallName={wall.name}
          viewport={FIT_VIEWPORT}
          onViewportChange={() => {}}
        />
      </TooltipProvider>
    );

    const svg = container.querySelector("svg.elevation-svg")!;
    // The default wall case spans xMm [250, 1750] at yMm [860, 1040] (waist
    // height ± half the box thickness). toWallLocalMm maps clientY to
    // wallHeightMm - yMm, so a lower clientY is a HIGHER wall-local point.
    const startClientY = wall.heightMm - 1100;
    const endClientY = wall.heightMm - 800;
    fireEvent.pointerDown(svg, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 0,
      clientY: startClientY
    });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 2000,
      clientY: endClientY
    });
    fireEvent.pointerUp(window, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 2000,
      clientY: endClientY
    });

    expect(onMarqueeSelect).toHaveBeenCalled();
    const [ids] = onMarqueeSelect.mock.calls[0];
    expect(ids).toContain(displayCase.id);
  });
});

function inchesCenterline() {
  return createSampleProject().defaultCenterlineHeightMm;
}
