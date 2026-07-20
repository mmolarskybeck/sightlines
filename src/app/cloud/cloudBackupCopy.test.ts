import { describe, expect, it } from "vitest";
import {
  formatBackupRelativeTime,
  getCloudBackupMenuItem,
  getCloudBackupPopoverState,
  getStatusBadgeDisplay
} from "./cloudBackupCopy";

const NOW = Date.parse("2026-07-19T12:00:00Z");

describe("formatBackupRelativeTime", () => {
  it("reads just now / minutes / hours / days", () => {
    expect(formatBackupRelativeTime("2026-07-19T11:59:40Z", NOW)).toBe("just now");
    expect(formatBackupRelativeTime("2026-07-19T11:58:00Z", NOW)).toBe("2 m ago");
    expect(formatBackupRelativeTime("2026-07-19T09:00:00Z", NOW)).toBe("3 h ago");
    expect(formatBackupRelativeTime("2026-07-14T12:00:00Z", NOW)).toBe("5 d ago");
  });

  it("degrades to 'recently' for an unparseable timestamp", () => {
    expect(formatBackupRelativeTime("not-a-date", NOW)).toBe("recently");
  });
});

describe("getStatusBadgeDisplay", () => {
  const base = {
    saveState: "saved" as const,
    configured: true,
    providerStatus: "connected" as const,
    uploadStatus: "idle" as const,
    pending: false,
    lastCloudBackupAt: "2026-07-19T11:58:00Z"
  };

  it("puts a local save failure ahead of everything, with no glyph", () => {
    expect(
      getStatusBadgeDisplay({
        ...base,
        saveState: "error",
        providerStatus: "reauthorization-required",
        uploadStatus: "error"
      })
    ).toEqual({ tone: "error", label: "Save issue", cloud: "none" });
  });

  it("surfaces reauth as amber attention (not destructive)", () => {
    expect(getStatusBadgeDisplay({ ...base, providerStatus: "reauthorization-required" })).toEqual({
      tone: "attention",
      label: "Reconnect Dropbox",
      cloud: "attention"
    });
  });

  it("surfaces an upload error as amber attention", () => {
    expect(getStatusBadgeDisplay({ ...base, uploadStatus: "error" })).toEqual({
      tone: "attention",
      label: "Backup issue",
      cloud: "attention"
    });
  });

  it("shows a local save in progress before an upload", () => {
    expect(
      getStatusBadgeDisplay({ ...base, saveState: "saving", uploadStatus: "uploading" })
    ).toEqual({ tone: "saving", label: "Saving", cloud: "none" });
  });

  it("reuses the saving pulse while backing up", () => {
    expect(getStatusBadgeDisplay({ ...base, uploadStatus: "uploading" })).toEqual({
      tone: "backing-up",
      label: "Backing up…",
      cloud: "none"
    });
  });

  it("adds a cloud glyph to a settled, connected save", () => {
    expect(getStatusBadgeDisplay(base)).toEqual({
      tone: "saved",
      label: "Saved",
      cloud: "ok"
    });
    expect(getStatusBadgeDisplay({ ...base, saveState: "idle" })).toEqual({
      tone: "idle",
      label: "Idle",
      cloud: "ok"
    });
  });

  it("does not show a completed cloud check before the first backup or while pending", () => {
    expect(getStatusBadgeDisplay({ ...base, lastCloudBackupAt: null })).toMatchObject({
      tone: "saved",
      cloud: "none"
    });
    expect(getStatusBadgeDisplay({ ...base, pending: true })).toMatchObject({
      tone: "saved",
      cloud: "none"
    });
  });

  it("keeps today's glyph-free behavior when unconfigured or disconnected", () => {
    expect(getStatusBadgeDisplay({ ...base, configured: false })).toEqual({
      tone: "saved",
      label: "Saved",
      cloud: "none"
    });
    expect(getStatusBadgeDisplay({ ...base, providerStatus: "disconnected" })).toEqual({
      tone: "saved",
      label: "Saved",
      cloud: "none"
    });
  });
});

describe("getCloudBackupPopoverState", () => {
  const base = {
    configured: true,
    status: "connected" as const,
    uploadStatus: "idle" as const,
    lastCloudBackupAt: "2026-07-19T11:58:00Z",
    pending: false,
    now: NOW
  };

  it("explains and offers optional Dropbox backup when unconfigured", () => {
    expect(getCloudBackupPopoverState({ ...base, configured: false })).toMatchObject({
      text: "Not connected. Automatic backup is off.",
      action: "setup",
      actionLabel: "Connect"
    });
  });

  it("offers reconnect on reauth with a caution tone", () => {
    const state = getCloudBackupPopoverState({ ...base, status: "reauthorization-required" });
    expect(state).toMatchObject({
      tone: "caution",
      icon: "cloud-warning",
      action: "reconnect",
      actionLabel: "Reconnect"
    });
    expect(state.text).toContain("Reconnect Dropbox");
  });

  it("shows the off state with no action when disconnected", () => {
    expect(getCloudBackupPopoverState({ ...base, status: "disconnected" })).toMatchObject({
      text: "Automatic backup is off.",
      action: "setup",
      actionLabel: "Turn on",
      icon: "cloud"
    });
  });

  it("disables the action while uploading", () => {
    expect(getCloudBackupPopoverState({ ...base, uploadStatus: "uploading" })).toMatchObject({
      text: "Backing up changes…",
      icon: "cloud-spinner",
      action: "backup-now",
      actionDisabled: true
    });
  });

  it("offers Retry on an upload error", () => {
    expect(getCloudBackupPopoverState({ ...base, uploadStatus: "error" })).toMatchObject({
      tone: "caution",
      icon: "cloud-warning",
      action: "retry",
      actionLabel: "Retry"
    });
  });

  it("prefers pending over the last-backup time", () => {
    expect(getCloudBackupPopoverState({ ...base, pending: true })).toMatchObject({
      text: "Automatic backup on. Changes waiting to back up.",
      action: "backup-now"
    });
  });

  it("shows the relative last-backup time with a Back up now action", () => {
    expect(getCloudBackupPopoverState(base)).toMatchObject({
      text: "Automatic backup on. Last backup 2 m ago.",
      icon: "cloud-check",
      action: "backup-now",
      actionLabel: "Back up now"
    });
  });

  it("handles connected-but-never-backed-up", () => {
    expect(
      getCloudBackupPopoverState({ ...base, lastCloudBackupAt: null }).text
    ).toContain("Waiting for the first backup");
  });
});

describe("getCloudBackupMenuItem", () => {
  const base = {
    status: "connected" as const,
    uploadStatus: "idle" as const,
    lastCloudBackupAt: "2026-07-19T11:58:00Z",
    pending: false,
    now: NOW
  };

  it("offers setup when disconnected", () => {
    expect(getCloudBackupMenuItem({ ...base, status: "disconnected" })).toEqual({
      label: "Set up cloud backup…",
      description: "Keep a copy in your Dropbox.",
      action: "setup",
      busy: false
    });
  });

  it("offers reconnect on reauth", () => {
    expect(getCloudBackupMenuItem({ ...base, status: "reauthorization-required" })).toMatchObject({
      label: "Reconnect Dropbox",
      action: "reconnect",
      busy: false
    });
  });

  it("marks the item busy while uploading", () => {
    expect(getCloudBackupMenuItem({ ...base, uploadStatus: "uploading" })).toMatchObject({
      label: "Backing up…",
      action: "backup-now",
      busy: true
    });
  });

  it("describes waiting changes and the last backup time", () => {
    expect(getCloudBackupMenuItem({ ...base, pending: true })).toMatchObject({
      label: "Back up to Dropbox",
      description: "Changes waiting to back up"
    });
    expect(getCloudBackupMenuItem(base)).toMatchObject({
      label: "Back up to Dropbox",
      description: "Last backed up 2 m ago"
    });
  });

  it("describes the never-backed-up connected state", () => {
    expect(getCloudBackupMenuItem({ ...base, lastCloudBackupAt: null })).toMatchObject({
      description: "Waiting for the first backup"
    });
  });
});
