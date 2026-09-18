import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SetNorthWallDialog,
  type SetNorthWallRequest
} from "./SetNorthWallDialog";

afterEach(cleanup);

function ready(over: Partial<SetNorthWallRequest> = {}): SetNorthWallRequest {
  return {
    roomId: "room-a",
    wallId: "room-a-wall-east",
    wallName: "East wall",
    roomName: "East Gallery",
    customNames: ["Entrance wall"],
    ...over
  };
}

function renderDialog(request: SetNorthWallRequest | null) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <SetNorthWallDialog
      request={request}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
    />
  );
  return { onConfirm, onOpenChange };
}

describe("SetNorthWallDialog", () => {
  it("renders nothing without a request", () => {
    renderDialog(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // The point of the confirm: all four names go, not just the one clicked.
  it("names the wall, the room, the scope of the change, and undo", () => {
    renderDialog(ready());

    expect(screen.getByText("Use East wall as North wall?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This will rename all four walls in East Gallery to North, East, South and West. Undo will revert this."
      )
    ).toBeInTheDocument();
  });

  it("quotes the one custom name that will be replaced", () => {
    renderDialog(ready());
    expect(screen.getByText("“Entrance wall” will be replaced.")).toBeInTheDocument();
  });

  it("lists several custom names in full", () => {
    renderDialog(ready({ customNames: ["Entrance wall", "Window wall", "Back wall"] }));

    expect(
      screen.getByText(
        "“Entrance wall”, “Window wall” and “Back wall” will be replaced."
      )
    ).toBeInTheDocument();
  });

  it("confirms once, and cancel only closes", () => {
    const { onConfirm, onOpenChange } = renderDialog(ready());

    fireEvent.click(screen.getByRole("button", { name: "Relabel walls" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
