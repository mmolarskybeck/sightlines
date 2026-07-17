import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WallSwitcher, type WallSwitcherEntry } from "./WallSwitcher";

const walls: WallSwitcherEntry[] = [
  {
    id: "gallery-1-north",
    name: "North wall",
    roomId: "gallery-1",
    roomName: "Gallery 1",
    kind: "perimeter",
    lengthMm: 6096,
    heightMm: 3657.6
  },
  {
    id: "gallery-1-east",
    name: "East wall",
    roomId: "gallery-1",
    roomName: "Gallery 1",
    kind: "perimeter",
    lengthMm: 4267.2,
    heightMm: 3657.6
  },
  {
    id: "gallery-2-south",
    name: "South wall",
    roomId: "gallery-2",
    roomName: "Gallery 2",
    kind: "perimeter",
    lengthMm: 6096,
    heightMm: 3657.6
  },
  {
    id: "gallery-2-partition-a",
    name: "Divider · Side A",
    roomId: "gallery-2",
    roomName: "Gallery 2",
    kind: "partition-face",
    lengthMm: 2438.4,
    heightMm: 3048
  }
];

afterEach(cleanup);

function renderSwitcher(initialWallId = walls[1].id) {
  const onSelectWall = vi.fn();

  function Harness() {
    const [currentWallId, setCurrentWallId] = React.useState(initialWallId);
    return (
      <WallSwitcher
        walls={walls}
        currentWallId={currentWallId}
        unit="in"
        onSelectWall={(wallId) => {
          onSelectWall(wallId);
          setCurrentWallId(wallId);
        }}
      />
    );
  }

  render(<Harness />);
  return { onSelectWall };
}

async function openMenu() {
  const trigger = screen.getByRole("button", { name: /Change wall/ });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
  return await screen.findByRole("menu");
}

describe("WallSwitcher keyboard navigation", () => {
  it("moves right from Rooms to the checked elevation and left back to the current room", async () => {
    renderSwitcher();
    const menu = await openMenu();
    expect(menu).toHaveAttribute("data-owns-arrow-keys");
    const rooms = menu.querySelector<HTMLElement>('[data-wall-switcher-column="rooms"]');
    const elevations = menu.querySelector<HTMLElement>(
      '[data-wall-switcher-column="elevations"]'
    );
    expect(rooms).not.toBeNull();
    expect(elevations).not.toBeNull();

    const currentRoom = within(rooms!).getByRole("menuitem", { name: /Gallery 1/ });
    const checkedElevation = within(elevations!).getByRole("menuitemradio", {
      name: /East wall/
    });
    currentRoom.focus();

    fireEvent.keyDown(currentRoom, { key: "ArrowRight" });
    expect(checkedElevation).toHaveFocus();

    fireEvent.keyDown(checkedElevation, { key: "ArrowLeft" });
    expect(currentRoom).toHaveFocus();
  });

  it("consumes outward horizontal arrows without moving focus or closing the menu", async () => {
    renderSwitcher();
    const menu = await openMenu();
    const rooms = menu.querySelector<HTMLElement>('[data-wall-switcher-column="rooms"]')!;
    const elevations = menu.querySelector<HTMLElement>(
      '[data-wall-switcher-column="elevations"]'
    )!;
    const currentRoom = within(rooms).getByRole("menuitem", { name: /Gallery 1/ });
    const checkedElevation = within(elevations).getByRole("menuitemradio", {
      name: /East wall/
    });

    currentRoom.focus();
    const leftWasNotPrevented = fireEvent.keyDown(currentRoom, { key: "ArrowLeft" });
    expect(leftWasNotPrevented).toBe(false);
    expect(currentRoom).toHaveFocus();
    expect(menu).toBeInTheDocument();

    checkedElevation.focus();
    const rightWasNotPrevented = fireEvent.keyDown(checkedElevation, { key: "ArrowRight" });
    expect(rightWasNotPrevented).toBe(false);
    expect(checkedElevation).toHaveFocus();
    expect(menu).toBeInTheDocument();
  });

  it("keeps focus in the menu when selecting a room, then enters that room's elevations", async () => {
    const { onSelectWall } = renderSwitcher();
    const menu = await openMenu();
    const rooms = menu.querySelector<HTMLElement>('[data-wall-switcher-column="rooms"]')!;
    const gallery2 = within(rooms).getByRole("menuitem", { name: /Gallery 2/ });
    gallery2.focus();

    fireEvent.keyDown(gallery2, { key: "Enter" });

    await waitFor(() => expect(onSelectWall).toHaveBeenCalledWith("gallery-2-south"));
    expect(gallery2).toHaveFocus();
    expect(menu).toBeInTheDocument();

    fireEvent.keyDown(gallery2, { key: "ArrowRight" });
    expect(
      within(menu).getByRole("menuitemradio", { name: /South wall/ })
    ).toHaveFocus();
  });

  it("reveals and enters a focused non-current room when moving right", async () => {
    const { onSelectWall } = renderSwitcher();
    const menu = await openMenu();
    const rooms = menu.querySelector<HTMLElement>('[data-wall-switcher-column="rooms"]')!;
    const gallery2 = within(rooms).getByRole("menuitem", { name: /Gallery 2/ });
    gallery2.focus();

    fireEvent.keyDown(gallery2, { key: "ArrowRight" });

    await waitFor(() => expect(onSelectWall).toHaveBeenCalledWith("gallery-2-south"));
    await waitFor(() =>
      expect(within(menu).getByRole("menuitemradio", { name: /South wall/ })).toHaveFocus()
    );
    expect(menu).toBeInTheDocument();
  });
});

describe("WallSwitcher accessible context", () => {
  it("names the trigger with the current wall and room and announces changes politely", async () => {
    const { onSelectWall } = renderSwitcher();
    const trigger = screen.getByRole("button", {
      name: "Change wall: East wall, Gallery 1"
    });

    const liveRegion = document.querySelector<HTMLElement>('[aria-live="polite"]');
    expect(liveRegion).toHaveAttribute("aria-atomic", "true");
    expect(liveRegion).toHaveTextContent("Now viewing East wall in Gallery 1");

    const menu = await openMenu();
    const gallery2 = within(menu).getByRole("menuitem", { name: /Gallery 2/ });
    fireEvent.keyDown(gallery2, { key: "Enter" });

    await waitFor(() => expect(onSelectWall).toHaveBeenCalledWith("gallery-2-south"));
    // Radix makes the trigger inert to accessibility APIs while its modal menu
    // is open, so assert its updated name through the persistent DOM node.
    expect(trigger).toHaveAttribute("aria-label", "Change wall: South wall, Gallery 2");
    expect(liveRegion).toHaveTextContent("Now viewing South wall in Gallery 2");
  });
});
