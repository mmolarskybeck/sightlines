import { describe, expect, it } from "vitest";
import type { CloudProjectFolder, SyncHeadListing } from "./provider";
import {
  buildCloudProjectRows,
  CLOUD_SYNC_HEADS_UNAVAILABLE_NOTICE,
  formatBackupRelativeTime,
  formatCloudProjectMeta,
  formatCloudProjectSyncMeta,
  getCloudBackupMenuItem,
  getCloudProjectActionAriaLabel,
  getCloudProjectActionLabel,
  getCloudProjectOpenErrorMessage,
  getCloudProjectsSectionState,
  getCloudSyncOpenErrorMessage,
  getDropboxRowState,
  getStatusBadgeDisplay,
  getStatusBadgeTooltip,
  shouldWarnSyncHeadsUnavailable
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
      "Saved on this device. Dropbox needs attention. Open for details."
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

// The popover's one cloud row: backup and sync folded into a single status,
// worst/most-actionable first, with exactly one inline action.
describe("getDropboxRowState", () => {
  const backup = {
    configured: true,
    status: "connected" as const,
    uploadStatus: "idle" as const,
    lastCloudBackupAt: "2026-07-19T11:58:00Z",
    pending: false,
    now: NOW
  };
  const unlinked = { linked: false, status: "idle" as const, error: null };
  const linked = { linked: true, status: "idle" as const, error: null };

  it("offers the whole promise when Dropbox is not connected", () => {
    expect(
      getDropboxRowState({ backup: { ...backup, configured: false }, sync: unlinked })
    ).toMatchObject({
      text: "Not connected. Connect to keep this project safe and open it on your other devices.",
      tone: "muted",
      icon: "cloud",
      action: "setup",
      actionLabel: "Connect"
    });
  });

  it("puts reauth ahead of every sync state, since it breaks both", () => {
    expect(
      getDropboxRowState({
        backup: { ...backup, status: "reauthorization-required", uploadStatus: "error" },
        sync: { linked: true, status: "conflict", error: null }
      })
    ).toMatchObject({
      text: "Paused. Reconnect Dropbox.",
      tone: "caution",
      icon: "cloud-warning",
      action: "reconnect",
      actionLabel: "Reconnect"
    });
  });

  it("says off, with a way back on, when the account is disconnected", () => {
    expect(
      getDropboxRowState({ backup: { ...backup, status: "disconnected" }, sync: linked })
    ).toMatchObject({
      text: "Off. Turn on to keep this project safe and open it on your other devices.",
      tone: "muted",
      icon: "cloud",
      action: "setup",
      actionLabel: "Turn on"
    });
  });

  // A decision only the curator can make outranks a safety copy that can simply
  // be retried.
  it("puts conflict and needs-review ahead of a failed backup upload", () => {
    expect(
      getDropboxRowState({
        backup: { ...backup, uploadStatus: "error" },
        sync: { linked: true, status: "conflict", error: null }
      })
    ).toMatchObject({
      text: "This project changed in two places.",
      tone: "caution",
      action: "review",
      actionLabel: "Review"
    });
    expect(
      getDropboxRowState({
        backup: { ...backup, uploadStatus: "error" },
        sync: { linked: true, status: "needs-review", error: null }
      })
    ).toMatchObject({ text: "Needs review.", action: "review" });
  });

  // Enabling sync can find a head another device made first, which parks a
  // conflict before this device has any metadata. That state must surface, not
  // be swallowed by the unlinked branches below it.
  it("surfaces an attention state even with no metadata yet", () => {
    expect(
      getDropboxRowState({ backup, sync: { linked: false, status: "conflict", error: null } })
    ).toMatchObject({ action: "review", actionLabel: "Review" });
  });

  it("shows a sync error verbatim, with a fallback sentence", () => {
    expect(
      getDropboxRowState({
        backup,
        sync: { linked: true, status: "error", error: "Dropbox is down." }
      })
    ).toMatchObject({
      text: "Dropbox is down.",
      tone: "caution",
      icon: "cloud-warning",
      action: "sync-now",
      actionLabel: "Try again"
    });
    expect(
      getDropboxRowState({ backup, sync: { linked: true, status: "error", error: null } }).text
    ).toBe("Sync stopped. Try again.");
  });

  // A failed enable is the one error with no metadata behind it. Retrying it
  // with the manual check would no-op — a project with no metadata has nothing
  // to check — and quietly swap the error for the sync-off line, leaving a
  // button that appears to do nothing. Retry what actually failed.
  it("retries a failed enable by enabling, not by running the manual check", () => {
    expect(
      getDropboxRowState({
        backup,
        sync: { linked: false, status: "error", error: "Dropbox could not be reached." }
      })
    ).toMatchObject({
      text: "Dropbox could not be reached.",
      action: "enable",
      actionLabel: "Try again"
    });
  });

  // The enable gesture takes seconds and does not set `linked` until the head
  // upload lands. Without this branch the row keeps saying "not on your other
  // devices yet" — with a live button — for the whole upload.
  it("shows a disabled turning-on state while an unlinked project is mid-round-trip", () => {
    for (const status of ["checking", "pushing", "pulling"] as const) {
      expect(
        getDropboxRowState({ backup, sync: { linked: false, status, error: null } })
      ).toMatchObject({
        text: "Turning on… Sending this project to Dropbox…",
        tone: "info",
        icon: "cloud-spinner",
        action: "enable",
        actionLabel: "Turning on…",
        actionDisabled: true
      });
    }
  });

  // Same statuses, opposite reading: a LINKED project mid-round-trip is the
  // routine loop, not the one-time enable.
  it("reads the same in-flight statuses as routine syncing once linked", () => {
    for (const status of ["checking", "pushing", "pulling"] as const) {
      expect(
        getDropboxRowState({ backup, sync: { linked: true, status, error: null } })
      ).toMatchObject({
        text: "Syncing…",
        tone: "info",
        icon: "cloud-spinner",
        action: "sync-now",
        actionDisabled: true
      });
    }
  });

  it("puts a failed safety copy ahead of routine syncing", () => {
    expect(
      getDropboxRowState({
        backup: { ...backup, uploadStatus: "error" },
        sync: { linked: true, status: "pushing", error: null }
      })
    ).toMatchObject({
      text: "Last safety copy didn't finish.",
      tone: "caution",
      icon: "cloud-warning",
      action: "backup-retry",
      actionLabel: "Retry"
    });
  });

  it("shows the backup upload only when sync has nothing to report", () => {
    expect(
      getDropboxRowState({
        backup: { ...backup, uploadStatus: "uploading" },
        sync: linked
      })
    ).toMatchObject({
      text: "Backing up changes…",
      tone: "info",
      icon: "cloud-spinner",
      action: "backup-now",
      actionDisabled: true
    });
  });

  it("says where a linked project stands, with Sync now beside it", () => {
    expect(
      getDropboxRowState({ backup, sync: { ...linked, status: "synced" } })
    ).toMatchObject({
      text: "Up to date on your other devices.",
      icon: "cloud-check",
      action: "sync-now",
      actionLabel: "Sync now",
      actionDisabled: false
    });
    expect(
      getDropboxRowState({ backup, sync: { ...linked, status: "pending" } }).text
    ).toBe("Changes waiting to sync.");
    // "idle" is linked-but-not-yet-evaluated: state the durable fact rather
    // than claiming a standing this device has never read.
    expect(getDropboxRowState({ backup, sync: linked })).toMatchObject({
      text: "Sync is on for this project.",
      icon: "cloud",
      action: "sync-now"
    });
  });

  it("frames a healthy, unlinked project around the devices it is not on yet", () => {
    expect(getDropboxRowState({ backup, sync: unlinked })).toMatchObject({
      text: "Backed up 2 m ago. Not on your other devices yet.",
      tone: "muted",
      icon: "cloud-check",
      action: "enable",
      actionLabel: "Use on other devices"
    });
    // Never let a timestamp imply the newest work is already in Dropbox.
    expect(
      getDropboxRowState({ backup: { ...backup, pending: true }, sync: unlinked })
    ).toMatchObject({
      text: "Changes waiting to back up. Not on your other devices yet.",
      action: "enable"
    });
    expect(
      getDropboxRowState({
        backup: { ...backup, lastCloudBackupAt: null },
        sync: unlinked
      })
    ).toMatchObject({
      text: "Not on your other devices yet.",
      icon: "cloud",
      action: "enable"
    });
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

describe("formatCloudProjectSyncMeta", () => {
  it("says a head-backed row is synced and what opening it does", () => {
    expect(
      formatCloudProjectSyncMeta({ syncedIso: "2026-07-19T09:00:00Z", now: NOW })
    ).toBe("Synced 3 h ago · opens here and keeps syncing");
  });

  it("still reads as synced when the provider gave no timestamp", () => {
    expect(formatCloudProjectSyncMeta({ syncedIso: null, now: NOW })).toBe(
      "Synced from another device · opens here and keeps syncing"
    );
  });
});

describe("getCloudSyncOpenErrorMessage", () => {
  // "Backup" would be the wrong noun for the file the user's other devices are
  // working against.
  it("names the synced copy for the two kinds that describe the file", () => {
    expect(getCloudSyncOpenErrorMessage("not-found")).toBe(
      "That project's synced copy is no longer in Dropbox."
    );
    expect(getCloudSyncOpenErrorMessage("too-large")).toBe(
      "That project is too large to open here. You can download it from dropbox.com."
    );
  });

  it("reuses the shared wording for everything else", () => {
    expect(getCloudSyncOpenErrorMessage("reauth")).toBe(
      getCloudProjectOpenErrorMessage("reauth")
    );
    expect(getCloudSyncOpenErrorMessage("transient")).toBe(
      getCloudProjectOpenErrorMessage("transient")
    );
  });
});

describe("buildCloudProjectRows", () => {
  const folder: CloudProjectFolder = {
    folderName: "Autumn Survey — aabbccdd",
    title: "Autumn Survey",
    projectIdPrefix: "aabbccdd",
    backupCount: 5,
    latestBackup: {
      path: "/backups/Autumn Survey — aabbccdd/2026-07-19.sightlines",
      name: "2026-07-19.sightlines",
      serverModifiedIso: "2026-07-19T09:00:00Z",
      sizeBytes: 4096
    }
  };
  const head: SyncHeadListing = {
    projectId: "aabbccdd-1111-2222-3333-444455556666",
    path: "/projects/aabbccdd-1111-2222-3333-444455556666/current.sightlines",
    rev: "rev-1",
    serverModifiedIso: "2026-07-19T11:00:00Z",
    sizeBytes: 8192
  };
  // A head with no folder anywhere near it: the shape "create project → turn
  // sync on → close the tab" leaves behind, because the head is written at once
  // and the first automatic backup never ran.
  const loneHead: SyncHeadListing = {
    ...head,
    projectId: "12345678-9999-8888-7777-666655554444",
    path: "/projects/12345678-9999-8888-7777-666655554444/current.sightlines",
    serverModifiedIso: "2026-07-19T10:00:00Z"
  };

  it("lists a folder with no local counterpart as a restorable backup", () => {
    const rows = buildCloudProjectRows({
      folders: [folder],
      syncHeads: [],
      localProjectIds: [],
      now: NOW
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: folder.folderName,
      title: "Autumn Survey",
      tag: "Not on this device",
      meta: "Backed up 3 h ago · 5 backups",
      actionLabel: "Open",
      actionAriaLabel: "Open Autumn Survey from Dropbox",
      target: { kind: "folder", folder }
    });
  });

  it("words a head-backed folder as synced but still opens it as a folder", () => {
    const rows = buildCloudProjectRows({
      folders: [folder],
      syncHeads: [head],
      localProjectIds: [],
      now: NOW
    });

    expect(rows[0]!.meta).toBe("Synced 1 h ago · opens here and keeps syncing");
    // The store re-reads this device before choosing head vs. backup, so the
    // row must not pre-empt that decision by handing back the head.
    expect(rows[0]!.target).toEqual({ kind: "folder", folder });
  });

  // The defect this row model exists for: without a synthesized row the
  // project cannot be reached from any device but the one that made it.
  it("gives a head with no backup folder a row of its own", () => {
    const rows = buildCloudProjectRows({
      folders: [],
      syncHeads: [loneHead],
      localProjectIds: [],
      now: NOW
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: "sync:12345678-9999-8888-7777-666655554444",
      // A head file carries no title, so the row says what it knows and lets
      // the short code separate two of them.
      title: "Synced project",
      tag: "12345678",
      meta: "Synced 2 h ago · opens here and keeps syncing",
      actionLabel: "Open",
      actionAriaLabel: "Open synced project 12345678 from Dropbox",
      target: { kind: "sync-head", head: loneHead }
    });
  });

  it("skips a head whose project is already on this device", () => {
    const rows = buildCloudProjectRows({
      folders: [],
      syncHeads: [loneHead],
      localProjectIds: [loneHead.projectId],
      now: NOW
    });

    expect(rows).toEqual([]);
  });

  // An unread device is not an empty one: synthesizing here would offer an
  // import that writes over the project it duplicates.
  it("withholds head rows until this device's projects are known", () => {
    const rows = buildCloudProjectRows({
      folders: [folder],
      syncHeads: [loneHead],
      localProjectIds: null,
      now: NOW
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.target).toEqual({ kind: "folder", folder });
  });

  it("never doubles a project that already has a folder row", () => {
    const rows = buildCloudProjectRows({
      folders: [folder],
      syncHeads: [head, loneHead],
      localProjectIds: [],
      now: NOW
    });

    expect(rows.map((row) => row.key)).toEqual([
      folder.folderName,
      "sync:12345678-9999-8888-7777-666655554444"
    ]);
  });

  it("keeps the copy offer, and restore language, when a local project matches", () => {
    const rows = buildCloudProjectRows({
      folders: [folder],
      syncHeads: [head],
      localProjectIds: ["aabbccdd-1111-2222-3333-444455556666"],
      now: NOW
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tag: null,
      meta: "Backed up 3 h ago · 5 backups",
      actionLabel: "Save a copy"
    });
  });

  it("orders head rows newest first, with the id as a stable tiebreak", () => {
    const older: SyncHeadListing = {
      ...loneHead,
      projectId: "00000000-1111-2222-3333-444455556666",
      serverModifiedIso: "2026-07-18T10:00:00Z"
    };
    const undated: SyncHeadListing = {
      ...loneHead,
      projectId: "ffffffff-1111-2222-3333-444455556666",
      serverModifiedIso: null
    };

    const rows = buildCloudProjectRows({
      folders: [],
      syncHeads: [undated, older, loneHead],
      localProjectIds: [],
      now: NOW
    });

    expect(rows.map((row) => row.tag)).toEqual(["12345678", "00000000", "ffffffff"]);
  });
});

describe("shouldWarnSyncHeadsUnavailable", () => {
  it("warns only when a completed listing came back without heads", () => {
    expect(shouldWarnSyncHeadsUnavailable({ status: "loaded", syncHeads: null })).toBe(true);
    // A successful heads listing stores an array, empty included.
    expect(shouldWarnSyncHeadsUnavailable({ status: "loaded", syncHeads: [] })).toBe(false);
  });

  it("stays quiet for a listing that never ran", () => {
    for (const status of ["idle", "loading", "error", "reauth-required"] as const) {
      expect(shouldWarnSyncHeadsUnavailable({ status, syncHeads: null })).toBe(false);
    }
  });

  it("names the consequence and the way back", () => {
    expect(CLOUD_SYNC_HEADS_UNAVAILABLE_NOTICE).toContain("may open here without syncing");
    expect(CLOUD_SYNC_HEADS_UNAVAILABLE_NOTICE).toContain("turn syncing on after it opens");
  });
});
