// Shared, pure copy helpers for the cloud-backup UI surfaces (the topbar status
// badge, the save-status popover, the Export menu item, and the Settings
// block), so the four never drift and the wording is unit-testable. The store
// keeps two separate status models (link status + upload lifecycle); these
// helpers are the ONLY place they're folded into presentation, so a copy or
// priority change lands in one file.

import type { CloudBackupProviderStatus } from "./provider";
import type { CloudBackupUploadStatus } from "../store/cloudBackupSlice";
import type { CloudProjectsStatus } from "../store/cloudProjectsSlice";

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
      // "idle" is this store's "nothing has been written yet" — at boot before
      // the first save, and in the window after a document swap that still owes
      // a write. The old label ("Idle") read as a settled, harmless state and
      // the badge tooltip paired it with "Saved automatically on this device",
      // which is exactly the claim this state cannot make. Say the true thing:
      // a user must never close the tab believing an unwritten document is durable.
      return "Not saved yet";
  }
}

export function getStatusBadgeDisplay(input: {
  saveState: SaveState;
  configured: boolean;
  providerStatus: CloudBackupProviderStatus;
  uploadStatus: CloudBackupUploadStatus;
  pending: boolean;
  lastCloudBackupAt: string | null;
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

  // 5. Settled + connected + previously backed up: today's label plus a quiet
  //    cloud check. Pending and never-backed-up projects must not look fully
  //    backed up even though automatic backup is enabled.
  if (connected && !input.pending && input.lastCloudBackupAt) {
    return { tone: input.saveState, label: saveStateLabel(input.saveState), cloud: "ok" };
  }

  // 6. Not configured or not connected: exactly today's behavior, no glyph.
  return { tone: input.saveState, label: saveStateLabel(input.saveState), cloud: "none" };
}

// The badge's hover sentence, one branch per thing the badge can be saying.
// Lives here rather than in TopBar so label and tooltip cannot drift apart —
// the pair was the actual bug: an "Idle" badge explained as "Saved
// automatically on this device".
//
// Ordered by what the user most needs to know: a local write problem, then a
// cloud one, then the fact that nothing has been written yet, and only then the
// reassuring variants. "idle" sits ahead of every cloud branch on purpose — it
// means the document is not in local storage, so no wording built on "Saved
// automatically on this device" is true, however healthy the Dropbox side looks.
export function getStatusBadgeTooltip(
  display: { tone: StatusBadgeTone; cloud: StatusBadgeCloud },
  cloudConnected: boolean
): string {
  if (display.tone === "error") {
    return "Your project could not be saved on this device. Open for details.";
  }
  if (display.tone === "attention") {
    return "Saved on this device. Dropbox backup needs attention. Open for details.";
  }
  if (display.tone === "idle") {
    return "Not saved on this device yet. Open for details.";
  }
  if (display.cloud === "ok") {
    return "Saved automatically on this device and backed up to Dropbox. Open for details.";
  }
  if (cloudConnected) {
    return "Saved automatically on this device. Automatic Dropbox backup is on. Open for details.";
  }
  return "Saved automatically on this device. Open for details.";
}

// ---------------------------------------------------------------------------
// Save-status popover: a structured cloud row (icon + text + inline action).
// ---------------------------------------------------------------------------

export type CloudBackupPopoverTone = "muted" | "info" | "caution";
export type CloudBackupPopoverAction = "backup-now" | "reconnect" | "retry" | "setup";
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

// The Dropbox row is always present so the popover consistently explains the
// second, optional save destination. It carries an inline action per state.
export function getCloudBackupPopoverState(input: {
  configured: boolean;
  status: CloudBackupProviderStatus;
  uploadStatus: CloudBackupUploadStatus;
  lastCloudBackupAt: string | null;
  pending: boolean;
  now?: number;
}): CloudBackupPopoverState {
  if (!input.configured) {
    return {
      text: "Not connected. Automatic backup is off.",
      tone: "muted",
      icon: "cloud",
      action: "setup",
      actionLabel: "Connect",
      actionDisabled: false
    };
  }

  if (input.status === "reauthorization-required") {
    return {
      text: "Automatic backup paused. Reconnect Dropbox.",
      tone: "caution",
      icon: "cloud-warning",
      action: "reconnect",
      actionLabel: "Reconnect",
      actionDisabled: false
    };
  }

  if (input.status === "disconnected") {
    return {
      text: "Automatic backup is off.",
      tone: "muted",
      icon: "cloud",
      action: "setup",
      actionLabel: "Turn on",
      actionDisabled: false
    };
  }

  // connected
  if (input.uploadStatus === "uploading") {
    return {
      text: "Backing up changes…",
      tone: "info",
      icon: "cloud-spinner",
      action: "backup-now",
      actionLabel: "Back up now",
      actionDisabled: true
    };
  }
  if (input.uploadStatus === "error") {
    return {
      text: "Automatic backup paused. Last backup didn't finish.",
      tone: "caution",
      icon: "cloud-warning",
      action: "retry",
      actionLabel: "Retry",
      actionDisabled: false
    };
  }
  if (input.pending) {
    return {
      text: "Automatic backup on. Changes waiting to back up.",
      tone: "muted",
      icon: "cloud",
      action: "backup-now",
      actionLabel: "Back up now",
      actionDisabled: false
    };
  }
  if (input.lastCloudBackupAt) {
    return {
      text: `Automatic backup on. Last backup ${formatBackupRelativeTime(
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
    text: "Automatic backup on. Waiting for the first backup.",
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

// ---------------------------------------------------------------------------
// Cloud project browser (project manager): the Dropbox backup folders this
// account holds, listed next to the projects on this device.
//
// The vocabulary here is deliberately "cloud projects / backup / restore" and
// never "sync" (docs/cloud-sync-plan.md staged roadmap — the sync label starts
// at stage 2, when a canonical head and a conflict model exist). A folder with
// no local counterpart is "Not on this device", never "orphaned": it is usually
// exactly what another device made and this one wants.
// ---------------------------------------------------------------------------

export const CLOUD_PROJECTS_HEADING = "In Dropbox";

// Plain muted text next to the title, mirroring the "Current" tag — a fact
// about this device, not a warning.
export const CLOUD_PROJECT_ABSENT_TAG = "Not on this device";

export type CloudProjectsSectionAction = "retry" | "reconnect";

export type CloudProjectsSectionState = {
  heading: string;
  // Replaces the rows when set; null means the list itself is what to show.
  message: string | null;
  action: CloudProjectsSectionAction | null;
  actionLabel: string | null;
};

// The provider's own link status outranks the list status: a grant that needs
// reauthorization can never produce a list, so offer the one fix that works
// rather than a Retry that will fail the same way.
export function getCloudProjectsSectionState(input: {
  providerStatus: CloudBackupProviderStatus;
  status: CloudProjectsStatus;
  count: number;
}): CloudProjectsSectionState {
  const heading = CLOUD_PROJECTS_HEADING;

  if (
    input.providerStatus === "reauthorization-required" ||
    input.status === "reauth-required"
  ) {
    return {
      heading,
      message: "Reconnect Dropbox to browse your cloud backups.",
      action: "reconnect",
      actionLabel: "Reconnect"
    };
  }
  if (input.status === "error") {
    return {
      heading,
      message: "Couldn't reach Dropbox.",
      action: "retry",
      actionLabel: "Retry"
    };
  }
  // "idle" only lasts until the dialog's on-open refresh lands, so it reads as
  // the same wait rather than a fourth, emptier state.
  if (input.status === "loading" || input.status === "idle") {
    return { heading, message: "Checking Dropbox…", action: null, actionLabel: null };
  }
  if (input.count === 0) {
    return { heading, message: "No cloud backups yet.", action: null, actionLabel: null };
  }
  return { heading, message: null, action: null, actionLabel: null };
}

// One row's meta line: when the newest backup landed, and how many the folder
// keeps. Same relative-time register as the save-status popover.
export function formatCloudProjectMeta(input: {
  latestBackupIso: string | null;
  backupCount: number;
  now?: number;
}): string {
  const copies = `${input.backupCount} backup${input.backupCount === 1 ? "" : "s"}`;
  if (!input.latestBackupIso) return copies;
  return `Backed up ${formatBackupRelativeTime(input.latestBackupIso, input.now)} · ${copies}`;
}

// "Open" restores a project this device doesn't have under its own identity;
// "Save a copy" is the only offer when the id looks like one already here,
// because stage 1 never replaces a local project. The match is an 8-char
// prefix guess, so the label must not promise the two are the same project —
// the import pipeline re-ids on collision either way.
export function getCloudProjectActionLabel(matchesLocalProject: boolean): string {
  return matchesLocalProject ? "Save a copy" : "Open";
}

// Every row's button carries the same two words, so the accessible name has to
// name the folder as well as the verb.
export function getCloudProjectActionAriaLabel(
  matchesLocalProject: boolean,
  title: string
): string {
  return matchesLocalProject
    ? `Save a copy of ${title} from Dropbox`
    : `Open ${title} from Dropbox`;
}

// The provider-agnostic failure kinds a restore has distinct wording for;
// anything else a provider can classify collapses into "transient".
export type CloudProjectOpenErrorKind =
  | "reauth"
  | "not-found"
  | "rate-limit"
  | "quota"
  | "transient";

// Failure to download one backup. "not-found" gets no retry affordance — the
// file is gone, and the list is refreshed instead.
export function getCloudProjectOpenErrorMessage(
  kind: CloudProjectOpenErrorKind
): string {
  switch (kind) {
    case "not-found":
      return "That backup is no longer in Dropbox.";
    case "reauth":
      return "Reconnect Dropbox to open this backup.";
    case "rate-limit":
      return "Dropbox is busy. Try opening that backup again in a moment.";
    default:
      return "Couldn't download that backup from Dropbox.";
  }
}

export const CLOUD_PROJECT_NO_BACKUP_MESSAGE = "That folder has no backup to open.";
