// Covers the checklist DROP path in elevation. The interesting case is a work
// whose library form is FLOOR (a depth-bearing object): elevation used to refuse
// it outright — no ghost, a no-drop cursor, and a release that committed
// nothing, with no explanation anywhere in the UI. That was reversed by USER
// DECISION alongside the plan-view policy (floatPolicyForKind): dropping onto
// the wall IS the statement that this thing hangs, and the deep-wall artwork
// path already supports it. What has to hold is that the refusal is gone in all
// three places it lived — the ghost, the drop effect, and the commit.
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { getWallsWithGeometry } from "../../../domain/geometry/walls";
import { FIT_VIEWPORT } from "../../../domain/viewport/viewport2d";
import type { Artwork } from "../../../domain/project";
import { ARTWORK_DRAG_MIME } from "../library/artworkDragSession";
import { useAppStore } from "../../store";
import { TooltipProvider } from "../ui/tooltip";
import { ElevationView } from "./ElevationView";

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

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  // Identity client→SVG-userspace mapping, so a drop's client coordinates reach
  // toWallLocalMm as wall-local mm.
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

// A depth-bearing work with no explicit placementForm: effectivePlacementForm
// derives "floor" from depthMm alone, which is exactly the record shape the old
// guard rejected.
const FLOOR_FORM_WORK: Artwork = {
  id: "art-floor",
  schemaVersion: 1,
  title: "Plinth piece",
  dimensions: { widthMm: 600, heightMm: 900, depthMm: 400, status: "known" },
  metadata: {}
};

function setup() {
  const project = createSampleProject();
  useAppStore.setState({ project });
  const wall = getWallsWithGeometry(project.floor.rooms[0]!.room)[0]!;
  const onPlaceArtwork = vi.fn();
  const view = render(
    <TooltipProvider>
      <ElevationView
        artworksById={new Map([[FLOOR_FORM_WORK.id, FLOOR_FORM_WORK]])}
        centerlineMm={project.defaultCenterlineHeightMm}
        draggingArtworkId={FLOOR_FORM_WORK.id}
        gridPrecisionFloorMm={null}
        gridVisible={false}
        onPlaceArtwork={onPlaceArtwork}
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
  return { ...view, wall, onPlaceArtwork };
}

// A minimal DataTransfer stand-in: jsdom has no real one, and the handlers only
// read `types` / `getData` and write `dropEffect`.
function dataTransfer(artworkId: string) {
  return {
    types: [ARTWORK_DRAG_MIME],
    dropEffect: "",
    getData: (type: string) => (type === ARTWORK_DRAG_MIME ? artworkId : "")
  };
}

describe("elevation checklist drop — a floor-form work hangs where it is dropped", () => {
  it("paints a ghost and offers the copy effect while dragging over the wall", () => {
    const { container } = setup();
    const surface = container.querySelector(".drawing-surface")!;
    const transfer = dataTransfer(FLOOR_FORM_WORK.id);

    fireEvent.dragOver(surface, { dataTransfer: transfer, clientX: 400, clientY: 300 });

    // "copy", not the old "none": the drop is offered, not refused.
    expect(transfer.dropEffect).toBe("copy");
    expect(container.querySelector(".elevation-artwork.ghost")).toBeTruthy();
  });

  it("commits through onPlaceArtwork on release", () => {
    const { container, wall, onPlaceArtwork } = setup();
    const surface = container.querySelector(".drawing-surface")!;

    fireEvent.dragOver(surface, {
      dataTransfer: dataTransfer(FLOOR_FORM_WORK.id),
      clientX: 400,
      clientY: 300
    });
    fireEvent.drop(surface, {
      dataTransfer: dataTransfer(FLOOR_FORM_WORK.id),
      clientX: 400,
      clientY: 300
    });

    expect(onPlaceArtwork).toHaveBeenCalledTimes(1);
    const [artworkId, wallId, xMm, yMm] = onPlaceArtwork.mock.calls[0]!;
    expect(artworkId).toBe(FLOOR_FORM_WORK.id);
    expect(wallId).toBe(wall.id);
    // It lands ON the wall — a real wall-local position, not the floor line.
    expect(xMm).toBeGreaterThan(0);
    expect(yMm).toBeGreaterThan(0);
  });
});
