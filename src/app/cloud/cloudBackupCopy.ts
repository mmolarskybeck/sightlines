// Shared, pure copy helpers for the cloud-backup UI surfaces (the topbar status
// badge, the save-status popover, the Export menu item, and the Settings
// block), so the four never drift and the wording is unit-testable. The store
// keeps two separate status models (link status + upload lifecycle); these
// helpers are the ONLY place they're folded into presentation, so a copy or
// priority change lands in one file.

import type { CloudBackupProviderStatus } from "./provider";
import type { CloudBackupUploadStatus } from "../store/cloudBackupSlice";

// A terse relative time for a backup timestamp: "just now", "2 m ago",
// "3 h ago", "5 d ago". Matches the quiet, glanceable register of the popover.
export function formatBackupRelativeTime(
  iso: string,
  now: number = Date.now()
): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "recently";
  const deltaMs = Math.max(0, now - then);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

// ---------------------------------------------------------------------------
// Topbar status badge: local save state + cloud rolled into one glanceable
// display. Local data safety always wins the tone; cloud attention outranks a
// quiet save; a healthy backed-up state earns a small cloud glyph.
// ---------------------------------------------------------------------------

export type SaveState = "idle" | "saving" | "saved" | "error";

// idle/saving/saved/error mirror the local save states; "attention" is a cloud
// problem the user can act on (caution amber, NOT destructive — local data is
// safe); "backing-up" reuses the saving pulse while an upload is in flight.
export type StatusBadgeTone =
  | "idle"
  | "saving"
  | "saved"
  | "error"
  | "attention"
  | "backing-up";

// Whether (and how) to decorate the badge with a trailing cloud glyph.
export type StatusBadgeCloud = "none" | "ok" | "attention";

function saveStateLabel(state: SaveState): string {
  switch (state) {
    case "saving":
      return "Saving";
    case "saved":
      return "Saved";
    case "error":
      return "Save issue";
    default:
      return "Idle";
  }
}

export function getStatusBadgeDisplay(input: {
  saveState: SaveState;
  configured: boolean;
  providerStatus: CloudBackupProviderStatus;
  uploadStatus: CloudBackupUploadStatus;
  pending: boolean;
}): { tone: StatusBadgeTone; label: string; cloud: StatusBadgeCloud } {
  const connected = input.configured && input.providerStatus === "connected";

  // 1. Local save failure always wins — data safety on this device outranks any
  //    cloud concern.
  if (input.saveState === "error") {
    return { tone: "error", label: "Save issue", cloud: "none" };
  }

  // 2. Cloud needs attention (only when configured). Amber, not red: the local
  //    copy is fine; the backup is what's stuck.
  if (input.configured && input.providerStatus === "reauthorization-required") {
    return { tone: "attention", label: "Reconnect Dropbox", cloud: "attention" };
  }
  if (input.configured && input.uploadStatus === "error") {
    return { tone: "attention", label: "Backup issue", cloud: "attention" };
  }

  // 3. A local save in progress.
  if (input.saveState === "saving") {
    return { tone: "saving", label: "Saving", cloud: "none" };
  }

  // 4. An upload in progress (reuses the saving pulse).
  if (input.configured && input.uploadStatus === "uploading") {
    return { tone: "backing-up", label: "Backing up…", cloud: "none" };
  }

  // 5. Settled + connected: today's label plus a quiet cloud check.
  if (connected) {
    return { tone: input.saveState, label: saveStateLabel(input.saveState), cloud: "ok" };
  }

  // 6. Not configured or not connected: exactly today's behavior, no glyph.
  return { tone: input.saveState, label: saveStateLabel(input.saveState), cloud: "none" };
}

// ---------------------------------------------------------------------------
// Save-status popover: a structured cloud row (icon + text + inline action).
// ---------------------------------------------------------------------------

export type CloudBackupPopoverTone = "muted" | "info" | "caution";
export type CloudBackupPopoverAction = "backup-now" | "reconnect" | "retry";
export type CloudBackupCloudIcon =
  | "cloud"
  | "cloud-check"
  | "cloud-warning"
  | "cloud-spinner";

export type CloudBackupPopoverState = {
  text: string;
  tone: CloudBackupPopoverTone;
  icon: CloudBackupCloudIcon;
  action: CloudBackupPopoverAction | null;
  actionLabel: string | null;
  actionDisabled: boolean;
};

// The cloud row for the save-status popover. Returns null when unconfigured
// (the row is hidden, as today). Supersedes the old single-line helper: the
// popover now carries an inline action per state.
export function getCloudBackupPopoverState(input: {
  configured: boolean;
  status: CloudBackupProviderStatus;
  uploadStatus: CloudBackupUploadStatus;
  lastCloudBackupAt: string | null;
  pending: boolean;
  now?: number;
}): CloudBackupPopoverState | null {
  if (!input.configured) return null;

  if (input.status === "reauthorization-required") {
    return {
      text: "Reconnect Dropbox to resume backups.",
      tone: "caution",
      icon: "cloud-warning",
      action: "reconnect",
      actionLabel: "Reconnect",
      actionDisabled: false
    };
  }

  if (input.status === "disconnected") {
    // The footer's Storage settings covers turning it back on — no inline
    // action here.
    return {
      text: "Cloud backup is off.",
      tone: "muted",
      icon: "cloud",
      action: null,
      actionLabel: null,
      actionDisabled: false
    };
  }

  // connected
  if (input.uploadStatus === "uploading") {
    return {
      text: "Backing up to Dropbox…",
      tone: "info",
      icon: "cloud-spinner",
      action: "backup-now",
      actionLabel: "Back up now",
      actionDisabled: true
    };
  }
  if (input.uploadStatus === "error") {
    return {
      text: "Last backup didn't finish.",
      tone: "caution",
      icon: "cloud-warning",
      action: "retry",
      actionLabel: "Retry",
      actionDisabled: false
    };
  }
  if (input.pending) {
    return {
      text: "Changes waiting to back up.",
      tone: "muted",
      icon: "cloud",
      action: "backup-now",
      actionLabel: "Back up now",
      actionDisabled: false
    };
  }
  if (input.lastCloudBackupAt) {
    return {
      text: `Backed up to Dropbox ${formatBackupRelativeTime(
        input.lastCloudBackupAt,
        input.now
      )}.`,
      tone: "muted",
      icon: "cloud-check",
      action: "backup-now",
      actionLabel: "Back up now",
      actionDisabled: false
    };
  }
  return {
    text: "Cloud backup on — waiting for the first backup.",
    tone: "muted",
    icon: "cloud",
    action: "backup-now",
    actionLabel: "Back up now",
    actionDisabled: false
  };
}

// ---------------------------------------------------------------------------
// Export menu: one top-level cloud item, shown only when configured.
// ---------------------------------------------------------------------------

export type CloudBackupMenuAction = "backup-now" | "reconnect" | "setup";

export type CloudBackupMenuItem = {
  label: string;
  description: string;
  action: CloudBackupMenuAction;
  // True only while an upload is in flight — the item shows a spinner and
  // disables (the component owns the actual disabled attribute + icon).
  busy: boolean;
};

export function getCloudBackupMenuItem(input: {
  status: CloudBackupProviderStatus;
  uploadStatus: CloudBackupUploadStatus;
  lastCloudBackupAt: string | null;
  pending: boolean;
  now?: number;
}): CloudBackupMenuItem {
  if (input.status === "reauthorization-required") {
    return {
      label: "Reconnect Dropbox",
      description: "Backups are paused until you reconnect.",
      action: "reconnect",
      busy: false
    };
  }
  if (input.status === "disconnected") {
    return {
      label: "Set up cloud backup…",
      description: "Keep a copy in your Dropbox.",
      action: "setup",
      busy: false
    };
  }
  // connected
  if (input.uploadStatus === "uploading") {
    return {
      label: "Backing up…",
      description: "Uploading to Dropbox",
      action: "backup-now",
      busy: true
    };
  }
  if (input.pending) {
    return {
      label: "Back up to Dropbox",
      description: "Changes waiting to back up",
      action: "backup-now",
      busy: false
    };
  }
  if (input.lastCloudBackupAt) {
    return {
      label: "Back up to Dropbox",
      description: `Last backed up ${formatBackupRelativeTime(
        input.lastCloudBackupAt,
        input.now
      )}`,
      action: "backup-now",
      busy: false
    };
  }
  return {
    label: "Back up to Dropbox",
    description: "Waiting for the first backup",
    action: "backup-now",
    busy: false
  };
}
