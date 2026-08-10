import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import {
  FloorObjectRotateHandle,
  floorObjectFrontNormal,
  normalizeRotationDeg,
  rotationDegForPointer,
  ROTATE_SNAP_DEG,
  snapRotationDeg
} from "./FloorObjectRotateHandle";

afterEach(cleanup);

// The projection-board case: a floor artwork whose depthMm is the board's real
// ~18mm thickness, hung at 45°.
const boardRect: PlanRect = {
  centerXMm: 3000,
  centerYMm: 2000,
  widthMm: 2400,
  depthMm: 18,
  angleDeg: 0
};

describe("floorObjectFrontNormal", () => {
  // FRONT-FACE CONVENTION: +depth = local +y = (-sin θ, cos θ). This is the
  // vector the 3D view and elevation ghost have to agree with.
  it("points along plan +y at rotation 0", () => {
    const normal = floorObjectFrontNormal(0);
    expect(normal.xMm).toBeCloseTo(0, 10);
    expect(normal.yMm).toBeCloseTo(1, 10);
  });

  it("points along plan -x at rotation 90 (positive rotation is clockwise on screen)", () => {
    const normal = floorObjectFrontNormal(90);
    expect(normal.xMm).toBeCloseTo(-1, 10);
    expect(normal.yMm).toBeCloseTo(0, 10);
  });

  it("is the left normal of the rect's own axis — the same viewer side offsetPlanRectToViewerSide uses", () => {
    for (const deg of [0, 17, 45, 123, 270]) {
      const rad = (deg * Math.PI) / 180;
      const normal = floorObjectFrontNormal(deg);
      expect(normal.xMm).toBeCloseTo(-Math.sin(rad), 10);
      expect(normal.yMm).toBeCloseTo(Math.cos(rad), 10);
    }
  });
});

describe("rotationDegForPointer", () => {
  const centerMm = { xMm: boardRect.centerXMm, yMm: boardRect.centerYMm };

  it("inverts floorObjectFrontNormal — the returned angle points the front at the pointer", () => {
    for (const deg of [0, 15, 45, 90, 200, 315]) {
      const normal = floorObjectFrontNormal(deg);
      const pointerMm = {
        xMm: centerMm.xMm + normal.xMm * 500,
        yMm: centerMm.yMm + normal.yMm * 500
      };
      expect(rotationDegForPointer(centerMm, pointerMm, 10)).toBeCloseTo(deg, 6);
    }
  });

  it("normalizes across the seam instead of returning a negative angle", () => {
    // Front pointing at -10° (equivalently 350°).
    const normal = floorObjectFrontNormal(350);
    const pointerMm = {
      xMm: centerMm.xMm + normal.xMm * 500,
      yMm: centerMm.yMm + normal.yMm * 500
    };
    expect(rotationDegForPointer(centerMm, pointerMm, 10)).toBeCloseTo(350, 6);
  });

  it("refuses to resolve an angle inside the dead zone, where the pointer has no bearing", () => {
    expect(rotationDegForPointer(centerMm, { ...centerMm }, 10)).toBeNull();
    expect(
      rotationDegForPointer(centerMm, { xMm: centerMm.xMm + 5, yMm: centerMm.yMm }, 10)
    ).toBeNull();
    expect(
      rotationDegForPointer(centerMm, { xMm: centerMm.xMm + 50, yMm: centerMm.yMm }, 10)
    ).not.toBeNull();
  });
});

describe("snapRotationDeg", () => {
  // The Snap toggle governs rotation the same way it governs every other plan
  // gesture; Alt/Option is the documented opt-in to unclean values.
  it("lands on 15° increments while Snap is on, which covers 45° and 90° too", () => {
    expect(ROTATE_SNAP_DEG).toBe(15);
    expect(snapRotationDeg(47.3, { snapToGrid: true, altKey: false })).toBe(45);
    expect(snapRotationDeg(88.2, { snapToGrid: true, altKey: false })).toBe(90);
    expect(snapRotationDeg(13.1, { snapToGrid: true, altKey: false })).toBe(15);
  });

  it("wraps a 360 snap back to 0 rather than storing an out-of-range angle", () => {
    expect(snapRotationDeg(356, { snapToGrid: true, altKey: false })).toBe(0);
  });

  it("free-rotates with Alt held, and whenever Snap is off", () => {
    expect(snapRotationDeg(47.34, { snapToGrid: true, altKey: true })).toBe(47.3);
    expect(snapRotationDeg(47.34, { snapToGrid: false, altKey: false })).toBe(47.3);
  });
});

describe("normalizeRotationDeg", () => {
  it("folds any angle into [0, 360)", () => {
    expect(normalizeRotationDeg(-10)).toBe(350);
    expect(normalizeRotationDeg(360)).toBe(0);
    expect(normalizeRotationDeg(725)).toBe(5);
  });
});

describe("FloorObjectRotateHandle rendering", () => {
  function renderHandle(planRect: PlanRect, handleSizeMm = 100) {
    return render(
      <svg>
        <FloorObjectRotateHandle
          handleSizeMm={handleSizeMm}
          isActive={false}
          planRect={planRect}
          onBeginDrag={() => {}}
        />
      </svg>
    );
  }

  it("stands the chip clear of the FRONT face, not the back one", () => {
    const { container } = renderHandle(boardRect);

    const stem = container.querySelector(".rotate-handle-stem")!;
    // Stem starts on the +depth face…
    expect(Number(stem.getAttribute("x1"))).toBeCloseTo(boardRect.centerXMm, 6);
    expect(Number(stem.getAttribute("y1"))).toBeCloseTo(
      boardRect.centerYMm + boardRect.depthMm / 2,
      6
    );
    // …and runs further out along +y, never back through the object.
    expect(Number(stem.getAttribute("y2"))).toBeGreaterThan(Number(stem.getAttribute("y1")));
    expect(Number(stem.getAttribute("x2"))).toBeCloseTo(boardRect.centerXMm, 6);
  });

  it("swings with rotationDeg so the handle always marks the front", () => {
    const { container } = renderHandle({ ...boardRect, angleDeg: 90 });

    const stem = container.querySelector(".rotate-handle-stem")!;
    // Front normal at 90° is (-1, 0): the handle moves to -x, level with center.
    expect(Number(stem.getAttribute("x2"))).toBeLessThan(boardRect.centerXMm);
    expect(Number(stem.getAttribute("y2"))).toBeCloseTo(boardRect.centerYMm, 6);
  });

  it("keeps the .resize-handle class PlanView's click suppression matches on", () => {
    const { container } = renderHandle(boardRect);

    const chips = container.querySelectorAll("rect.resize-handle.rotate-handle");
    // A padded transparent hit target behind the visible chip, same as the
    // room resize handles.
    expect(chips).toHaveLength(2);
    expect(container.querySelector(".resize-handle.rotate-handle.handle-hit")).not.toBeNull();
  });

  it("renders nothing without a live zoom, where a screen-constant size is meaningless", () => {
    const { container } = renderHandle(boardRect, 0);

    expect(container.querySelector(".rotate-handle-group")).toBeNull();
  });
});
