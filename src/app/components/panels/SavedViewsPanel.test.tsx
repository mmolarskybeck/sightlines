import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import type { Project, SavedView } from "../../../domain/project";
import { TooltipProvider } from "../ui/tooltip";
import { SavedViewsPanel } from "./SavedViewsPanel";

beforeAll(() => {
  const proto = window.HTMLElement.prototype;
  proto.hasPointerCapture = vi.fn();
  proto.setPointerCapture = vi.fn();
  proto.releasePointerCapture = vi.fn();
  proto.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const validPose: SavedView["pose"] = {
  position: { x: 1, y: 1.5, z: 2 },
  target: { x: 1, y: 1.5, z: 0 }
};

// A camera and target that coincide — no view direction, so isDegeneratePose
// flags it (spec §8.4).
const degeneratePose: SavedView["pose"] = {
  position: { x: 1, y: 1.5, z: 0 },
  target: { x: 1, y: 1.5, z: 0 }
};

function savedView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    id: "view-1",
    ordinal: 1,
    title: "Saved view 1",
    roomId: "room-main",
    pose: validPose,
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides
  };
}

function projectWithViews(views: SavedView[]): Project {
  const project = createSampleProject();
  project.savedViews = views;
  return project;
}

function renderPanel(
  project: Project,
  thumbnailUrls: Record<string, string> = {}
) {
  const handlers = {
    onOpenView: vi.fn(),
    onRenameSavedView: vi.fn().mockResolvedValue(undefined),
    onDeleteSavedView: vi.fn().mockResolvedValue(undefined)
  };
  render(
    <TooltipProvider>
      <SavedViewsPanel
        project={project}
        thumbnailUrls={thumbnailUrls}
        {...handlers}
      />
    </TooltipProvider>
  );
  return handlers;
}

describe("SavedViewsPanel", () => {
  it("teaches the one gesture when there are no saved views", () => {
    renderPanel(projectWithViews([]));

    expect(
      screen.getByText(/No saved views yet\./)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/choose Export → Save view to bookmark the current angle/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the count and composes room label · title", () => {
    renderPanel(
      projectWithViews([savedView({ title: "Entrance sightline" })])
    );

    expect(screen.getByRole("heading", { name: "Saved views" })).toBeInTheDocument();
    expect(screen.getByText("· 1")).toBeInTheDocument();
    expect(
      screen.getByText("Main Gallery · Entrance sightline")
    ).toBeInTheDocument();
  });

  it("counts invalid views in the header total", () => {
    renderPanel(
      projectWithViews([
        savedView({ id: "view-1" }),
        savedView({ id: "view-2", ordinal: 2, title: "Saved view 2", pose: degeneratePose })
      ])
    );

    expect(screen.getByText("· 2")).toBeInTheDocument();
  });

  it("omits the redundant subtitle for a default title, shows it once renamed", () => {
    renderPanel(projectWithViews([savedView({ title: "Saved view 1" })]));

    expect(screen.getByText("Main Gallery · Saved view 1")).toBeInTheDocument();
    // The "Saved view 1" default is not repeated as a subtitle.
    expect(screen.queryByText(/^Saved view 1$/)).not.toBeInTheDocument();

    cleanup();

    renderPanel(projectWithViews([savedView({ title: "Doorway reveal" })]));
    expect(screen.getByText("Main Gallery · Doorway reveal")).toBeInTheDocument();
    expect(screen.getByText("Saved view 1")).toBeInTheDocument();
  });

  it("opens a valid view on click and on Enter", () => {
    const { onOpenView } = renderPanel(
      projectWithViews([savedView({ title: "Entrance sightline" })])
    );

    const row = screen
      .getByText("Main Gallery · Entrance sightline")
      .closest("li");
    if (!row) throw new Error("row not found");
    expect(row).toHaveAttribute("role", "button");

    fireEvent.click(row);
    expect(onOpenView).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpenView).toHaveBeenCalledTimes(2);
    expect(onOpenView).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "view-1" })
    );
  });

  it("renders a placeholder tile until a thumbnail arrives, then the image", () => {
    const project = projectWithViews([savedView({ title: "Entrance sightline" })]);
    renderPanel(project);
    // No URL yet: the placeholder carries the composed label as its accessible
    // name (role img).
    const placeholder = screen.getByRole("img", {
      name: "Main Gallery · Entrance sightline"
    });
    expect(placeholder).toHaveClass("saved-view-placeholder");

    cleanup();

    renderPanel(project, { "view-1": "blob:thumb" });
    const image = screen.getByRole("img", {
      name: "Main Gallery · Entrance sightline"
    });
    expect(image.tagName).toBe("IMG");
    expect(image).toHaveAttribute("src", "blob:thumb");
  });

  it("renames a view: commit on Enter, cancel on Escape", async () => {
    const { onRenameSavedView } = renderPanel(
      projectWithViews([savedView({ title: "Entrance sightline" })])
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Rename Main Gallery · Entrance sightline"
      })
    );
    const input = screen.getByRole("textbox", {
      name: "Rename Main Gallery · Entrance sightline"
    });

    // Escape cancels without a store write.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRenameSavedView).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", {
        name: "Rename Main Gallery · Entrance sightline"
      })
    ).not.toBeInTheDocument();

    // Reopen and commit via the form (Enter submits).
    fireEvent.click(
      screen.getByRole("button", {
        name: "Rename Main Gallery · Entrance sightline"
      })
    );
    const reopened = screen.getByRole("textbox", {
      name: "Rename Main Gallery · Entrance sightline"
    });
    fireEvent.change(reopened, { target: { value: "Doorway reveal" } });
    fireEvent.submit(reopened);

    await waitFor(() =>
      expect(onRenameSavedView).toHaveBeenCalledWith("view-1", "Doorway reveal")
    );
  });

  it("deletes through the applyEdit-backed callback, no confirm", () => {
    const { onDeleteSavedView } = renderPanel(
      projectWithViews([savedView({ title: "Entrance sightline" })])
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete Main Gallery · Entrance sightline"
      })
    );
    expect(onDeleteSavedView).toHaveBeenCalledWith("view-1");
  });

  it("flags an invalid-pose row, keeps delete, and is not openable", () => {
    const { onOpenView } = renderPanel(
      projectWithViews([
        savedView({ title: "Broken angle", pose: degeneratePose })
      ])
    );

    expect(screen.getByText("Invalid camera pose.")).toBeInTheDocument();
    // No open affordance (the row is inert — no button role), and no rename.
    const row = screen.getByText("Main Gallery · Broken angle").closest("li");
    expect(row).not.toHaveAttribute("role", "button");
    expect(
      screen.queryByRole("button", {
        name: "Rename Main Gallery · Broken angle"
      })
    ).not.toBeInTheDocument();
    // Delete stays.
    expect(
      screen.getByRole("button", {
        name: "Delete Main Gallery · Broken angle"
      })
    ).toBeInTheDocument();

    // Clicking the row's copy does nothing.
    fireEvent.click(screen.getByText("Main Gallery · Broken angle"));
    expect(onOpenView).not.toHaveBeenCalled();
  });

  it("preserves creation order across the rows", () => {
    const { container } = render(
      <TooltipProvider>
        <SavedViewsPanel
          project={projectWithViews([
            savedView({ id: "view-1", ordinal: 1, title: "First" }),
            savedView({ id: "view-2", ordinal: 2, title: "Second" }),
            savedView({ id: "view-3", ordinal: 3, title: "Third" })
          ])}
          thumbnailUrls={{}}
          onOpenView={vi.fn()}
          onRenameSavedView={vi.fn().mockResolvedValue(undefined)}
          onDeleteSavedView={vi.fn().mockResolvedValue(undefined)}
        />
      </TooltipProvider>
    );

    const titles = Array.from(
      container.querySelectorAll(".saved-view-copy strong")
    ).map((node) => node.textContent);
    expect(titles).toEqual([
      "Main Gallery · First",
      "Main Gallery · Second",
      "Main Gallery · Third"
    ]);
  });
});
