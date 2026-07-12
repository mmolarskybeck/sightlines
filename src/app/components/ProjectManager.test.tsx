import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../../domain/project";
import { ProjectManager } from "./ProjectManager";

afterEach(cleanup);

const summaries: ProjectSummary[] = [
  {
    id: "project-1",
    title: "Winter Show",
    updatedAt: "2026-01-05T00:00:00.000Z",
    roomCount: 3,
    artworkCount: 12
  },
  {
    id: "project-2",
    title: "Summer Rotation",
    updatedAt: "2026-01-02T00:00:00.000Z",
    roomCount: 1,
    artworkCount: 4
  }
];

function renderManager(overrides: Partial<Parameters<typeof ProjectManager>[0]> = {}) {
  const handlers = {
    onOpenChange: vi.fn(),
    onCreateProject: vi.fn().mockResolvedValue(undefined),
    onRenameProject: vi.fn().mockResolvedValue(undefined),
    onDeleteProject: vi.fn().mockResolvedValue(undefined),
    onOpenProject: vi.fn().mockResolvedValue(undefined),
    onExportProject: vi.fn().mockResolvedValue(undefined)
  };
  const listProjectSummaries = vi.fn().mockResolvedValue(summaries);

  render(
    <ProjectManager
      currentProjectId="project-1"
      listProjectSummaries={listProjectSummaries}
      open
      {...handlers}
      {...overrides}
    />
  );

  return { ...handlers, listProjectSummaries };
}

describe("ProjectManager", () => {
  it("lists every saved project with its room/work counts and marks the open one", async () => {
    renderManager();

    expect(await screen.findByRole("button", { name: /^Winter Show/ })).toBeInTheDocument();
    expect(screen.getByText("Summer Rotation")).toBeInTheDocument();
    expect(screen.getByText(/3 rooms · 12 works/)).toBeInTheDocument();
    expect(screen.getByText(/1 room · 4 works/)).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    renderManager({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates a project with the next untitled name and closes the modal", async () => {
    const { onCreateProject, onOpenChange } = renderManager();
    await screen.findByText("Summer Rotation");

    fireEvent.click(screen.getByRole("button", { name: "New project" }));

    await waitFor(() => expect(onCreateProject).toHaveBeenCalledWith("Untitled Exhibition"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens a non-current project and closes the modal; clicking the current row just closes", async () => {
    const { onOpenProject, onOpenChange } = renderManager();
    await screen.findByText("Summer Rotation");

    fireEvent.click(screen.getByText("Summer Rotation"));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("project-2"));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^Winter Show/ }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onOpenProject).not.toHaveBeenCalledWith("project-1");
  });

  it("renames a row inline without touching the other rows", async () => {
    const { onRenameProject } = renderManager();
    await screen.findByText("Summer Rotation");

    fireEvent.click(screen.getByRole("button", { name: "Rename Summer Rotation" }));
    const input = screen.getByRole("textbox", { name: "Rename Summer Rotation" });
    fireEvent.change(input, { target: { value: "Autumn Rotation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save project name" }));

    await waitFor(() =>
      expect(onRenameProject).toHaveBeenCalledWith("project-2", "Autumn Rotation")
    );
  });

  it("cancelling a rename discards the draft", async () => {
    const { onRenameProject } = renderManager();
    await screen.findByText("Summer Rotation");

    fireEvent.click(screen.getByRole("button", { name: "Rename Summer Rotation" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rename Summer Rotation" }), {
      target: { value: "Autumn Rotation" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel rename" }));

    expect(onRenameProject).not.toHaveBeenCalled();
    expect(screen.getByText("Summer Rotation")).toBeInTheDocument();
  });

  it("deletes only on the second click (two-step inline confirm, no window.confirm)", async () => {
    const { onDeleteProject } = renderManager();
    await screen.findByText("Summer Rotation");

    fireEvent.click(screen.getByRole("button", { name: "Delete Summer Rotation" }));
    expect(onDeleteProject).not.toHaveBeenCalled();
    expect(screen.getByText("Delete?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleteProject).toHaveBeenCalledWith("project-2"));
  });

  it("cancelling a delete confirm leaves the project untouched", async () => {
    const { onDeleteProject } = renderManager();
    await screen.findByText("Summer Rotation");

    fireEvent.click(screen.getByRole("button", { name: "Delete Summer Rotation" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel delete" }));

    expect(onDeleteProject).not.toHaveBeenCalled();
    expect(screen.queryByText("Delete?")).not.toBeInTheDocument();
  });

  it("exports a row through onExportProject", async () => {
    const { onExportProject } = renderManager();
    await screen.findByText("Summer Rotation");

    fireEvent.click(screen.getByRole("button", { name: "Export Summer Rotation" }));

    await waitFor(() => expect(onExportProject).toHaveBeenCalledWith("project-2"));
  });
});
