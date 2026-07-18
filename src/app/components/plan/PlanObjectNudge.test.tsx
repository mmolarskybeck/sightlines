import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ArtworkFloorObject,
  type Project,
  type WallObject
} from "../../../domain/project";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { FIT_VIEWPORT } from "../../../domain/viewport/viewport2d";
import { useAppStore } from "../../store";
import { TooltipProvider } from "../ui/tooltip";
import { PlanView } from "./PlanView";

class MockResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 1000, height: 800 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  unobserve() {}
  disconnect() {}
}

// A wall-north artwork (that wall runs +x from the origin, so ArrowRight travels
// along it) and a floor artwork out in the room.
const wallArtwork: WallObject = {
  id: "wall-obj-1",
  kind: "artwork",
  artworkId: "art-1",
  wallId: "wall-north",
  xMm: 1000,
  yMm: 1450,
  widthMm: 400,
  heightMm: 500
};

const floorArtwork: ArtworkFloorObject = {
  id: "floor-obj-1",
  kind: "artwork",
  artworkId: "art-2",
  xMm: 2000,
  yMm: 1000,
  widthMm: 400,
  depthMm: 400,
  rotationDeg: 0,
  heightMm: 500,
  wallYMm: 1450
};

function seedProject(overrides: Partial<Project> = {}): Project {
  return {
    ...createSampleProject(),
    wallObjects: [wallArtwork],
    floorObjects: [floorArtwork],
    ...overrides
  };
}

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
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
  cleanup();
  vi.unstubAllGlobals();
  useAppStore.setState(initialStoreState, true);
});

type PlanViewProps = Parameters<typeof PlanView>[0];

function renderPlan(props: {
  selectedObjectIds?: string[];
  selectedFreestandingWallId?: string | null;
  activeTool?: PlanViewProps["activeTool"];
}) {
  const onCommitPlanMove = vi.fn<NonNullable<PlanViewProps["onCommitPlanMove"]>>();
  const onCommitPlanMoveGroup =
    vi.fn<NonNullable<PlanViewProps["onCommitPlanMoveGroup"]>>();
  const { container } = render(
    <TooltipProvider>
      <input data-testid="text-field" />
      <PlanView
        activeTool={props.activeTool ?? null}
        gridPrecisionFloorMm={null}
        gridVisible={false}
        selectedWallId={null}
        selectedObjectIds={props.selectedObjectIds ?? []}
        selectedFreestandingWallId={props.selectedFreestandingWallId ?? null}
        snapToGrid={false}
        viewport={FIT_VIEWPORT}
        onCommitPlanMove={onCommitPlanMove}
        onCommitPlanMoveGroup={onCommitPlanMoveGroup}
        onToolChange={() => {}}
        onViewportChange={() => {}}
      />
    </TooltipProvider>
  );
  const svg = container.querySelector("svg.plan-svg")!;
  return { svg, container, onCommitPlanMove, onCommitPlanMoveGroup };
}

describe("PlanView placed-object keyboard nudge", () => {
  it("slides a single selected wall object along its wall via onCommitPlanMove", () => {
    useAppStore.setState({ project: seedProject() });
    const { svg, onCommitPlanMove } = renderPlan({
      selectedObjectIds: [wallArtwork.id]
    });

    fireEvent.keyDown(svg, { key: "ArrowRight" });

    // Imperial off-grid step is 12.7mm (½″); wall-north runs +x from the origin.
    expect(onCommitPlanMove).toHaveBeenCalledTimes(1);
    const [objectId, placement] = onCommitPlanMove.mock.calls[0];
    expect(objectId).toBe(wallArtwork.id);
    if (placement.anchor !== "wall") throw new Error("expected a wall placement");
    expect(placement.wallId).toBe("wall-north");
    expect(placement.xMm).toBeCloseTo(1012.7, 1);
  });

  it("keeps a wall object on its wall when a perpendicular arrow is pressed", () => {
    useAppStore.setState({ project: seedProject() });
    const { svg, onCommitPlanMove } = renderPlan({
      selectedObjectIds: [wallArtwork.id]
    });

    fireEvent.keyDown(svg, { key: "ArrowDown" });

    const [, placement] = onCommitPlanMove.mock.calls[0];
    if (placement.anchor !== "wall") throw new Error("expected a wall placement");
    expect(placement.wallId).toBe("wall-north");
    expect(placement.xMm).toBeCloseTo(wallArtwork.xMm, 1);
  });

  it("translates a single selected floor object freely via onCommitPlanMove", () => {
    useAppStore.setState({ project: seedProject() });
    const { svg, onCommitPlanMove } = renderPlan({
      selectedObjectIds: [floorArtwork.id]
    });

    fireEvent.keyDown(svg, { key: "ArrowDown" });

    const [objectId, placement] = onCommitPlanMove.mock.calls[0];
    expect(objectId).toBe(floorArtwork.id);
    if (placement.anchor !== "floor") throw new Error("expected a floor placement");
    expect(placement.xMm).toBeCloseTo(floorArtwork.xMm, 1);
    // Plan y grows downward, so ArrowDown adds a +12.7mm step.
    expect(placement.yMm).toBeCloseTo(floorArtwork.yMm + 12.7, 1);
  });

  it("rigidly translates a multi-selection via onCommitPlanMoveGroup", () => {
    useAppStore.setState({ project: seedProject() });
    const { svg, onCommitPlanMove, onCommitPlanMoveGroup } = renderPlan({
      selectedObjectIds: [wallArtwork.id, floorArtwork.id]
    });

    fireEvent.keyDown(svg, { key: "ArrowRight" });

    expect(onCommitPlanMove).not.toHaveBeenCalled();
    expect(onCommitPlanMoveGroup).toHaveBeenCalledTimes(1);
    const [moves] = onCommitPlanMoveGroup.mock.calls[0];
    const wallMove = moves.find((move) => move.id === wallArtwork.id);
    const floorMove = moves.find((move) => move.id === floorArtwork.id);
    if (!wallMove || !floorMove) throw new Error("expected a move per member");
    // Wall member reprojects onto its wall (wall-local x, no yMm); floor member
    // carries a full center.
    expect(wallMove.xMm).toBeCloseTo(wallArtwork.xMm + 12.7, 1);
    expect(wallMove.yMm).toBeUndefined();
    expect(floorMove.xMm).toBeCloseTo(floorArtwork.xMm + 12.7, 1);
    expect(floorMove.yMm).toBeCloseTo(floorArtwork.yMm, 1);
  });

  it("ignores arrows from an editable field", () => {
    useAppStore.setState({ project: seedProject() });
    const { container, onCommitPlanMove } = renderPlan({
      selectedObjectIds: [wallArtwork.id]
    });

    const input = container.querySelector('[data-testid="text-field"]')!;
    fireEvent.keyDown(input, { key: "ArrowRight" });

    expect(onCommitPlanMove).not.toHaveBeenCalled();
  });

  it("ignores arrows chorded with meta/ctrl", () => {
    useAppStore.setState({ project: seedProject() });
    const { svg, onCommitPlanMove } = renderPlan({
      selectedObjectIds: [wallArtwork.id]
    });

    fireEvent.keyDown(svg, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(svg, { key: "ArrowRight", ctrlKey: true });

    expect(onCommitPlanMove).not.toHaveBeenCalled();
  });

  it("stands down while a plan interaction is active (armed tool)", () => {
    useAppStore.setState({ project: seedProject() });
    const { svg, onCommitPlanMove } = renderPlan({
      selectedObjectIds: [wallArtwork.id],
      activeTool: "door"
    });

    fireEvent.keyDown(svg, { key: "ArrowRight" });

    expect(onCommitPlanMove).not.toHaveBeenCalled();
  });

  it("yields to the partition nudge when a freestanding wall is also selected", () => {
    useAppStore.setState({ project: seedProject() });
    const { svg, onCommitPlanMove, onCommitPlanMoveGroup } = renderPlan({
      selectedObjectIds: [wallArtwork.id],
      selectedFreestandingWallId: "some-partition"
    });

    fireEvent.keyDown(svg, { key: "ArrowRight" });

    expect(onCommitPlanMove).not.toHaveBeenCalled();
    expect(onCommitPlanMoveGroup).not.toHaveBeenCalled();
  });
});
