import { describe, expect, it } from "vitest";
import {
  formatBackupRelativeTime,
  formatCloudProjectMeta,
  getCloudBackupMenuItem,
  getCloudBackupPopoverState,
  getCloudProjectActionAriaLabel,
  getCloudProjectActionLabel,
  getCloudProjectOpenErrorMessage,
  getCloudProjectsSectionState,
  getStatusBadgeDisplay,
  getStatusBadgeTooltip
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
      label: "Not saved yet",
      cloud: "ok"
    });
  });

  it("never labels or explains an unwritten document as saved", () => {
    // "idle" means the document is not in local storage — at boot before the
    // first write, or in the window a document swap still owes one (a
    // shared-opening load repair). The badge must not read as a settled, safe
    // state, and a healthy Dropbox row must not decorate it into one: the
    // hazard is a user closing the tab on the strength of this badge.
    for (const configured of [true, false]) {
      for (const lastCloudBackupAt of ["2026-07-19T11:58:00Z", null]) {
        const display = getStatusBadgeDisplay({
          ...base,
          saveState: "idle",
          configured,
          lastCloudBackupAt
        });
        expect(display.tone).toBe("idle");
        expect(display.label).toBe("Not saved yet");
        const tooltip = getStatusBadgeTooltip(display, configured);
        expect(tooltip).toBe("Not saved on this device yet. Open for details.");
        expect(tooltip).not.toMatch(/Saved (automatically )?on this device/);
      }
    }
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

describe("getStatusBadgeTooltip", () => {
  it("keeps the settled wording for every state that IS saved or failing", () => {
    expect(getStatusBadgeTooltip({ tone: "error", cloud: "none" }, false)).toBe(
      "Your project could not be saved on this device. Open for details."
    );
    expect(getStatusBadgeTooltip({ tone: "attention", cloud: "attention" }, true)).toBe(
      "Saved on this device. Dropbox backup needs attention. Open for details."
    );
    expect(getStatusBadgeTooltip({ tone: "saved", cloud: "ok" }, true)).toBe(
      "Saved automatically on this device and backed up to Dropbox. Open for details."
    );
    expect(getStatusBadgeTooltip({ tone: "saved", cloud: "none" }, true)).toBe(
      "Saved automatically on this device. Automatic Dropbox backup is on. Open for details."
    );
    expect(getStatusBadgeTooltip({ tone: "saved", cloud: "none" }, false)).toBe(
      "Saved automatically on this device. Open for details."
    );
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

describe("getCloudProjectsSectionState", () => {
  const base = {
    providerStatus: "connected" as const,
    status: "loaded" as const,
    count: 2
  };

  it("heads the section 'In Dropbox' and shows the rows once a listing landed", () => {
    expect(getCloudProjectsSectionState(base)).toEqual({
      heading: "In Dropbox",
      message: null,
      action: null,
      actionLabel: null
    });
  });

  it("offers Reconnect for a grant that needs reauthorization, from either status", () => {
    const reconnect = {
      heading: "In Dropbox",
      message: "Reconnect Dropbox to browse your cloud backups.",
      action: "reconnect",
      actionLabel: "Reconnect"
    };
    expect(
      getCloudProjectsSectionState({ ...base, providerStatus: "reauthorization-required" })
    ).toEqual(reconnect);
    expect(getCloudProjectsSectionState({ ...base, status: "reauth-required" })).toEqual(
      reconnect
    );
  });

  it("offers Retry when the listing failed", () => {
    expect(getCloudProjectsSectionState({ ...base, status: "error" })).toEqual({
      heading: "In Dropbox",
      message: "Couldn't reach Dropbox.",
      action: "retry",
      actionLabel: "Retry"
    });
  });

  it("reads as checking while loading and before the first listing", () => {
    expect(getCloudProjectsSectionState({ ...base, status: "loading" }).message).toBe(
      "Checking Dropbox…"
    );
    expect(getCloudProjectsSectionState({ ...base, status: "idle" }).message).toBe(
      "Checking Dropbox…"
    );
  });

  it("claims there are no backups only after a successful empty listing", () => {
    expect(getCloudProjectsSectionState({ ...base, count: 0 }).message).toBe(
      "No cloud backups yet."
    );
    expect(
      getCloudProjectsSectionState({ ...base, status: "loading", count: 0 }).message
    ).not.toBe("No cloud backups yet.");
  });
});

describe("formatCloudProjectMeta", () => {
  it("pairs the newest backup's relative time with the copy count", () => {
    expect(
      formatCloudProjectMeta({
        latestBackupIso: "2026-07-19T09:00:00Z",
        backupCount: 5,
        now: NOW
      })
    ).toBe("Backed up 3 h ago · 5 backups");
  });

  it("singularizes one backup and drops the time when there is none", () => {
    expect(
      formatCloudProjectMeta({ latestBackupIso: "2026-07-19T09:00:00Z", backupCount: 1, now: NOW })
    ).toBe("Backed up 3 h ago · 1 backup");
    expect(formatCloudProjectMeta({ latestBackupIso: null, backupCount: 0 })).toBe("0 backups");
  });
});

describe("cloud project row actions", () => {
  it("offers Open only when nothing local looks like the folder", () => {
    expect(getCloudProjectActionLabel(false)).toBe("Open");
    expect(getCloudProjectActionLabel(true)).toBe("Save a copy");
  });

  it("names the folder in the accessible label so repeated rows differ", () => {
    expect(getCloudProjectActionAriaLabel(false, "Winter Show")).toBe(
      "Open Winter Show from Dropbox"
    );
    expect(getCloudProjectActionAriaLabel(true, "Winter Show")).toBe(
      "Save a copy of Winter Show from Dropbox"
    );
  });
});

describe("getCloudProjectOpenErrorMessage", () => {
  it("says the backup is gone rather than offering a pointless retry", () => {
    expect(getCloudProjectOpenErrorMessage("not-found")).toBe(
      "That backup is no longer in Dropbox."
    );
  });

  // Uploads are uncapped on purpose, so a backup too big for this tab to open
  // really can exist; the message points at the place it can still be fetched
  // instead of implying a retry here would work.
  it("sends an oversized backup to dropbox.com rather than offering a retry", () => {
    expect(getCloudProjectOpenErrorMessage("too-large")).toBe(
      "That backup is too large to open here. You can download it from dropbox.com."
    );
  });

  it("names the fix for a lapsed grant and backs off on rate limits", () => {
    expect(getCloudProjectOpenErrorMessage("reauth")).toBe(
      "Reconnect Dropbox to open this backup."
    );
    expect(getCloudProjectOpenErrorMessage("rate-limit")).toBe(
      "Dropbox is busy. Try opening that backup again in a moment."
    );
  });

  it("falls back to one download failure sentence", () => {
    expect(getCloudProjectOpenErrorMessage("transient")).toBe(
      "Couldn't download that backup from Dropbox."
    );
    expect(getCloudProjectOpenErrorMessage("quota")).toBe(
      "Couldn't download that backup from Dropbox."
    );
  });
});
