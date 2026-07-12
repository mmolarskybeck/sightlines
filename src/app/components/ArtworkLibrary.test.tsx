import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artwork, Project } from "../../domain/project";
import { ArtworkLibraryPicker, ArtworkLibraryView } from "./ArtworkLibrary";

afterEach(cleanup);

const artworks: Artwork[] = [
  {
    id: "art-1",
    schemaVersion: 1,
    artist: "Alma Thomas",
    title: "Wind and Crepe Myrtle Concerto",
    date: "1973",
    dimensions: { widthMm: 1270, heightMm: 1270, status: "known" },
    metadata: {}
  },
  {
    id: "art-2",
    schemaVersion: 1,
    artist: "Sam Gilliam",
    title: "Relative",
    date: "1969",
    dimensions: { status: "unknown" },
    metadata: {}
  }
];

const project = {
  id: "project-1",
  schemaVersion: 3,
  title: "Current project",
  unit: "ft",
  checklistArtworkIds: ["art-1"],
  floor: { rooms: [] },
  wallObjects: [],
  floorObjects: [],
  defaultWallHeightMm: 3000,
  defaultCenterlineHeightMm: 1450,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01"
} satisfies Project;

const getBlob = vi.fn(async () => new Blob());

describe("ArtworkLibraryView", () => {
  it("searches the global table and exposes project membership", () => {
    render(<ArtworkLibraryView artworks={artworks} project={project} getBlob={getBlob} onAddToChecklist={vi.fn()} onOpenImportWizard={vi.fn()} />);

    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByText("In checklist").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search artworks" }), { target: { value: "Gilliam" } });
    expect(screen.queryByText("Wind and Crepe Myrtle Concerto")).toBeNull();
    expect(screen.getByText("Relative")).toBeTruthy();
  });

  it("adds an available artwork to the current checklist", () => {
    const onAddToChecklist = vi.fn();
    render(<ArtworkLibraryView artworks={artworks} project={project} getBlob={getBlob} onAddToChecklist={onAddToChecklist} onOpenImportWizard={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Relative to current checklist" }));
    expect(onAddToChecklist).toHaveBeenCalledWith(["art-2"]);
  });

  it("sorts from table headers and announces direction", () => {
    render(<ArtworkLibraryView artworks={artworks} project={project} getBlob={getBlob} onAddToChecklist={vi.fn()} onOpenImportWizard={vi.fn()} />);
    const titleHeader = screen.getByRole("columnheader", { name: /Artwork/ });
    expect(titleHeader).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: /Artwork/ }));
    expect(titleHeader).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("button", { name: /Artist/ }));
    expect(screen.getByRole("columnheader", { name: /Artist/ })).toHaveAttribute("aria-sort", "ascending");
  });

  it("offers the recovery action that matches an empty result", () => {
    render(<ArtworkLibraryView artworks={artworks} project={{ ...project, checklistArtworkIds: artworks.map((artwork) => artwork.id) }} getBlob={getBlob} onAddToChecklist={vi.fn()} onOpenImportWizard={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Available" }));
    expect(screen.getByText("Every library artwork is already in this checklist.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show all artworks" })).toBeTruthy();
  });

  it("filters by current checklist membership and bulk-adds selected works", () => {
    const onAddToChecklist = vi.fn();
    render(<ArtworkLibraryView artworks={artworks} project={project} getBlob={getBlob} onAddToChecklist={onAddToChecklist} onOpenImportWizard={vi.fn()} />);

    fireEvent.click(screen.getByRole("radio", { name: "Available" }));
    expect(screen.queryByText("Wind and Crepe Myrtle Concerto")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Relative" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected to checklist" }));
    expect(onAddToChecklist).toHaveBeenCalledWith(["art-2"]);
  });

  it("lists 2+ project memberships in an accessible menu", () => {
    render(<ArtworkLibraryView artworks={artworks} project={project} getBlob={getBlob} onAddToChecklist={vi.fn()} onOpenImportWizard={vi.fn()} projectMembershipsByArtworkId={{ "art-1": [{ id: "project-2", title: "Summer rotation", updatedAt: "2026-01-02" }, { id: "project-3", title: "Winter rotation", updatedAt: "2026-01-03" }] }} onOpenProject={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Used in 2 projects" })).toHaveAttribute("aria-haspopup", "menu");
  });

  it("renders a single membership as a direct button that opens the project", () => {
    const onOpenProject = vi.fn();
    render(<ArtworkLibraryView artworks={artworks} project={project} getBlob={getBlob} onAddToChecklist={vi.fn()} onOpenImportWizard={vi.fn()} projectMembershipsByArtworkId={{ "art-1": [{ id: "project-2", title: "Summer rotation", updatedAt: "2026-01-02" }] }} onOpenProject={onOpenProject} />);
    const button = screen.getByRole("button", { name: "Open Summer rotation" });
    expect(button).not.toHaveAttribute("aria-haspopup");
    expect(button.textContent).toContain("Summer rotation");
    fireEvent.click(button);
    expect(onOpenProject).toHaveBeenCalledWith("project-2");
  });

  it("select-all checks every visible row and goes indeterminate when partial", () => {
    render(<ArtworkLibraryView artworks={artworks} project={project} getBlob={getBlob} onAddToChecklist={vi.fn()} onOpenImportWizard={vi.fn()} onDeleteArtworks={vi.fn()} />);
    const selectAll = screen.getByRole("checkbox", { name: "Select all shown artworks" });
    fireEvent.click(selectAll);
    expect(screen.getByRole("checkbox", { name: "Select Wind and Crepe Myrtle Concerto" })).toHaveAttribute("data-state", "checked");
    expect(screen.getByRole("checkbox", { name: "Select Relative" })).toHaveAttribute("data-state", "checked");
    expect(selectAll).toHaveAttribute("data-state", "checked");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Relative" }));
    expect(selectAll).toHaveAttribute("aria-checked", "mixed");
  });

  it("confirms a mass delete with usage copy and clears the selection", () => {
    const onDeleteArtworks = vi.fn();
    render(<ArtworkLibraryView artworks={artworks} project={project} getBlob={getBlob} onAddToChecklist={vi.fn()} onOpenImportWizard={vi.fn()} onDeleteArtworks={onDeleteArtworks} projectMembershipsByArtworkId={{ "art-1": [{ id: "project-2", title: "Summer rotation", updatedAt: "2026-01-02" }] }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Wind and Crepe Myrtle Concerto" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Relative" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/1 of these works is on the checklist in “Summer rotation”/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 works" }));
    expect(onDeleteArtworks).toHaveBeenCalledWith(["art-1", "art-2"]);
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("cancels a mass delete without calling the callback or dropping the selection", () => {
    const onDeleteArtworks = vi.fn();
    render(<ArtworkLibraryView artworks={artworks} project={project} getBlob={getBlob} onAddToChecklist={vi.fn()} onOpenImportWizard={vi.fn()} onDeleteArtworks={onDeleteArtworks} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Relative" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDeleteArtworks).not.toHaveBeenCalled();
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("teaches the global scope when empty", () => {
    render(<ArtworkLibraryView artworks={[]} project={project} getBlob={getBlob} onAddToChecklist={vi.fn()} onOpenImportWizard={vi.fn()} />);
    expect(screen.getByText(/Import works once/)).toBeTruthy();
  });
});

describe("ArtworkLibraryPicker", () => {
  it("disables existing members and adds a multi-selection", () => {
    const onAddToChecklist = vi.fn();
    render(<ArtworkLibraryPicker open artworks={artworks} project={project} getBlob={getBlob} onOpenChange={vi.fn()} onAddToChecklist={onAddToChecklist} />);

    const existing = screen.getByRole("checkbox", { name: /Wind and Crepe Myrtle Concerto/ });
    expect(existing).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Relative/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 to checklist" }));
    expect(onAddToChecklist).toHaveBeenCalledWith(["art-2"]);
  });
});
