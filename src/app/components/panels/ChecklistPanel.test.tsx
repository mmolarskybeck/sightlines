import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Artwork, Project } from "../../../domain/project";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { TooltipProvider } from "../ui/tooltip";
import type { ChecklistRowData } from "./ChecklistPanel";
import {
  ChecklistPanel,
  checklistRowMatchesQuery,
  groupChecklistRowsByArtist,
  sortChecklistRows
} from "./ChecklistPanel";

// jsdom doesn't implement scrollIntoView; the panel calls it when selection
// changes to a row (see ChecklistPanel.tsx's scroll-into-view effect).
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

function row(
  projectIndex: number,
  partial: Partial<ChecklistRowData> & {
    artworkId: string;
  }
): ChecklistRowData {
  return {
    artwork: null,
    isPlaced: false,
    placementIds: [],
    wallName: null,
    projectIndex,
    ...partial
  };
}

describe("sortChecklistRows", () => {
  it("keeps project order by default", () => {
    const rows = [
      row(2, { artworkId: "c" }),
      row(0, { artworkId: "a" }),
      row(1, { artworkId: "b" })
    ];

    expect(sortChecklistRows(rows, "project").map((item) => item.artworkId)).toEqual([
      "a",
      "b",
      "c"
    ]);
  });

  it("sorts by title with project order as the stable tiebreaker", () => {
    const rows = [
      row(2, {
        artworkId: "z",
        artwork: {
          id: "z",
          schemaVersion: 1,
          title: "Zebra",
          dimensions: { status: "unknown" },
          metadata: {}
        }
      }),
      row(0, {
        artworkId: "a",
        artwork: {
          id: "a",
          schemaVersion: 1,
          title: "Arc",
          dimensions: { status: "unknown" },
          metadata: {}
        }
      }),
      row(1, {
        artworkId: "b",
        artwork: {
          id: "b",
          schemaVersion: 1,
          title: "Arc",
          dimensions: { status: "unknown" },
          metadata: {}
        }
      })
    ];

    expect(sortChecklistRows(rows, "title").map((item) => item.artworkId)).toEqual([
      "a",
      "b",
      "z"
    ]);
  });

  it("groups unplaced works before placed works for status sorting", () => {
    const rows = [
      row(0, { artworkId: "placed-first", isPlaced: true }),
      row(1, { artworkId: "unplaced", isPlaced: false }),
      row(2, { artworkId: "placed-second", isPlaced: true })
    ];

    expect(sortChecklistRows(rows, "status").map((item) => item.artworkId)).toEqual([
      "unplaced",
      "placed-first",
      "placed-second"
    ]);
  });
});

describe("checklist retrieval and artist groups", () => {
  it("matches every search term across curator-facing and imported metadata", () => {
    const searchable = row(0, {
      artworkId: "searchable",
      artwork: artwork("searchable", "Harbor at Dusk", "Boyun Jang", {
        date: "2024",
        locationOrLender: "North Gallery",
        metadata: { subject: "urban landscape" }
      })
    });

    expect(checklistRowMatchesQuery(searchable, "boyun landscape")).toBe(true);
    expect(checklistRowMatchesQuery(searchable, "north 2024")).toBe(true);
    expect(checklistRowMatchesQuery(searchable, "portrait")).toBe(false);
  });

  it("groups artist names case-insensitively and keeps missing artists together", () => {
    const groups = groupChecklistRowsByArtist([
      row(0, { artworkId: "one", artwork: artwork("one", "One", "Boyun Jang") }),
      row(1, { artworkId: "two", artwork: artwork("two", "Two", " boyun jang ") }),
      row(2, { artworkId: "three", artwork: artwork("three", "Three") }),
      row(3, { artworkId: "four", artwork: artwork("four", "Four", "  ") })
    ]);

    expect(groups.map((group) => [group.label, group.rows.length])).toEqual([
      ["Boyun Jang", 2],
      ["Artist not recorded", 2]
    ]);
  });
});

describe("ChecklistPanel temporary views", () => {
  it("searches the checklist, updates counts, and recovers from an empty result", () => {
    const { container } = renderChecklist();

    fireEvent.click(screen.getByRole("button", { name: "Search checklist" }));
    const search = screen.getByRole("searchbox", { name: "Search checklist" });
    fireEvent.change(search, { target: { value: "landscape" } });

    expect(screen.getByText("Landscape Study")).toBeInTheDocument();
    expect(screen.queryByText("Interior Study")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 4 works")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All (1)" })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "no such work" } });
    expect(screen.getByText("No works match “no such work”.")).toBeInTheDocument();
    // The empty state's own recovery button, not the field's trailing control —
    // both clear the query, and both are named for what they do.
    const emptyState = container.querySelector(".checklist-filter-empty") as HTMLElement;
    fireEvent.click(within(emptyState).getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("Interior Study")).toBeInTheDocument();
  });

  it("clears before it closes, so one press never takes away more than it says", () => {
    const { container } = renderChecklist();

    fireEvent.click(screen.getByRole("button", { name: "Search checklist" }));
    const search = screen.getByRole("searchbox", { name: "Search checklist" });
    fireEvent.change(search, { target: { value: "landscape" } });

    const field = container.querySelector(".checklist-search") as HTMLElement;
    // With a query the control is a clear, and says so.
    fireEvent.click(within(field).getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(screen.getByText("Interior Study")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search checklist" })).toBeInTheDocument();

    // Emptied, the same control becomes the close.
    fireEvent.click(within(field).getByRole("button", { name: "Close search" }));
    expect(screen.queryByRole("searchbox", { name: "Search checklist" })).toBeNull();
  });

  it("closes and clears in one press from the magnifier toggle", () => {
    renderChecklist();

    fireEvent.click(screen.getByRole("button", { name: "Search checklist" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search checklist" }), {
      target: { value: "landscape" }
    });
    expect(screen.getByText("1 of 4 works")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(screen.queryByRole("searchbox", { name: "Search checklist" })).toBeNull();
    expect(screen.getByText("4 works")).toBeInTheDocument();
    expect(screen.getByText("Interior Study")).toBeInTheDocument();
  });

  it("toggles independent artist disclosures without changing flat artist order", async () => {
    renderChecklist();
    await enableArtistGrouping();

    const alma = screen.getByRole("button", { name: "Alma Thomas, 1 work" });
    const boyun = screen.getByRole("button", { name: "Boyun Jang, 2 works" });
    expect(alma).toHaveAttribute("aria-expanded", "true");
    expect(boyun).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(boyun);
    expect(boyun).toHaveAttribute("aria-expanded", "false");
    expect(alma).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("Landscape Study")).not.toBeInTheDocument();
    expect(screen.getByText("Wind Study")).toBeInTheDocument();

    await openChecklistOptions();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Group by artist" }));
    expect(screen.queryByRole("button", { name: "Boyun Jang, 2 works" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Checklist options. Sort: Artist" })
    ).toBeInTheDocument();
  });

  it("temporarily opens matching collapsed groups and restores them after search", async () => {
    renderChecklist();
    await enableArtistGrouping();
    fireEvent.click(screen.getByRole("button", { name: "Boyun Jang, 2 works" }));

    fireEvent.click(screen.getByRole("button", { name: "Search checklist" }));
    const search = screen.getByRole("searchbox", { name: "Search checklist" });
    fireEvent.change(search, { target: { value: "Boyun" } });
    expect(screen.getByRole("button", { name: "Boyun Jang, 2 works" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByText("Landscape Study")).toBeInTheDocument();

    // Clearing the query is enough to hand the group back to the curator's own
    // collapsed state — the search row itself can stay open for the next term.
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("button", { name: "Boyun Jang, 2 works" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  // Regression coverage for the bug in docs/interaction-improvements-2026-08.md
  // §1: the auto-expand-on-selection effect used to depend on an unmemoized
  // `rows` array, so it re-fired on every render — including the render
  // caused by the user's own collapse click — and immediately re-opened the
  // section it had just closed. The harness above defaults selectedArtworkId
  // to null, which is why the bug was invisible in the existing tests; these
  // all render with a non-null selection.
  it("lets the selected work's own artist section be collapsed, and it stays collapsed across a re-render", async () => {
    const { rerenderWithSelection } = renderChecklist({ selectedArtworkId: "boyun-landscape" });
    await enableArtistGrouping();

    const boyun = screen.getByRole("button", { name: "Boyun Jang, 2 works" });
    expect(boyun).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(boyun);
    expect(screen.getByRole("button", { name: "Boyun Jang, 2 works" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    // Re-render with the SAME selection (the component re-rendering for any
    // other reason — this is what used to reopen the section, since `rows`
    // was rebuilt with a new identity on every render).
    rerenderWithSelection("boyun-landscape");
    expect(screen.getByRole("button", { name: "Boyun Jang, 2 works" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("expands a collapsed section when selection changes to a work inside it", async () => {
    const { rerenderWithSelection } = renderChecklist({ selectedArtworkId: null });
    await enableArtistGrouping();
    fireEvent.click(screen.getByRole("button", { name: "Boyun Jang, 2 works" }));
    expect(screen.getByRole("button", { name: "Boyun Jang, 2 works" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByText("Landscape Study")).not.toBeInTheDocument();

    // Selection arriving from outside the panel (canvas/plan/3D) into the
    // collapsed section should open it and reveal the row.
    rerenderWithSelection("boyun-landscape");
    expect(screen.getByRole("button", { name: "Boyun Jang, 2 works" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByText("Landscape Study")).toBeInTheDocument();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("collapses every artist section from Collapse all, even with a work selected", async () => {
    renderChecklist({ selectedArtworkId: "boyun-landscape" });
    await enableArtistGrouping();

    const alma = screen.getByRole("button", { name: "Alma Thomas, 1 work" });
    const boyun = screen.getByRole("button", { name: "Boyun Jang, 2 works" });
    expect(alma).toHaveAttribute("aria-expanded", "true");
    expect(boyun).toHaveAttribute("aria-expanded", "true");

    await openChecklistOptions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse all artists" }));

    expect(screen.getByRole("button", { name: "Alma Thomas, 1 work" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.getByRole("button", { name: "Boyun Jang, 2 works" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});

const panelArtworks: Artwork[] = [
  artwork("boyun-landscape", "Landscape Study", "Boyun Jang", {
    metadata: { subject: "landscape" }
  }),
  artwork("boyun-interior", "Interior Study", "Boyun Jang"),
  artwork("alma-wind", "Wind Study", "Alma Thomas"),
  artwork("unknown", "Untitled Study")
];

function artwork(
  id: string,
  title: string,
  artist?: string,
  overrides: Partial<Artwork> = {}
): Artwork {
  return {
    id,
    schemaVersion: 1,
    title,
    artist,
    dimensions: { status: "unknown" },
    metadata: {},
    ...overrides
  };
}

function buildChecklistElement(project: Project, selectedArtworkId: string | null) {
  return (
    <TooltipProvider>
      <ChecklistPanel
        getBlob={vi.fn(async () => new Blob())}
        intakeState="idle"
        libraryArtworks={panelArtworks}
        onAddArtworksFromFiles={vi.fn(async () => undefined)}
        onConfirmDuplicateUploads={vi.fn(async () => undefined)}
        onDismissDuplicateUploads={vi.fn()}
        onOpenArtworkLibrary={vi.fn()}
        onOpenImportWizard={vi.fn()}
        onRemoveArtworkFromChecklist={vi.fn(async () => undefined)}
        onRemovePlacement={vi.fn(async () => undefined)}
        onSelectArtwork={vi.fn()}
        pendingDuplicateUploads={[]}
        project={project}
        selectedArtworkId={selectedArtworkId}
      />
    </TooltipProvider>
  );
}

function renderChecklist(overrides: { project?: Project; selectedArtworkId?: string | null } = {}) {
  const project = overrides.project ?? {
    ...createSampleProject(),
    id: "checklist-test",
    checklistArtworkIds: panelArtworks.map((item) => item.id)
  };
  const result = render(buildChecklistElement(project, overrides.selectedArtworkId ?? null));
  return {
    ...result,
    // Re-renders the SAME element tree with a different selection — used to
    // simulate the selection changing from outside the panel (canvas/plan/3D)
    // without remounting, since that's exactly the path the auto-expand and
    // scroll-into-view effects key off of.
    rerenderWithSelection: (selectedArtworkId: string | null) =>
      result.rerender(buildChecklistElement(project, selectedArtworkId))
  };
}

async function openChecklistOptions() {
  const trigger = screen.getByRole("button", { name: /Checklist options/ });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
  return await screen.findByRole("menu");
}

async function enableArtistGrouping() {
  await openChecklistOptions();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Group by artist" }));
}
