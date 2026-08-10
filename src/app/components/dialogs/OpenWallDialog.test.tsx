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

  // The plainest case must stay two sentences. This is the guard against the
  // dialog drifting back into a paragraph.
  it("names the wall and the room, and promises undo", () => {
    renderDialog(ready());

    expect(screen.getByText("Open North wall?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This will delete the wall and open East Gallery on that side. Undo will revert this."
      )
    ).toBeInTheDocument();
  });

  // The accuracy requirement: two fates, two verbs, never merged into one
  // count. A reader skimming must not think the artworks are being deleted.
  it("keeps unhang and delete in separate clauses", () => {
    renderDialog(ready({ summary: summary({ artworks: 2, doors: 1 }) }));

    expect(
      screen.getByText(
        /2 works currently placed will go back on the checklist, unplaced\. Everything else on it will be deleted\./
      )
    ).toBeInTheDocument();
    // The work count must not land inside the deletion sentence — no path from
    // "2 works" to "deleted" without crossing a full stop.
    expect(screen.queryByText(/2 works[^.]*deleted/)).not.toBeInTheDocument();
  });

  it("uses singular phrasing for one work", () => {
    renderDialog(ready({ summary: summary({ artworks: 1 }) }));

    expect(
      screen.getByText(/1 work currently placed will go back on the checklist, unplaced\./)
    ).toBeInTheDocument();
  });

  // Fixture kinds are deliberately NOT enumerated: undo restores them and the
  // counts never changed the decision. One clause covers all of them.
  it("does not inventory fixture kinds", () => {
    renderDialog(
      ready({
        summary: summary({ doors: 1, windows: 2, wallTexts: 1, measurements: 1 })
      })
    );

    expect(
      screen.getByText(/Everything on the wall will be deleted\./)
    ).toBeInTheDocument();
    expect(screen.queryByText(/2 windows/)).not.toBeInTheDocument();
    expect(screen.queryByText(/wall label/)).not.toBeInTheDocument();
  });

  it("says nothing about contents for an empty wall", () => {
    renderDialog(ready());

    expect(screen.queryByText(/back on the checklist/)).not.toBeInTheDocument();
    expect(screen.queryByText(/will be deleted/)).not.toBeInTheDocument();
  });

  it("warns when the wall is shared, naming the other room", () => {
    renderDialog(ready({ sharedRoomNames: ["West Gallery"] }));

    expect(
      screen.getByText("West Gallery shares this wall and will open too.")
    ).toBeInTheDocument();
  });

  it("omits the shared warning when the wall is exterior", () => {
    renderDialog(ready());
    expect(screen.queryByText(/shares this wall/)).not.toBeInTheDocument();
  });

  // The alcove case: the neighbour's wall runs past this one and gets cut, so
  // the copy must say so rather than implying a symmetric open.
  it("says the counterpart will be split when it outruns this wall", () => {
    renderDialog(ready({ sharedRoomNames: ["Main Gallery"], willSplit: true }));

    expect(
      screen.getByText(
        "Main Gallery’s wall runs past this one. It will be split so only the shared part opens."
      )
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
