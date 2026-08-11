import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElevationEmptyState } from "./ElevationEmptyState";
import { TooltipProvider } from "../ui/tooltip";
import type { WallSwitcherEntry } from "./WallSwitcher";

const walls: WallSwitcherEntry[] = [
  {
    id: "gallery-1-north",
    name: "North wall",
    roomId: "gallery-1",
    roomName: "Gallery 1",
    kind: "perimeter",
    lengthMm: 6096,
    heightMm: 3657.6,
    isOpenSide: true
  },
  {
    id: "gallery-1-east",
    name: "East wall",
    roomId: "gallery-1",
    roomName: "Gallery 1",
    kind: "perimeter",
    lengthMm: 4267.2,
    heightMm: 3657.6
  }
];

afterEach(cleanup);

function renderEmptyState(props: Parameters<typeof ElevationEmptyState>[0]) {
  render(
    <TooltipProvider>
      <ElevationEmptyState {...props} />
    </TooltipProvider>
  );
}

describe("ElevationEmptyState wall switcher chip", () => {
  it("keeps the switcher on an open wall so other elevations stay reachable", () => {
    const onSelectWall = vi.fn();
    renderEmptyState({
      hasRooms: true,
      openWallName: "North wall",
      switcher: {
        walls,
        currentWallId: "gallery-1-north",
        onSelectWall,
        unit: "in"
      }
    });

    expect(
      screen.getByRole("button", { name: "Change wall: North wall (open), Gallery 1" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous wall" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next wall" })).toBeInTheDocument();
    // The chip has to sit on the empty state exactly where it sits on a drawn
    // elevation, which is what the absolutely-positioned `.surface-label` does.
    expect(document.querySelector(".surface-label-switcher")).not.toBeNull();
  });

  it("steps to the next wall from the empty state", () => {
    const onSelectWall = vi.fn();
    renderEmptyState({
      hasRooms: true,
      openWallName: "North wall",
      switcher: {
        walls,
        currentWallId: "gallery-1-north",
        onSelectWall,
        unit: "in"
      }
    });

    screen.getByRole("button", { name: "Next wall" }).click();
    expect(onSelectWall).toHaveBeenCalledWith("gallery-1-east");
  });

  it("omits the switcher when a wall is merely unselected", () => {
    renderEmptyState({ hasRooms: true });

    expect(screen.queryByRole("button", { name: /Change wall/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next wall" })).toBeNull();
    expect(document.querySelector(".surface-label-switcher")).toBeNull();
    expect(
      screen.getByText("Select a wall from the Gallery list to see its elevation.")
    ).toBeInTheDocument();
  });

  it("omits the switcher when there are no rooms at all", () => {
    renderEmptyState({ hasRooms: false });

    expect(screen.queryByRole("button", { name: /Change wall/ })).toBeNull();
    expect(document.querySelector(".surface-label-switcher")).toBeNull();
    expect(
      screen.getByText("Add a room, then select a wall to see its elevation.")
    ).toBeInTheDocument();
  });
});
