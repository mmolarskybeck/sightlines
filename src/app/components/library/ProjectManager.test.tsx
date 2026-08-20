import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "../../../domain/project";
import type { CloudProjectFolder, SyncHeadListing } from "../../cloud/provider";
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

// The sync head for that same folder: the full project id, of which the folder
// name carries only the first 8 chars.
const syncHeads: SyncHeadListing[] = [
  {
    projectId: "aabbccdd-1111-2222-3333-444455556666",
    path: "/projects/aabbccdd-1111-2222-3333-444455556666/current.sightlines",
    rev: "0123456789abcdef",
    serverModifiedIso: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    sizeBytes: 8192
  }
];

// A head no folder accounts for: sync writes the head immediately, so a project
// synced right after it was created has one of these and no backups at all.
const loneHead: SyncHeadListing = {
  projectId: "deadbeef-1111-2222-3333-444455556666",
  path: "/projects/deadbeef-1111-2222-3333-444455556666/current.sightlines",
  rev: "fedcba9876543210",
  serverModifiedIso: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  sizeBytes: 8192
};

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
    onOpenSyncedCloudProject: vi.fn().mockResolvedValue(true),
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
        cloudSyncHeads={null}
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

  // Stage 2's label rule: "sync" appears only where a canonical copy really
  // exists. A folder with a head and no local counterpart is the device-handoff
  // row — pressing Open links this device to it, so the meta line says so.
  it("words a head-backed absent folder as synced, not as a backup to restore", async () => {
    renderWithCloud({ cloudSyncHeads: syncHeads });
    await screen.findByText("In Dropbox");

    expect(screen.getByText("Not on this device")).toBeInTheDocument();
    expect(
      screen.getByText("Synced 1 h ago · opens here and keeps syncing")
    ).toBeInTheDocument();
    expect(screen.queryByText(/5 backups/)).not.toBeInTheDocument();
  });

  // A prefix match with something already here keeps the stage-1 copy path
  // exactly: copies are never linked, so the row must not promise syncing.
  it("keeps restore language and the copy offer when a local project matches", async () => {
    const { onOpenCloudProject } = renderWithCloud({
      cloudProjects: [{ ...cloudFolders[0]!, projectIdPrefix: "project-" }],
      cloudSyncHeads: [{ ...syncHeads[0]!, projectId: "project-1" }]
    });
    await screen.findByText("In Dropbox");

    expect(screen.getByText(/5 backups/)).toBeInTheDocument();
    expect(screen.queryByText(/keeps syncing/)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Save a copy of Autumn Survey from Dropbox" })
    );

    await waitFor(() => expect(onOpenCloudProject).toHaveBeenCalled());
  });

  // A heads listing that failed is not evidence that nothing is synced, and it
  // must not cost the user the backups they opened this dialog for.
  it("still lists the backup folders when the heads listing is unavailable", async () => {
    renderWithCloud({ cloudSyncHeads: null });
    await screen.findByText("In Dropbox");

    expect(screen.getByText("Autumn Survey")).toBeInTheDocument();
    expect(screen.getByText("Backed up 2 h ago · 5 backups")).toBeInTheDocument();
  });

  // The 8-char prefix is a display guess. Two heads under one prefix means the
  // row cannot say which project it would open, so it says nothing about sync.
  it("falls back to backup language when two heads share the folder's prefix", async () => {
    renderWithCloud({
      cloudSyncHeads: [
        syncHeads[0]!,
        { ...syncHeads[0]!, projectId: "aabbccdd-9999-8888-7777-666655554444" }
      ]
    });
    await screen.findByText("In Dropbox");

    expect(screen.getByText("Backed up 2 h ago · 5 backups")).toBeInTheDocument();
  });

  // The device-handoff case stage 2 exists for: the project is in the account,
  // this device doesn't have it, and no backup folder was ever written.
  it("gives a project that only has a synced copy a row of its own", async () => {
    const { onOpenSyncedCloudProject, onOpenCloudProject, onOpenChange } = renderWithCloud({
      cloudProjects: [],
      cloudSyncHeads: [loneHead]
    });
    await screen.findByText("In Dropbox");

    // No title to show — a head file has none — so the row says what it is and
    // carries the short code that separates two of them.
    expect(screen.getByText("Synced project")).toBeInTheDocument();
    expect(screen.getByText("deadbeef")).toBeInTheDocument();
    expect(screen.getByText(/opens here and keeps syncing/)).toBeInTheDocument();
    // A section holding one synced project is not an empty section.
    expect(screen.queryByText("No cloud backups yet.")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Open synced project deadbeef from Dropbox" })
    );

    await waitFor(() => expect(onOpenSyncedCloudProject).toHaveBeenCalledWith(loneHead));
    expect(onOpenCloudProject).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows no row for a synced project already on this device", async () => {
    renderWithCloud({
      cloudProjects: [],
      cloudSyncHeads: [{ ...loneHead, projectId: "project-2" }]
    });
    await screen.findByText("In Dropbox");

    expect(screen.queryByText("Synced project")).not.toBeInTheDocument();
    expect(screen.getByText("No cloud backups yet.")).toBeInTheDocument();
  });

  it("disables a synced project's row while its open is in flight", async () => {
    renderWithCloud({
      cloudProjects: [],
      cloudSyncHeads: [loneHead],
      cloudProjectOpening: `sync:${loneHead.projectId}`
    });
    await screen.findByText("In Dropbox");

    const action = screen.getByRole("button", {
      name: "Open synced project deadbeef from Dropbox"
    });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("aria-busy", "true");
  });

  // Degrading loudly: the rows still open (blocking a recovery would be worse),
  // but the user is told the link may not survive it, and how to get it back.
  it("says so when sync state couldn't be read, and only then", async () => {
    renderWithCloud({ cloudSyncHeads: null });
    await screen.findByText("In Dropbox");

    expect(
      screen.getByText(/Couldn't check which projects sync across devices/)
    ).toBeInTheDocument();
    expect(screen.getByText(/turn syncing on after it opens/)).toBeInTheDocument();
    // Still offers the restore it always did.
    expect(
      screen.getByRole("button", { name: "Open Autumn Survey from Dropbox" })
    ).toBeInTheDocument();

    // A listing that simply hasn't run yet wears the same null.
    cleanup();
    renderWithCloud({ cloudProjects: null, cloudProjectsStatus: "loading", cloudSyncHeads: null });
    await screen.findByText("In Dropbox");
    expect(
      screen.queryByText(/Couldn't check which projects sync across devices/)
    ).not.toBeInTheDocument();

    // Neither does a listing that came back with heads.
    cleanup();
    renderWithCloud({ cloudSyncHeads: [] });
    await screen.findByText("In Dropbox");
    expect(
      screen.queryByText(/Couldn't check which projects sync across devices/)
    ).not.toBeInTheDocument();
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
