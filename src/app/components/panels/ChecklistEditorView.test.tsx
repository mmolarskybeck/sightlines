import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artwork, Project } from "../../../domain/project";
import { TooltipProvider } from "../ui/tooltip";
import { ChecklistEditorView } from "./ChecklistEditorView";

afterEach(cleanup);

const art = (id: string, title: string, artist: string): Artwork => ({
  id,
  schemaVersion: 1,
  title,
  artist,
  dimensions: { status: "unknown" },
  metadata: {}
});
const artworks = [art("a1", "Zeta", "Xu"), art("a2", "Alpha", "Yu")];
const project = {
  id: "p",
  schemaVersion: 3,
  title: "P",
  unit: "ft",
  checklistArtworkIds: ["a1", "a2"],
  floor: { rooms: [] },
  wallObjects: [],
  floorObjects: [],
  defaultWallHeightMm: 3000,
  defaultCenterlineHeightMm: 1450,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01"
} satisfies Project;

function setup(overrides: Partial<Project> = {}, onChangeChecklistView = vi.fn(async () => {})) {
  render(
    <TooltipProvider>
      <ChecklistEditorView
        project={{ ...project, ...overrides }}
        libraryArtworks={artworks}
        getBlob={async () => new Blob()}
        selectedArtworkId={null}
        checked={new Set()}
        onCheckedChange={vi.fn()}
        onSelectArtwork={vi.fn()}
        onChangeChecklistView={onChangeChecklistView}
        onBack={vi.fn()}
        onDuplicate={vi.fn()}
        onRemove={vi.fn()}
        onSelectOnCanvas={vi.fn()}
        onNewArtwork={vi.fn()}
        onOpenArtworkLibrary={vi.fn()}
      />
    </TooltipProvider>
  );
  return onChangeChecklistView;
}
const titles = () =>
  within(screen.getByRole("table")).getAllByRole("rowheader").map((el) => el.textContent?.trim());

describe("ChecklistEditorView", () => {
  it("renders rows in the checklist sort", () => {
    setup({ checklistView: { sort: "title", groupByArtist: false } });
    expect(titles()).toEqual(["Alpha", "Zeta"]);
  });

  it("filter Placed hides unplaced rows", () => {
    setup();
    expect(titles()).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "Placed" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Nothing placed yet.")).toBeTruthy();
  });

  it("clicking a sortable header changes the checklist view", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: /Artwork/ }));
    expect(onChange).toHaveBeenCalledWith({ sort: "title", groupByArtist: false });
  });
});
