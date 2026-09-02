import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  Artwork,
  ChecklistViewPreferences,
  Project
} from "../../../domain/project";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { TooltipProvider } from "../ui/tooltip";
import { ChecklistPanel } from "./ChecklistPanel";

// jsdom doesn't implement scrollIntoView; the panel calls it when selection
// changes to a row (see ChecklistPanel.tsx's scroll-into-view effect).
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

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

describe("ChecklistPanel project-held sort and grouping", () => {
  // The standard fixture is NOT a group show (only Boyun Jang has multiple
  // works), so it must open flat — the heuristic default is covered by the
  // group-show fixture below.
  it("opens flat for a checklist that is not a group show", () => {
    renderChecklist();
    expect(screen.queryByRole("button", { name: /Boyun Jang, 2 works/ })).toBeNull();
  });

  it("opens a group show grouped by artist and records turning it off as a project edit", async () => {
    const onChangeChecklistView = vi.fn();
    renderChecklist({
      project: groupShowProject(),
      libraryArtworks: groupShowArtworks,
      onChangeChecklistView
    });
    expect(
      screen.getByRole("button", { name: "Boyun Jang, 2 works" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Alma Thomas, 2 works" })
    ).toBeInTheDocument();
    // The default is derived, never written: nothing has changed the project.
    expect(onChangeChecklistView).not.toHaveBeenCalled();

    // Turning grouping off is an explicit choice, handed up as a complete
    // view record for the store to put on the project.
    await openChecklistOptions();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Group by artist" }));
    expect(onChangeChecklistView).toHaveBeenCalledWith({
      sort: "artist",
      groupByArtist: false
    });
    expect(screen.queryByRole("button", { name: "Boyun Jang, 2 works" })).toBeNull();
  });

  it("hands an explicit sort choice up as a complete view record", async () => {
    const onChangeChecklistView = vi.fn();
    renderChecklist({ onChangeChecklistView });
    await openChecklistOptions();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Title" }));
    expect(onChangeChecklistView).toHaveBeenCalledWith({
      sort: "title",
      groupByArtist: false
    });
    expect(
      screen.getByRole("button", { name: "Checklist options. Sort: Title" })
    ).toBeInTheDocument();
  });

  it("renders the project's stored view instead of the group-show default", () => {
    // A group show whose project already records a flat Title sort — the
    // stored choice (what a reopened or synced project carries) must beat
    // the heuristic.
    renderChecklist({
      project: {
        ...groupShowProject(),
        checklistView: { sort: "title", groupByArtist: false }
      },
      libraryArtworks: groupShowArtworks
    });
    expect(screen.queryByRole("button", { name: /, \d+ works?$/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Checklist options. Sort: Title" })
    ).toBeInTheDocument();
  });

  it("renders a stored grouped view for a checklist that is not a group show", () => {
    renderChecklist({
      project: {
        ...createSampleProject(),
        id: "checklist-test",
        checklistArtworkIds: panelArtworks.map((item) => item.id),
        checklistView: { sort: "artist", groupByArtist: true }
      }
    });
    expect(
      screen.getByRole("button", { name: "Boyun Jang, 2 works" })
    ).toBeInTheDocument();
  });
});

// A group show by the default's definition: two artists each with more than
// one work (plus the unattributed stragglers, which must not count).
function groupShowProject(): Project {
  return {
    ...createSampleProject(),
    id: "group-show-test",
    checklistArtworkIds: groupShowArtworks.map((item) => item.id)
  };
}

const groupShowArtworks: Artwork[] = [
  artwork("boyun-landscape", "Landscape Study", "Boyun Jang"),
  artwork("boyun-interior", "Interior Study", "Boyun Jang"),
  artwork("alma-wind", "Wind Study", "Alma Thomas"),
  artwork("alma-sky", "Sky Study", "Alma Thomas"),
  artwork("unknown", "Untitled Study")
];

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

// Sort/grouping are project data now (project.checklistView), so the panel is
// controlled: an explicit choice only shows once the parent re-renders it with
// an updated project. This harness plays the store's role — it holds the view
// in state and feeds choices back into the project prop — so interaction tests
// see toggles take effect the way they do in the app.
function ChecklistHarness({
  project,
  selectedArtworkId,
  libraryArtworks = panelArtworks,
  onChangeChecklistView
}: {
  project: Project;
  selectedArtworkId: string | null;
  libraryArtworks?: Artwork[];
  onChangeChecklistView?: (view: ChecklistViewPreferences) => void;
}) {
  const [checklistView, setChecklistView] = useState(project.checklistView);
  return (
    <TooltipProvider>
      <ChecklistPanel
        getBlob={vi.fn(async () => new Blob())}
        intakeState="idle"
        libraryArtworks={libraryArtworks}
        onAddArtworksFromFiles={vi.fn(async () => undefined)}
        onChangeChecklistView={async (view) => {
          setChecklistView(view);
          onChangeChecklistView?.(view);
        }}
        onConfirmDuplicateUploads={vi.fn(async () => undefined)}
        onDismissDuplicateUploads={vi.fn()}
        onOpenArtworkLibrary={vi.fn()}
        onOpenImportWizard={vi.fn()}
        onRemoveArtworkFromChecklist={vi.fn(async () => undefined)}
        onRemovePlacement={vi.fn(async () => undefined)}
        onSelectArtwork={vi.fn()}
        pendingDuplicateUploads={[]}
        project={{ ...project, checklistView }}
        selectedArtworkId={selectedArtworkId}
      />
    </TooltipProvider>
  );
}

function renderChecklist(
  overrides: {
    project?: Project;
    selectedArtworkId?: string | null;
    libraryArtworks?: Artwork[];
    onChangeChecklistView?: (view: ChecklistViewPreferences) => void;
  } = {}
) {
  const project = overrides.project ?? {
    ...createSampleProject(),
    id: "checklist-test",
    checklistArtworkIds: panelArtworks.map((item) => item.id)
  };
  const result = render(
    <ChecklistHarness
      libraryArtworks={overrides.libraryArtworks}
      project={project}
      selectedArtworkId={overrides.selectedArtworkId ?? null}
      onChangeChecklistView={overrides.onChangeChecklistView}
    />
  );
  return {
    ...result,
    // Re-renders the SAME element tree with a different selection — used to
    // simulate the selection changing from outside the panel (canvas/plan/3D)
    // without remounting, since that's exactly the path the auto-expand and
    // scroll-into-view effects key off of. The harness keeps its view state
    // across this re-render, just as the store keeps the project's.
    rerenderWithSelection: (selectedArtworkId: string | null) =>
      result.rerender(
        <ChecklistHarness
          libraryArtworks={overrides.libraryArtworks}
          project={project}
          selectedArtworkId={selectedArtworkId}
          onChangeChecklistView={overrides.onChangeChecklistView}
        />
      )
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
