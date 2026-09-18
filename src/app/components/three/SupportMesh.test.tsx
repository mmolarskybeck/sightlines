import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";

// Mirrors WallShelfMesh.test.tsx: SupportMesh's two claims (selectable,
// draggable) are invisible in a screenshot, so both are asserted through the
// shared wiring useSelectableFloorObject installs underneath it — the same
// pattern FloorCaseMesh uses for its own multi-mesh assembly.
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

const { SupportMesh } = await import("./SupportMesh");

function makeSupport(overrides: Partial<FloorObject3d> = {}): FloorObject3d {
  return {
    objectId: "support-1",
    kind: "support",
    supportKind: "pedestal",
    xMm: 2000,
    yMm: 1500,
    widthMm: 400,
    depthMm: 400,
    heightMm: 1000,
    rotationDeg: 0,
    ...overrides
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SupportMesh", () => {
  it("renders one body mesh when there is no bonnet", () => {
    const { container } = render(
      <SupportMesh object={makeSupport()} isSelected={false} onSelect={() => {}} />
    );

    expect(container.querySelectorAll("mesh")).toHaveLength(1);
    expect(container.querySelectorAll("boxGeometry")).toHaveLength(1);
  });

  it("adds a second mesh for the plexi bonnet when bonnetHeightMm is present", () => {
    const { container } = render(
      <SupportMesh
        object={makeSupport({ bonnetHeightMm: 300 })}
        isSelected={false}
        onSelect={() => {}}
      />
    );

    expect(container.querySelectorAll("mesh")).toHaveLength(2);
    expect(container.querySelectorAll("boxGeometry")).toHaveLength(2);
  });

  it("wires click-to-select for its own object id", () => {
    const onSelect = vi.fn();
    render(<SupportMesh object={makeSupport()} isSelected={false} onSelect={onSelect} />);

    expect(makeClickToSelect).toHaveBeenCalledWith("support-1", onSelect);
  });

  it("arms the shared object drag on the shared floor-object wiring", () => {
    render(<SupportMesh object={makeSupport()} isSelected={false} onSelect={() => {}} />);

    expect(useThreeObjectDrag).toHaveBeenCalled();
    // Built for the SUPPORT's own object id — grabbing any part of the
    // installation must move the pedestal, not something else.
    expect(objectDragPointerDown).toHaveBeenCalledWith(expect.anything(), "support-1");
  });

  it("draws a selection outline only when selected", () => {
    const { container: unselected } = render(
      <SupportMesh object={makeSupport()} isSelected={false} onSelect={() => {}} />
    );
    // SelectionBoxOutline draws the ring as lineSegments, never as meshes.
    expect(unselected.querySelectorAll("lineSegments")).toHaveLength(0);

    const { container: selected } = render(
      <SupportMesh object={makeSupport()} isSelected onSelect={() => {}} />
    );

    expect(selected.querySelectorAll("lineSegments").length).toBeGreaterThan(0);
  });

  it("wears the same outline while a dragged work is captured on it", () => {
    // A SURFACE ANNOUNCES ITSELF: the support a 3D drop or drag would seat a
    // work on lights up for the length of the gesture, without being
    // selected.
    const { container } = render(
      <SupportMesh object={makeSupport()} isSelected={false} isSnapTarget onSelect={() => {}} />
    );

    expect(container.querySelectorAll("lineSegments").length).toBeGreaterThan(0);
  });
});
