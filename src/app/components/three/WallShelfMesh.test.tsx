import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WallShelf3d } from "../../../domain/geometry/scene3d";

// The two claims this mesh makes, and the second is the load-bearing one:
// a shelf is SELECTABLE in 3D and deliberately NOT DRAGGABLE this round (USER
// DECISION) — a shelf carries the works standing on it on every other move
// path, and 3D's drag machinery moves one object at a time. That absence is
// invisible in a screenshot and easy to "fix" by copying WallCaseMesh, so it is
// asserted here: the drag context is never read and the shared pointerdown
// handler is never built.
//
// R3F intrinsics (<group>, <mesh>, <boxGeometry>) render as inert unknown
// elements in jsdom, which is all this needs — the wiring, not the pixels.
const { makeClickToSelect, useThreeObjectDrag, objectDragPointerDown } = vi.hoisted(
  () => ({
    makeClickToSelect: vi.fn(() => vi.fn()),
    useThreeObjectDrag: vi.fn(() => ({ begin: vi.fn() })),
    objectDragPointerDown: vi.fn(() => vi.fn())
  })
);

vi.mock("./selectOnClick", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./selectOnClick")>()),
  makeClickToSelect
}));

vi.mock("./objectDragContext", () => ({ useThreeObjectDrag, objectDragPointerDown }));

const { WallShelfMesh } = await import("./WallShelfMesh");

const shelf: WallShelf3d = {
  objectId: "shelf-1",
  xMm: 2000,
  yMm: 1180,
  widthMm: 1200,
  heightMm: 40,
  depthMm: 300
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WallShelfMesh", () => {
  it("renders one slab mesh for the shelf", () => {
    const { container } = render(
      <WallShelfMesh shelf={shelf} isSelected={false} onSelect={() => {}} />
    );

    expect(container.querySelectorAll("mesh")).toHaveLength(1);
    expect(container.querySelectorAll("boxGeometry")).toHaveLength(1);
  });

  it("wires click-to-select for its own object id", () => {
    const onSelect = vi.fn();
    render(<WallShelfMesh shelf={shelf} isSelected={false} onSelect={onSelect} />);

    expect(makeClickToSelect).toHaveBeenCalledWith(shelf.objectId, onSelect);
  });

  it("installs NO drag handler", () => {
    render(<WallShelfMesh shelf={shelf} isSelected={false} onSelect={() => {}} />);

    expect(useThreeObjectDrag).not.toHaveBeenCalled();
    expect(objectDragPointerDown).not.toHaveBeenCalled();
  });

  it("draws a selection outline only when selected", () => {
    const { container: unselected } = render(
      <WallShelfMesh shelf={shelf} isSelected={false} onSelect={() => {}} />
    );
    // SelectionBoxOutline draws the ring as lineSegments, never as meshes.
    expect(unselected.querySelectorAll("lineSegments")).toHaveLength(0);

    const { container: selected } = render(
      <WallShelfMesh shelf={shelf} isSelected onSelect={() => {}} />
    );

    expect(selected.querySelectorAll("lineSegments").length).toBeGreaterThan(0);
  });

  it("wears the same outline while a dragged work is captured on it", () => {
    // A SURFACE ANNOUNCES ITSELF: the slab a 3D drop or drag would seat a work
    // on lights up for the length of the gesture, without being selected.
    const { container } = render(
      <WallShelfMesh shelf={shelf} isSelected={false} isSnapTarget onSelect={() => {}} />
    );

    expect(container.querySelectorAll("lineSegments").length).toBeGreaterThan(0);
  });
});
