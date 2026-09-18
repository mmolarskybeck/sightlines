import type { ComponentProps } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ElevationShelf } from "./ElevationShelf";

afterEach(cleanup);

// The slab's "a work is landing on me right now" state. The class is what the
// petrol wash hangs off (.elevation-shelf.snap-target .shelf-slab), and
// ElevationView derives the flag from the winning shelf-top guide — so the
// mapping from flag to class is the seam worth pinning here; the derivation
// itself is a drag, covered in e2e/shelf-snap.spec.ts.
function renderShelf(overrides: Partial<ComponentProps<typeof ElevationShelf>> = {}) {
  const props: ComponentProps<typeof ElevationShelf> = {
    center: { xMm: 1500, yMm: 1180 },
    size: { widthMm: 1200, heightMm: 40 },
    wallHeightMm: 3000,
    ...overrides
  };
  return render(
    <svg>
      <ElevationShelf {...props} />
    </svg>
  );
}

describe("ElevationShelf — snap-target state", () => {
  it("stays plain when nothing is being seated on it", () => {
    const { container } = renderShelf();
    expect(container.querySelector(".elevation-shelf.snap-target")).toBeNull();
    expect(container.querySelector(".shelf-slab")).not.toBeNull();
  });

  it("marks the slab while a work is captured on its top face", () => {
    const { container } = renderShelf({ isSnapTarget: true });
    expect(container.querySelector(".elevation-shelf.snap-target .shelf-slab")).not.toBeNull();
  });

  it("keeps the snap-target state independent of selection", () => {
    const { container } = renderShelf({ isSnapTarget: true, isSelected: true });
    const group = container.querySelector(".elevation-shelf");
    expect(group?.classList.contains("snap-target")).toBe(true);
    expect(group?.classList.contains("selected")).toBe(true);
  });
});
