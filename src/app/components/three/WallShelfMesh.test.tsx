import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WallShelf3d } from "../../../domain/geometry/scene3d";

// The two claims this mesh makes: a shelf is SELECTABLE in 3D, and it is
// DRAGGABLE through the same shared pointerdown handler every other draggable
// mesh installs (ThreeDView turns that press into an assembly drag that carries
// the slab's riders). Both are invisible in a screenshot, so both are asserted
// on the wiring here.
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

  it("arms the shared object drag on its slab", () => {
    const { container } = render(
      <WallShelfMesh shelf={shelf} isSelected={false} onSelect={() => {}} />
    );

    expect(useThreeObjectDrag).toHaveBeenCalled();
    // Built for the SHELF's own object id — a slab that armed a drag on
    // anything else would move the wrong thing.
    expect(objectDragPointerDown).toHaveBeenCalledWith(
      expect.anything(),
      shelf.objectId
    );
    // jsdom renders R3F intrinsics as inert unknown elements and drops their
    // function props, so the handler's PRESENCE is asserted through the mock
    // above; this only pins that there is still exactly one slab to hang it on.
    expect(container.querySelectorAll("mesh")).toHaveLength(1);
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
