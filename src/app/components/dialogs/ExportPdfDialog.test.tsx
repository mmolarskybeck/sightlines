import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import type { Project } from "../../../domain/project";
import { TooltipProvider } from "../ui/tooltip";
import { ExportPdfDialog } from "./ExportPdfDialog";

vi.mock("../ui/select", async () => {
  const { createContext, useContext } = await import("react");
  const Context = createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});
  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <Context.Provider value={{ value, onValueChange }}>
        {children}
      </Context.Provider>
    ),
    SelectTrigger: ({ children, ...props }: React.ComponentProps<"button">) => (
      <button type="button" role="combobox" {...props}>
        {children}
      </button>
    ),
    SelectValue: () => <span>{useContext(Context).value}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <div role="listbox">{children}</div>
    ),
    SelectGroup: ({ children }: { children: React.ReactNode }) => (
      <div role="group">{children}</div>
    ),
    SelectLabel: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    SelectItem: ({
      children,
      value
    }: {
      children: React.ReactNode;
      value: string;
    }) => {
      const context = useContext(Context);
      return (
        <button
          role="option"
          type="button"
          onClick={() => context.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    }
  };
});

beforeAll(() => {
  const proto = window.HTMLElement.prototype;
  proto.hasPointerCapture = vi.fn();
  proto.setPointerCapture = vi.fn();
  proto.releasePointerCapture = vi.fn();
  proto.scrollIntoView = vi.fn();
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function projectWithExportContent(): Project {
  const project = createSampleProject();
  project.wallObjects = [
    {
      id: "work-1",
      kind: "artwork",
      artworkId: "art-1",
      wallId: "wall-north",
      xMm: 1000,
      yMm: 1500,
      widthMm: 500,
      heightMm: 700
    }
  ];
  project.savedViews = [
    {
      id: "view-1",
      ordinal: 1,
      title: "Entrance sightline",
      roomId: "room-main",
      pose: {
        position: { x: 1, y: 1.5, z: 2 },
        target: { x: 1, y: 1.5, z: 0 }
      },
      createdAt: "2026-07-16T00:00:00.000Z"
    }
  ];
  return project;
}

function projectWithDefaultSavedViewTitle(): Project {
  const project = projectWithExportContent();
  project.savedViews = (project.savedViews ?? []).map((view) => ({
    ...view,
    title: `Saved view ${view.ordinal}`
  }));
  return project;
}

function renderDialog(project: Project = projectWithExportContent()) {
  const handlers = {
    onOpenChange: vi.fn(),
    onExport: vi.fn()
  };
  render(
    <TooltipProvider>
      <ExportPdfDialog open project={project} {...handlers} />
    </TooltipProvider>
  );
  return handlers;
}

describe("ExportPdfDialog", () => {
  it("renders the specified sections, defaults, live page count, and Saved view placeholder", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: "Export PDF" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contents" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Options" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Page setup" })).toBeInTheDocument();

    expect(screen.getByRole("checkbox", { name: "Include Overview" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Include Room plans" })
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Include Elevations" })
    ).toHaveAttribute("data-state", "indeterminate");
    expect(screen.getByRole("checkbox", { name: "Include 3D views" })).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Show dimensions" })
    ).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Show grid" })
    ).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Paper size" })).toHaveTextContent(
      "letter"
    );

    expect(screen.getByText("Main Gallery · Entrance sightline")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Main Gallery · Entrance sightline"
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/Exports/).parentElement).toHaveTextContent(
      "Exports 3 pages"
    );
  });

  it("keeps the 3D views rows to inclusion only — no rename or delete actions", () => {
    renderDialog();

    expect(
      screen.queryByRole("button", {
        name: "Rename Main Gallery · Entrance sightline"
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Delete Main Gallery · Entrance sightline"
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", {
        name: "Rename Main Gallery · Entrance sightline"
      })
    ).not.toBeInTheDocument();
  });

  it("uses tri-state select-all and clears child choices when the parent is unchecked", () => {
    renderDialog();
    const elevations = screen.getByRole("checkbox", {
      name: "Include Elevations"
    });

    // Starts indeterminate (one wall pre-included by default). Clicking an
    // indeterminate/unchecked parent selects every child.
    fireEvent.click(elevations);
    expect(elevations).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Include Main Gallery, East wall elevation"
      })
    ).toBeChecked();
    expect(screen.getByText(/Exports/).parentElement).toHaveTextContent(
      "Exports 6 pages"
    );

    // Clicking a fully-checked parent clears every child — the section's
    // "enabled" state is derived from its children, so this is the only way
    // to guarantee nothing in the section exports (no more nothing-selected
    // trap where an unchecked section still exports a stray checked child).
    fireEvent.click(elevations);
    expect(elevations).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Include Main Gallery, East wall elevation"
      })
    ).not.toBeChecked();
    expect(screen.getByText(/Exports/).parentElement).toHaveTextContent(
      "Exports 2 pages"
    );

    fireEvent.click(elevations);
    expect(elevations).toBeChecked();
    expect(screen.getByText(/Exports/).parentElement).toHaveTextContent(
      "Exports 6 pages"
    );
  });

  it("checking a single child while the section reads off makes just that child export (no nothing-selected trap)", () => {
    renderDialog();
    const elevations = screen.getByRole("checkbox", {
      name: "Include Elevations"
    });
    const elevationsRow = elevations.closest(".export-section-row");
    if (!elevationsRow) throw new Error("Elevations row not found");

    // Clear the section entirely first.
    fireEvent.click(elevations);
    expect(elevations).toBeChecked();
    fireEvent.click(elevations);
    expect(elevations).not.toBeChecked();
    expect(
      within(elevationsRow as HTMLElement).getByText("0 of 4")
    ).toBeInTheDocument();
    expect(screen.getByText(/Exports/).parentElement).toHaveTextContent(
      "Exports 2 pages"
    );

    // Checking a single child brings the section back on and exports
    // exactly that page.
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Include Main Gallery, East wall elevation"
      })
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Include Main Gallery, East wall elevation"
      })
    ).toBeChecked();
    expect(elevations).toHaveAttribute("data-state", "indeterminate");
    expect(
      within(elevationsRow as HTMLElement).getByText("1 of 4")
    ).toBeInTheDocument();
    expect(screen.getByText(/Exports/).parentElement).toHaveTextContent(
      "Exports 3 pages"
    );
  });

  it("lets a single-room project opt into its room plan independently", () => {
    renderDialog();
    const roomPlans = screen.getByRole("checkbox", {
      name: "Include Room plans"
    });

    fireEvent.click(roomPlans);

    expect(roomPlans).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Include Main Gallery room plan" })
    ).toBeChecked();
    expect(screen.getByText(/Exports/).parentElement).toHaveTextContent(
      "Exports 4 pages"
    );
  });

  it("omits the redundant saved-view subtitle for a default title, shows it once renamed", () => {
    renderDialog(projectWithDefaultSavedViewTitle());

    expect(
      screen.getByText("Main Gallery · Saved view 1")
    ).toBeInTheDocument();
    expect(screen.queryByText("Saved view 1")).not.toBeInTheDocument();
  });

  it("shows the saved-view subtitle when the title differs from the default", () => {
    renderDialog();

    expect(
      screen.getByText("Main Gallery · Entrance sightline")
    ).toBeInTheDocument();
    expect(screen.getByText("Saved view 1")).toBeInTheDocument();
  });

  it("reveals per-surface unit rows only while Show dimensions is on", () => {
    renderDialog();

    // Show dimensions defaults on, so both unit rows are present.
    const planUnits = screen.getByRole("combobox", { name: "Plan units" });
    const elevationUnits = screen.getByRole("combobox", {
      name: "Elevation units"
    });
    // "Auto" spells out the resolved unit; the ft project resolves plan → ft
    // and elevation → in (the in-app elevation convention).
    const planLabel = planUnits.closest("label") as HTMLElement;
    const elevationLabel = elevationUnits.closest("label") as HTMLElement;
    expect(
      within(planLabel).getByRole("option", { name: "Auto (ft)" })
    ).toBeInTheDocument();
    expect(
      within(elevationLabel).getByRole("option", { name: "Auto (in)" })
    ).toBeInTheDocument();

    // Turning Show dimensions off hides the rows entirely (not just disables).
    fireEvent.click(screen.getByRole("switch", { name: "Show dimensions" }));
    expect(
      screen.queryByRole("combobox", { name: "Plan units" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Elevation units" })
    ).not.toBeInTheDocument();
  });

  it("threads an explicit plan unit choice through to the export callback", () => {
    const { onExport } = renderDialog();
    const planLabel = screen
      .getByRole("combobox", { name: "Plan units" })
      .closest("label") as HTMLElement;

    fireEvent.click(
      within(planLabel).getByRole("option", { name: "Millimeters (mm)" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        planUnit: "mm",
        resolvedPlanUnit: "mm",
        // Elevation stays on Auto, resolving to inches for this ft project.
        elevationUnit: "auto",
        resolvedElevationUnit: "in"
      })
    );
  });

  it("disables export and shows guidance when every section is off", () => {
    renderDialog(createSampleProject());

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include Overview" })
    );

    expect(screen.getByText("Select at least one page.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export PDF" })
    ).toBeDisabled();
  });

  it("passes current effective settings to the export callback", () => {
    const { onExport } = renderDialog();
    fireEvent.click(screen.getByRole("switch", { name: "Show grid" }));
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        grid: true,
        dimensions: true,
        paperSize: "letter"
      })
    );
  });

  it("shows determinate progress and disables controls while exporting", () => {
    const onCancelExport = vi.fn();
    render(
      <TooltipProvider>
        <ExportPdfDialog
          open
          project={projectWithExportContent()}
          onOpenChange={vi.fn()}
          onExport={vi.fn()}
          exportState={{ done: 2, total: 5 }}
          onCancelExport={onCancelExport}
        />
      </TooltipProvider>
    );

    const primary = screen.getByRole("button", { name: /Exporting/ });
    expect(primary).toBeDisabled();

    const bar = screen.getByRole("progressbar", { name: "Export progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "5");

    // Content controls go non-interactive via the disabled fieldset.
    expect(screen.getByRole("checkbox", { name: "Include Overview" })).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "Show dimensions" })
    ).toBeDisabled();

    // The page-count summary is replaced by the live progress status.
    expect(screen.queryByText(/Exports/)).not.toBeInTheDocument();
  });

  it("routes Cancel to onCancelExport while exporting", () => {
    const onOpenChange = vi.fn();
    const onCancelExport = vi.fn();
    render(
      <TooltipProvider>
        <ExportPdfDialog
          open
          project={projectWithExportContent()}
          onOpenChange={onOpenChange}
          onExport={vi.fn()}
          exportState={{ done: 0, total: 4 }}
          onCancelExport={onCancelExport}
        />
      </TooltipProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancelExport).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("stays idle — no progressbar, controls live — when exportState is absent", () => {
    renderDialog();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Include Overview" })
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Export PDF" })
    ).toBeInTheDocument();
  });

  it("renders the inline preview pane starting on the first manifest page, with no blob Preview button", () => {
    renderDialog();

    const preview = screen.getByRole("complementary", { name: "PDF preview" });
    // The pane is a live SVG look-ahead, not a generate-on-demand blob: there
    // is no "Preview" action button and no <iframe>.
    expect(
      screen.queryByRole("button", { name: "Preview" })
    ).not.toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();

    // Default sample: Overview + one default-included elevation + one 3D view.
    expect(
      within(preview).getByText("Page 1 of 3 · Overview")
    ).toBeInTheDocument();
    // Exactly one page card SVG is rendered — only the visible page draws.
    expect(within(preview).getAllByRole("img")).toHaveLength(1);
    expect(within(preview).getByRole("img")).toHaveAttribute(
      "aria-label",
      "Overview"
    );
  });

  it("pages forward/back through the manifest and clamps at both ends", () => {
    renderDialog();
    const preview = screen.getByRole("complementary", { name: "PDF preview" });
    const next = within(preview).getByRole("button", { name: "Next page" });
    const prev = within(preview).getByRole("button", { name: "Previous page" });

    // On the first page, Previous is disabled.
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();

    fireEvent.click(next);
    expect(
      within(preview).getByText(/^Page 2 of 3 · Elevation/)
    ).toBeInTheDocument();

    fireEvent.click(next);
    expect(
      within(preview).getByText(/^Page 3 of 3 · 3D view/)
    ).toBeInTheDocument();
    // On the last page, Next is disabled (index clamps, doesn't overrun).
    expect(next).toBeDisabled();

    fireEvent.click(prev);
    expect(
      within(preview).getByText(/^Page 2 of 3 · Elevation/)
    ).toBeInTheDocument();
  });

  it("clamps the current page when the manifest shrinks under the cursor", () => {
    renderDialog();
    const preview = screen.getByRole("complementary", { name: "PDF preview" });
    const next = within(preview).getByRole("button", { name: "Next page" });

    // Advance to the last (3D) page…
    fireEvent.click(next);
    fireEvent.click(next);
    expect(
      within(preview).getByText(/^Page 3 of 3 · 3D view/)
    ).toBeInTheDocument();

    // …then drop the 3D views section. The preview count follows the manifest
    // and the index is pulled back to the new last page rather than going blank.
    fireEvent.click(screen.getByRole("checkbox", { name: "Include 3D views" }));
    expect(
      within(preview).getByText(/^Page 2 of 2 · Elevation/)
    ).toBeInTheDocument();
  });

  it("shows a Nothing selected outline when no pages are selected", () => {
    renderDialog(createSampleProject());
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Overview" }));

    const preview = screen.getByRole("complementary", { name: "PDF preview" });
    expect(within(preview).getByText("Nothing selected")).toBeInTheDocument();
    expect(
      within(preview).getByText("No pages to preview")
    ).toBeInTheDocument();
  });
});
