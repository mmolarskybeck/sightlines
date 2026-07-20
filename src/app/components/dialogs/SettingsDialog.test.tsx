import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Project } from "../../../domain/project";
import { useAppStore } from "../../store";
import { SettingsDialog } from "./SettingsDialog";

// The status copy is provided by the storage-persistence hook; stub it so this
// suite is standalone (and independent of the copy's exact wording) and so a
// distinctive per-state string is easy to assert against.
vi.mock("../../hooks/useStoragePersistence", () => ({
  getStorageNoteCopy: (state: string) => `storage-copy:${state}`
}));

// Radix Select portals its listbox OUTSIDE the Radix Dialog's DOM subtree, so
// opening it inside the dialog sets the two libraries' focus scopes fighting
// over focus — an infinite recursion that only manifests in jsdom (real
// browsers are fine). Swap in tiny primitives that keep the same roles and the
// onValueChange contract so the unit-select wiring is testable without the
// focus war. The component's real Radix Select is unchanged in production.
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

// Radix Select drives itself through Pointer Events + scrollIntoView, none of
// which jsdom implements. Stub them so the trigger can open and an item can be
// chosen the way it would in a real browser.
beforeAll(() => {
  const proto = window.HTMLElement.prototype;
  proto.hasPointerCapture = vi.fn();
  proto.setPointerCapture = vi.fn();
  proto.releasePointerCapture = vi.fn();
  proto.scrollIntoView = vi.fn();
});

const initialStoreState = useAppStore.getState();

afterEach(() => {
  cleanup();
  useAppStore.setState(initialStoreState, true);
});

function fakeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    title: "Gallery One",
    unit: "in",
    defaultWallHeightMm: 2743.2,
    defaultCenterlineHeightMm: 1473.2,
    ...overrides
  } as unknown as Project;
}

function seedStore(overrides: Record<string, unknown> = {}) {
  const actions = {
    renameProject: vi.fn().mockResolvedValue(undefined),
    setUnit: vi.fn().mockResolvedValue(undefined),
    setDefaultWallHeightMm: vi.fn().mockResolvedValue(undefined),
    setDefaultCenterlineHeightMm: vi.fn().mockResolvedValue(undefined),
    deleteProject: vi.fn().mockResolvedValue(undefined)
  };
  useAppStore.setState({
    project: fakeProject(),
    ...actions,
    ...overrides
  });
  return actions;
}

type CloudProps = {
  cloudBackupConfigured?: boolean;
  cloudBackupProviderStatus?: "disconnected" | "connected" | "reauthorization-required";
  cloudBackupAccountLabel?: string | null;
  cloudBackupStatus?: "idle" | "uploading" | "error";
  lastCloudBackupAt?: string | null;
};

type RenderOverrides = {
  open?: boolean;
  storageState?: "unsupported" | "granted" | "denied" | "pending";
  store?: Record<string, unknown>;
  cloud?: CloudProps;
};

function renderDialog({
  open = true,
  storageState = "granted",
  store = {},
  cloud = {}
}: RenderOverrides = {}) {
  const actions = seedStore(store);
  const handlers = {
    onOpenChange: vi.fn(),
    onRetryStorage: vi.fn(),
    onConnectCloudBackup: vi.fn(async () => {}),
    onDisconnectCloudBackup: vi.fn(),
    onRunCloudBackup: vi.fn(async () => {}),
    resetPreferences: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onOpenHelp: vi.fn(),
    onUsageAnalyticsChange: vi.fn(() => true),
    onCrashReportsChange: vi.fn(() => true)
  };
  render(
    <SettingsDialog
      open={open}
      storageState={storageState}
      cloudBackupConfigured={cloud.cloudBackupConfigured ?? false}
      cloudBackupProviderStatus={cloud.cloudBackupProviderStatus ?? "disconnected"}
      cloudBackupAccountLabel={cloud.cloudBackupAccountLabel ?? null}
      cloudBackupStatus={cloud.cloudBackupStatus ?? "idle"}
      lastCloudBackupAt={cloud.lastCloudBackupAt ?? null}
      usageAnalyticsEnabled={false}
      crashReportsEnabled={false}
      {...handlers}
    />
  );
  return { ...actions, ...handlers };
}

describe("SettingsDialog", () => {
  it("renders both sections when open and nothing when closed", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Storage & data" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    cleanup();

    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not delete on the first click, deletes once on confirm, and cancels cleanly", () => {
    const { deleteProject, onOpenChange } = renderDialog();

    // First click only opens the confirmation — nothing is deleted yet.
    fireEvent.click(screen.getByRole("button", { name: "Delete this project" }));
    expect(deleteProject).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete .Gallery One/)).toBeInTheDocument();

    // Cancel dismisses without deleting.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteProject).not.toHaveBeenCalled();

    // Reopen and confirm — exactly one delete with the project id, both dialogs close.
    fireEvent.click(screen.getByRole("button", { name: "Delete this project" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteProject).toHaveBeenCalledTimes(1);
    expect(deleteProject).toHaveBeenCalledWith("project-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers 'Request durable storage' only when storage was denied", () => {
    renderDialog({ storageState: "granted" });
    expect(
      screen.queryByRole("button", { name: "Request durable storage" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("storage-copy:granted")).toBeInTheDocument();

    cleanup();

    renderDialog({ storageState: "denied" });
    expect(
      screen.getByRole("button", { name: "Request durable storage" })
    ).toBeInTheDocument();
  });

  it("routes retry to onRetryStorage", () => {
    const { onRetryStorage } = renderDialog({ storageState: "denied" });
    fireEvent.click(screen.getByRole("button", { name: "Request durable storage" }));
    expect(onRetryStorage).toHaveBeenCalledTimes(1);
  });

  it("commits a unit change through setUnit", () => {
    const { setUnit } = renderDialog();

    fireEvent.click(screen.getByRole("option", { name: "Centimeters (cm)" }));

    expect(setUnit).toHaveBeenCalledWith("cm");
  });

  it("resets workspace preferences without confirmation", () => {
    const { resetPreferences } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Reset workspace preferences" }));
    expect(resetPreferences).toHaveBeenCalledTimes(1);
  });

  it("changes anonymous usage and crash reporting independently", () => {
    const { onUsageAnalyticsChange, onCrashReportsChange } = renderDialog();

    fireEvent.click(screen.getByRole("switch", { name: "Anonymous usage analytics" }));
    expect(onUsageAnalyticsChange).toHaveBeenCalledWith(true);
    expect(onCrashReportsChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("switch", { name: "Anonymous crash reports" }));
    expect(onCrashReportsChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("link", { name: "Read the privacy policy" })).toHaveAttribute(
      "href",
      "https://sightlines.art/privacy"
    );
  });

  it("shows the connected cloud block with a working Back up now action", () => {
    const { onRunCloudBackup, onDisconnectCloudBackup } = renderDialog({
      cloud: {
        cloudBackupConfigured: true,
        cloudBackupProviderStatus: "connected",
        cloudBackupAccountLabel: "Test Curator",
        lastCloudBackupAt: "2026-07-19T11:58:00Z"
      }
    });

    expect(screen.getByText("Connected as Test Curator")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    expect(onRunCloudBackup).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onDisconnectCloudBackup).toHaveBeenCalledTimes(1);
  });

  it("disables Back up now while an upload is in flight", () => {
    renderDialog({
      cloud: {
        cloudBackupConfigured: true,
        cloudBackupProviderStatus: "connected",
        cloudBackupAccountLabel: "Test Curator",
        cloudBackupStatus: "uploading"
      }
    });
    expect(screen.getByRole("button", { name: "Backing up…" })).toBeDisabled();
  });

  it("offers reconnect with a caution note when reauthorization is required", () => {
    const { onConnectCloudBackup } = renderDialog({
      cloud: {
        cloudBackupConfigured: true,
        cloudBackupProviderStatus: "reauthorization-required"
      }
    });
    expect(screen.getByText(/Dropbox access expired/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Dropbox" }));
    expect(onConnectCloudBackup).toHaveBeenCalledTimes(1);
  });

  it("surfaces preference write failures", () => {
    const { onUsageAnalyticsChange } = renderDialog();
    onUsageAnalyticsChange.mockReturnValue(false);
    fireEvent.click(screen.getByRole("switch", { name: "Anonymous usage analytics" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Reporting remains off");
  });
});
