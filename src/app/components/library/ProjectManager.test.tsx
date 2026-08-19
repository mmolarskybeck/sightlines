import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../../../domain/project";
import type { CloudProjectFolder } from "../../cloud/provider";
import { TooltipProvider } from "../ui/tooltip";
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

// The folder name carries only the first 8 chars of the project UUID, so
// "project-1" can never be matched by one — these fixtures stay deliberately
// unmatched unless a test says otherwise.
const cloudFolders: CloudProjectFolder[] = [
  {
    folderName: "Autumn Survey — aabbccdd",
    title: "Autumn Survey",
    projectIdPrefix: "aabbccdd",
    backupCount: 5,
    latestBackup: {
      path: "/backups/Autumn Survey — aabbccdd/2026-08-19.sightlines",
      name: "2026-08-19.sightlines",
      serverModifiedIso: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      sizeBytes: 4096
    }
  }
];

function renderManager(overrides: Partial<Parameters<typeof ProjectManager>[0]> = {}) {
  const handlers = {
    onOpenChange: vi.fn(),
    onCreateProject: vi.fn().mockResolvedValue(undefined),
    onDuplicateProject: vi.fn().mockResolvedValue(undefined),
    onRenameProject: vi.fn().mockResolvedValue(undefined),
    onDeleteProject: vi.fn().mockResolvedValue(undefined),
    onOpenProject: vi.fn().mockResolvedValue(undefined),
    onExportProject: vi.fn().mockResolvedValue(undefined),
    onRefreshCloudProjects: vi.fn().mockResolvedValue(undefined),
    onOpenCloudProject: vi.fn().mockResolvedValue(true),
    onReconnectCloudBackup: vi.fn().mockResolvedValue(undefined)
  };
  const listProjectSummaries = vi.fn().mockResolvedValue(summaries);

  render(
    <TooltipProvider>
      <ProjectManager
        cloudBackupConfigured={false}
        cloudBackupProviderStatus="disconnected"
        cloudProjectOpening={null}
        cloudProjects={null}
        cloudProjectsStatus="idle"
        currentProjectId="project-1"
        listProjectSummaries={listProjectSummaries}
        open
        {...handlers}
        {...overrides}
      />
    </TooltipProvider>
  );

  return { ...handlers, listProjectSummaries };
}

// The section only exists for a configured, linked provider.
function renderWithCloud(overrides: Partial<Parameters<typeof ProjectManager>[0]> = {}) {
  return renderManager({
    cloudBackupConfigured: true,
    cloudBackupProviderStatus: "connected",
    cloudProjects: cloudFolders,
    cloudProjectsStatus: "loaded",
    ...overrides
  });
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

  it("duplicates a row, opens the copy, and closes the modal", async () => {
    const { onDuplicateProject, onOpenChange } = renderManager();
    await screen.findByText("Summer Rotation");

    fireEvent.click(screen.getByRole("button", { name: "Duplicate Summer Rotation" }));

    await waitFor(() => expect(onDuplicateProject).toHaveBeenCalledWith("project-2"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ProjectManager cloud projects", () => {
  it("shows nothing new when the provider is unconfigured or unlinked", async () => {
    const { onRefreshCloudProjects } = renderManager();
    await screen.findByText("Summer Rotation");

    expect(screen.queryByText("In Dropbox")).not.toBeInTheDocument();
    expect(onRefreshCloudProjects).not.toHaveBeenCalled();

    cleanup();
    renderManager({ cloudBackupConfigured: true, cloudBackupProviderStatus: "disconnected" });
    await screen.findByText("Summer Rotation");
    expect(screen.queryByText("In Dropbox")).not.toBeInTheDocument();
  });

  it("lists each cloud folder with its backup meta and refreshes on open", async () => {
    const { onRefreshCloudProjects } = renderWithCloud();

    expect(await screen.findByText("In Dropbox")).toBeInTheDocument();
    expect(screen.getByText("Autumn Survey")).toBeInTheDocument();
    expect(screen.getByText("Backed up 2 h ago · 5 backups")).toBeInTheDocument();
    expect(onRefreshCloudProjects).toHaveBeenCalled();
  });

  it("tags a folder with no local counterpart and offers to open it", async () => {
    const { onOpenCloudProject, onOpenChange } = renderWithCloud();
    await screen.findByText("In Dropbox");

    expect(screen.getByText("Not on this device")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Autumn Survey from Dropbox" }));

    await waitFor(() => expect(onOpenCloudProject).toHaveBeenCalledWith(cloudFolders[0]));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers only a copy — and drops the tag — when a local project id matches", async () => {
    const { onOpenCloudProject } = renderWithCloud({
      cloudProjects: [{ ...cloudFolders[0]!, projectIdPrefix: "project-" }]
    });
    await screen.findByText("In Dropbox");

    expect(screen.queryByText("Not on this device")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Autumn Survey from Dropbox" })
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Save a copy of Autumn Survey from Dropbox" })
    );

    await waitFor(() => expect(onOpenCloudProject).toHaveBeenCalled());
  });

  it("keeps the dialog open when the import did not go through", async () => {
    const { onOpenChange } = renderWithCloud({
      onOpenCloudProject: vi.fn().mockResolvedValue(false)
    });
    await screen.findByText("In Dropbox");

    fireEvent.click(screen.getByRole("button", { name: "Open Autumn Survey from Dropbox" }));

    await waitFor(() => expect(onOpenChange).not.toHaveBeenCalled());
  });

  it("disables the row's action while a restore is in flight", async () => {
    renderWithCloud({ cloudProjectOpening: cloudFolders[0]!.folderName });
    await screen.findByText("In Dropbox");

    const action = screen.getByRole("button", { name: "Open Autumn Survey from Dropbox" });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("aria-busy", "true");
  });

  it("offers Reconnect instead of rows when the grant lapsed", async () => {
    const { onReconnectCloudBackup } = renderWithCloud({
      cloudBackupProviderStatus: "reauthorization-required",
      cloudProjects: null,
      cloudProjectsStatus: "reauth-required"
    });
    await screen.findByText("In Dropbox");

    expect(
      screen.getByText(/Reconnect Dropbox to browse your cloud backups\./)
    ).toBeInTheDocument();
    expect(screen.queryByText("Autumn Survey")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(onReconnectCloudBackup).toHaveBeenCalled());
  });

  it("offers Retry when the listing failed", async () => {
    const { onRefreshCloudProjects } = renderWithCloud({
      cloudProjects: null,
      cloudProjectsStatus: "error"
    });
    await screen.findByText("In Dropbox");
    onRefreshCloudProjects.mockClear();

    expect(screen.getByText(/Couldn't reach Dropbox\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onRefreshCloudProjects).toHaveBeenCalled());
  });

  it("says there are no cloud backups only after a successful empty listing", async () => {
    renderWithCloud({ cloudProjects: [], cloudProjectsStatus: "loaded" });
    await screen.findByText("In Dropbox");
    expect(screen.getByText("No cloud backups yet.")).toBeInTheDocument();

    cleanup();
    renderWithCloud({ cloudProjects: null, cloudProjectsStatus: "loading" });
    await screen.findByText("In Dropbox");
    expect(screen.getByText("Checking Dropbox…")).toBeInTheDocument();
    expect(screen.queryByText("No cloud backups yet.")).not.toBeInTheDocument();
  });
});
