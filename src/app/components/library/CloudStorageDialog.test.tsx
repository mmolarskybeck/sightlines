import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorageFile, StorageInventory } from "../../cloud/provider";
import { planBackupTrim } from "../../cloud/storagePlan";
import { useAppStore } from "../../store";
import { CloudStorageDialog } from "./CloudStorageDialog";

// Same stand-in as SettingsDialog.test.tsx: Radix Select inside a Radix Dialog
// fights over focus in jsdom only. Keep the roles and onValueChange contract.
vi.mock("../ui/select", async () => {
  const { createContext, useContext } = await import("react");
  const Ctx = createContext<{ value?: string; onValueChange?: (value: string) => void }>({});
  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>,
    SelectTrigger: ({ children, ...props }: React.ComponentProps<"button">) => (
      <button type="button" role="combobox" {...props}>
        {children}
      </button>
    ),
    SelectValue: () => {
      const ctx = useContext(Ctx);
      return <span>{ctx.value}</span>;
    },
    SelectContent: ({ children }: { children: React.ReactNode }) => (
      <div role="listbox">{children}</div>
    ),
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const ctx = useContext(Ctx);
      return (
        <button type="button" role="option" onClick={() => ctx.onValueChange?.(value)}>
          {children}
        </button>
      );
    }
  };
});

const initialStoreState = useAppStore.getState();

afterEach(() => {
  cleanup();
  useAppStore.setState(initialStoreState, true);
});

const PROJECT_ID = "1a2b3c4d-1111-2222-3333-444455556666";
const FOLDER = "/backups/Winter Show — 1a2b3c4d";

function backup(day: number): StorageFile {
  const name = `2026-08-0${day}.sightlines`;
  return {
    path: `${FOLDER}/${name}`,
    name,
    sizeBytes: 1_000_000,
    serverModifiedIso: `2026-08-0${day}T10:00:00.000Z`,
    rev: `rev-${day}`
  };
}

const SHARE: StorageFile = {
  path: "/shares/Winter Show — 1a2b3c4d/share-1.sightlines",
  name: "share-1.sightlines",
  sizeBytes: 2_000_000,
  serverModifiedIso: "2026-08-15T12:00:00.000Z",
  rev: "share-rev"
};

const INVENTORY: StorageInventory = {
  groups: [
    {
      key: PROJECT_ID,
      projectId: PROJECT_ID,
      idPrefix: "1a2b3c4d",
      title: "Winter Show",
      head: {
        path: `/projects/${PROJECT_ID}/current.sightlines`,
        name: "current.sightlines",
        sizeBytes: 3_000_000,
        serverModifiedIso: "2026-08-20T10:00:00.000Z",
        rev: "head-rev"
      },
      backupFolders: [
        {
          path: FOLDER,
          folderName: "Winter Show — 1a2b3c4d",
          backups: [1, 2, 3, 4, 5, 6].map(backup)
        }
      ],
      shares: [SHARE]
    },
    {
      key: "deadbeef-0000",
      projectId: "deadbeef-0000",
      idPrefix: "deadbeef",
      title: null,
      head: {
        path: "/projects/deadbeef-0000/current.sightlines",
        name: "current.sightlines",
        sizeBytes: 500_000,
        serverModifiedIso: "2026-08-20T10:00:00.000Z",
        rev: "head-rev-2"
      },
      backupFolders: [],
      shares: []
    }
  ],
  otherFiles: [],
  usage: { usedBytes: 1_000_000_000, allocatedBytes: 2_000_000_000 },
  listedAtIso: "2026-08-20T12:00:00.000Z"
};

function seed(overrides: Record<string, unknown> = {}) {
  const actions = {
    refreshCloudStorage: vi.fn().mockResolvedValue(undefined),
    applyBackupTrim: vi.fn().mockResolvedValue(null),
    removeCloudShare: vi.fn().mockResolvedValue(null),
    clearCloudStorageResult: vi.fn(),
    connectCloudBackup: vi.fn().mockResolvedValue(undefined)
  };
  useAppStore.setState({
    cloudStorage: INVENTORY,
    cloudStorageStatus: "loaded",
    cloudStorageError: null,
    cloudStorageSettings: null,
    cloudStorageBusy: null,
    cloudStorageLastResult: null,
    ...actions,
    ...overrides
  });
  render(
    <CloudStorageDialog
      localProjects={[{ id: PROJECT_ID, title: "Winter Show (local)" }]}
      open
      onOpenChange={vi.fn()}
    />
  );
  return actions;
}

describe("CloudStorageDialog", () => {
  it("refreshes on open and shows space used plus the Sightlines total", () => {
    const actions = seed();
    expect(actions.clearCloudStorageResult).toHaveBeenCalledTimes(1);
    expect(actions.refreshCloudStorage).toHaveBeenCalledTimes(1);

    const usage = screen.getByRole("region", { name: "Space used" });
    expect(within(usage).getByText("1.00 GB of 2.00 GB used")).toBeInTheDocument();
    expect(within(usage).getByRole("progressbar", { name: "Dropbox space used" })).toBeInTheDocument();
    // 6 backups (6 MB) + share (2 MB) + heads (3.5 MB).
    expect(within(usage).getByText(/Sightlines files: 11\.5 MB\./)).toBeInTheDocument();
  });

  it("lists each project with its title, device tag, and breakdown", () => {
    seed();
    const list = screen.getByRole("list", { name: "Stored projects" });
    expect(within(list).getByText("Winter Show")).toBeInTheDocument();
    expect(within(list).getByText("On this device")).toBeInTheDocument();
    expect(
      within(list).getByText(
        "11.0 MB · Synced copy 3.0 MB · 6 backups, 6.0 MB · 1 shared link, 2.0 MB"
      )
    ).toBeInTheDocument();
    // A head-only project with no local counterpart.
    expect(within(list).getByText("Synced project deadbeef")).toBeInTheDocument();
    expect(within(list).getAllByText("On this device")).toHaveLength(1);
  });

  it("previews a trim for the selected limit and applies exactly that plan", () => {
    const actions = seed();
    // Default limit 5 of 6 backups.
    expect(
      screen.getByText(/Removes 1 older backup from 1 project folder, about 1\.0 MB\./)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "Newest 2 backups" }));
    expect(
      screen.getByText(/Removes 4 older backups from 1 project folder, about 4\.0 MB\./)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove 4 older backups" }));
    expect(actions.applyBackupTrim).toHaveBeenCalledWith(planBackupTrim(INVENTORY, 2));
  });

  it("says every project is within the saved limit", () => {
    seed({ cloudStorage: { ...INVENTORY, groups: [] } });
    expect(screen.getByText("Every project is within this limit.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /older backup/ })).not.toBeInTheDocument();
  });

  it("offers a saved limit that isn't a standard choice", () => {
    seed({ cloudStorageSettings: { backupsPerProject: 4 } });
    expect(screen.getByRole("option", { name: "Newest 4 backups" })).toBeInTheDocument();
  });

  it("keeps cached rows but shows a failed refresh with a retry", () => {
    const actions = seed({ cloudStorageStatus: "error", cloudStorageError: "Could not list Dropbox storage." });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not list Dropbox storage. The figures below may be out of date."
    );
    expect(screen.getByRole("list", { name: "Stored projects" })).toBeInTheDocument();
    const callsBefore = actions.refreshCloudStorage.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(actions.refreshCloudStorage.mock.calls.length).toBe(callsBefore + 1);
  });

  it("disables the trim button while busy", () => {
    seed({ cloudStorageBusy: "trim" });
    const button = screen.getByRole("button", { name: "Remove 1 older backup" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("reports a trim result", () => {
    seed({
      cloudStorageLastResult: {
        kind: "trim",
        removedCount: 3,
        removedBytes: 3_000_000,
        skippedCount: 1,
        failedCount: 0,
        settingSaved: false
      }
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Removed 3 backups (3.0 MB). 1 backup changed since the preview and was left alone. The new limit couldn't be saved to Dropbox, so future backups still keep the newest 5."
    );
  });

  it("confirms before removing a shared link", () => {
    const actions = seed();
    fireEvent.click(screen.getByRole("button", { name: "Shared links (1)" }));
    const label = SHARE.name.replace(/\.sightlines$/i, "");

    fireEvent.click(screen.getByRole("button", { name: `Remove shared link ${label}` }));
    // The confirm names the snapshot, so two links shared the same day can't be confused.
    expect(screen.getByText(new RegExp(`Remove the link to “${label}”`))).toBeInTheDocument();
    expect(screen.getByText(/stops working\s+for anyone you sent it to/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Remove link" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Remove shared link ${label}` }));
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    expect(actions.removeCloudShare).toHaveBeenCalledWith(SHARE);
  });

  it("asks to reconnect when the grant lapsed", () => {
    const actions = seed({ cloudStorageStatus: "reauth-required" });
    expect(screen.getByText("Reconnect Dropbox to manage storage.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Dropbox" }));
    expect(actions.connectCloudBackup).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("list", { name: "Stored projects" })).not.toBeInTheDocument();
  });

  it("shows a loading state before the first listing", () => {
    seed({ cloudStorage: null, cloudStorageStatus: "loading" });
    expect(screen.getByText("Reading your Dropbox…")).toBeInTheDocument();
  });
});
