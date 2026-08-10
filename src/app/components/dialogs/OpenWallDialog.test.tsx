import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenWallRequest, WallContentsSummary } from "../../wallOpening";
import { OpenWallDialog } from "./OpenWallDialog";

afterEach(cleanup);

function summary(over: Partial<WallContentsSummary> = {}): WallContentsSummary {
  const base: WallContentsSummary = {
    artworks: 0,
    doors: 0,
    windows: 0,
    blockedZones: 0,
    wallTexts: 0,
    cases: 0,
    measurements: 0,
    isEmpty: true,
    ...over
  };
  base.isEmpty =
    base.artworks +
      base.doors +
      base.windows +
      base.blockedZones +
      base.wallTexts +
      base.cases +
      base.measurements ===
    0;
  return base;
}

function ready(over: Partial<OpenWallRequest> = {}): OpenWallRequest {
  return {
    wallId: "wall-north",
    wallName: "North wall",
    roomName: "East Gallery",
    summary: summary(),
    sharedRoomNames: [],
    willSplit: false,
    ...over
  };
}

function renderDialog(request: OpenWallRequest | null) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <OpenWallDialog request={request} onConfirm={onConfirm} onOpenChange={onOpenChange} />
  );
  return { onConfirm, onOpenChange };
}

describe("OpenWallDialog", () => {
  it("renders nothing without a request", () => {
    renderDialog(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names the wall and the room, and promises undo", () => {
    renderDialog(ready());

    expect(screen.getByText("Open North wall?")).toBeInTheDocument();
    expect(screen.getByText(/opens East Gallery on that side/)).toBeInTheDocument();
    expect(screen.getByText(/The floor and the room’s shape stay/)).toBeInTheDocument();
    expect(screen.getByText(/Undo brings it all back/)).toBeInTheDocument();
  });

  // The accuracy requirement: two fates, two verbs, never merged into one
  // count. A reader skimming must not think the artworks are being deleted.
  it("states unhang and delete as SEPARATE sentences", () => {
    renderDialog(ready({ summary: summary({ artworks: 2, doors: 1 }) }));

    expect(
      screen.getByText(/2 works hung here go back to the checklist, unplaced\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/1 door on this wall is deleted\./)).toBeInTheDocument();
    // The artwork count must not appear inside the deletion sentence.
    expect(screen.queryByText(/2 works.*are deleted/)).not.toBeInTheDocument();
  });

  it("uses singular phrasing for one work", () => {
    renderDialog(ready({ summary: summary({ artworks: 1 }) }));

    expect(
      screen.getByText(/1 work hung here goes back to the checklist, unplaced\./)
    ).toBeInTheDocument();
  });

  it("lists several fixture kinds naturally and discloses measurements", () => {
    renderDialog(
      ready({
        summary: summary({ doors: 1, windows: 2, wallTexts: 1, measurements: 1 })
      })
    );

    expect(
      screen.getByText(/1 door, 2 windows, 1 wall label, and 1 measurement on this wall are deleted\./)
    ).toBeInTheDocument();
  });

  it("says neither sentence for an empty wall", () => {
    renderDialog(ready());

    expect(screen.queryByText(/back to the checklist/)).not.toBeInTheDocument();
    expect(screen.queryByText(/is deleted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/are deleted/)).not.toBeInTheDocument();
  });

  it("warns when the wall is shared, naming the other room", () => {
    renderDialog(ready({ sharedRoomNames: ["West Gallery"] }));

    expect(
      screen.getByText(
        /shared with West Gallery — opening it opens both sides, creating an open connection between the rooms/
      )
    ).toBeInTheDocument();
  });

  it("omits the shared warning when the wall is exterior", () => {
    renderDialog(ready());
    expect(screen.queryByText(/shared with/)).not.toBeInTheDocument();
  });

  // The alcove case: the neighbour's wall runs past this one and gets cut, so
  // the copy must say so rather than implying a symmetric open.
  it("says the counterpart will be split when it outruns this wall", () => {
    renderDialog(ready({ sharedRoomNames: ["Main Gallery"], willSplit: true }));

    expect(screen.getByText(/backs Main Gallery/)).toBeInTheDocument();
    expect(
      screen.getByText(/it will be split and only the part behind this wall opens/)
    ).toBeInTheDocument();
  });

  it("confirms once, and cancel only closes", () => {
    const { onConfirm, onOpenChange } = renderDialog(ready());

    fireEvent.click(screen.getByRole("button", { name: "Open wall" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
