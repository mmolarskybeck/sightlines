import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RectangleRoomDimensions } from "../../domain/geometry/walls";
import { RoomInspector } from "./RoomInspector";

afterEach(cleanup);

const rectangleDimensions: RectangleRoomDimensions = {
  widthMm: 6000,
  depthMm: 4000,
  widthWallId: "wall-north",
  depthWallId: "wall-east"
};

function renderInspector(overrides: Partial<ComponentProps<typeof RoomInspector>> = {}) {
  const props: ComponentProps<typeof RoomInspector> = {
    artworkCount: 0,
    objectCount: 0,
    rectangleDimensions: null,
    reshapeActive: false,
    roomHeightMm: 2400,
    roomName: "Gallery",
    unit: "cm",
    wallCount: 6,
    onCommitDepth: vi.fn(),
    onCommitHeight: vi.fn(),
    onCommitWidth: vi.fn(),
    onToggleReshape: vi.fn(),
    ...overrides
  };
  return { props, ...render(<RoomInspector {...props} />) };
}

describe("RoomInspector Edit shape button", () => {
  it("renders the Edit shape button for a non-rectangular room", () => {
    renderInspector({ rectangleDimensions: null });
    expect(screen.getByRole("button", { name: "Edit shape" })).toBeTruthy();
  });

  it("renders the Edit shape button for a rectangular room too", () => {
    renderInspector({ rectangleDimensions });
    expect(screen.getByRole("button", { name: "Edit shape" })).toBeTruthy();
  });

  it("labels the button Done editing shape while armed", () => {
    renderInspector({ reshapeActive: true });
    expect(screen.getByRole("button", { name: "Done editing shape" })).toBeTruthy();
  });

  it("teaches wall-slide when not armed, corner editing when armed", () => {
    const { rerender, props } = renderInspector({ reshapeActive: false });
    expect(
      screen.getByText(/Drag a wall's handle to move that wall/)
    ).toBeTruthy();
    // The pre-standardization hint is gone.
    expect(screen.queryByText(/Drag a corner or a wall to reshape/)).toBeNull();

    rerender(<RoomInspector {...props} reshapeActive />);
    expect(screen.getByText(/Drag corners to reshape\./)).toBeTruthy();
  });
});
