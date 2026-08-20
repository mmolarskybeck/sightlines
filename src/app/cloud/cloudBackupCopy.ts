// Shared, pure copy helpers for the cloud-backup UI surfaces (the topbar status
// badge, the save-status popover, the Export menu item, and the Settings
// block), so the four never drift and the wording is unit-testable. The store
// keeps two separate status models (link status + upload lifecycle); these
// helpers are the ONLY place they're folded into presentation, so a copy or
// priority change lands in one file.

import type {
  CloudBackupProviderStatus,
  CloudProjectFolder,
  SyncHeadListing
} from "./provider";
import type { CloudBackupUploadStatus } from "../store/cloudBackupSlice";
import type { CloudProjectsStatus } from "../store/cloudProjectsSlice";
import type { ProjectSyncStatus } from "../store/cloudSyncSlice";

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
// Save-status popover, second cloud row: cross-device sync for the OPEN project
// (docs/cloud-sync-plan.md stage 2). Backup and sync are different promises —
// one keeps history, the other keeps one canonical copy in step — so they are
// two rows with two vocabularies, never one merged status.
//
// This is the first surface allowed to say "sync" (the stage-1 browser rows
// deliberately say backup/restore), and only ever about a project whose head
// this device is linked to.
// ---------------------------------------------------------------------------

export type ProjectSyncRowAction = "enable" | "sync-now" | "review";

export type ProjectSyncRowState = {
  text: string;
  // Same three tones the backup row uses, so the two rows tint identically:
  // caution is amber attention, never destructive red — the copy on this
  // device is safe in every one of these states.
  tone: CloudBackupPopoverTone;
  icon: CloudBackupCloudIcon;
  action: ProjectSyncRowAction | null;
  actionLabel: string | null;
  actionDisabled: boolean;
};

const SYNC_ROW_FALLBACK_ERROR = "Sync stopped. Try again.";

// null means "render no sync row at all": with no provider connection there is
// nothing true to say about syncing, and the backup row above already explains
// the disconnected account.
//
// `linked` is metadata-on-this-device, but it does NOT gate the attention
// states: enabling sync can find a head another device created first, which
// parks a conflict before any metadata exists. Those states are surfaced on
// their own terms, ahead of the not-linked branch — `linked` only decides
// WHICH retry an error offers, since a project with no metadata has nothing for
// the manual check to check.
export function getProjectSyncRowState(input: {
  connected: boolean;
  linked: boolean;
  status: ProjectSyncStatus;
  error: string | null;
}): ProjectSyncRowState | null {
  if (!input.connected) return null;

  if (input.status === "error") {
    return {
      text: input.error ?? SYNC_ROW_FALLBACK_ERROR,
      tone: "caution",
      icon: "cloud-warning",
      // Which retry actually retries depends on how far this project got. A
      // failed ENABLE leaves no metadata behind, and the manual check is a
      // no-op for an unlinked project — it would quietly reset the row to "Off
      // for this project", taking the error message with it and leaving the
      // button doing nothing. Retry the gesture that failed: turning sync on.
      // Once linked, the manual check is the right retry for everything.
      action: input.linked ? "sync-now" : "enable",
      actionLabel: "Try again",
      actionDisabled: false
    };
  }
  if (input.status === "conflict") {
    return {
      text: "This project changed in two places.",
      tone: "caution",
      icon: "cloud-warning",
      action: "review",
      actionLabel: "Review",
      actionDisabled: false
    };
  }
  if (input.status === "needs-review") {
    return {
      text: "Needs review.",
      tone: "caution",
      icon: "cloud-warning",
      action: "review",
      actionLabel: "Review",
      actionDisabled: false
    };
  }

  if (!input.linked) {
    return {
      text: "Off for this project.",
      tone: "muted",
      icon: "cloud",
      action: "enable",
      actionLabel: "Sync across devices",
      actionDisabled: false
    };
  }

  if (
    input.status === "checking" ||
    input.status === "pushing" ||
    input.status === "pulling"
  ) {
    return {
      text: "Syncing…",
      tone: "info",
      icon: "cloud-spinner",
      action: "sync-now",
      actionLabel: "Sync now",
      actionDisabled: true
    };
  }
  if (input.status === "pending") {
    return {
      text: "Changes waiting to sync.",
      tone: "muted",
      icon: "cloud",
      action: "sync-now",
      actionLabel: "Sync now",
      actionDisabled: false
    };
  }
  if (input.status === "synced") {
    return {
      text: "Synced.",
      tone: "muted",
      icon: "cloud-check",
      action: "sync-now",
      actionLabel: "Sync now",
      actionDisabled: false
    };
  }
  // "idle" with metadata on hand: linked, but this device hasn't evaluated the
  // state machine yet (the moment after a project opens). Say the durable fact
  // and offer the check rather than claiming a standing that hasn't been read.
  return {
    text: "Sync is on for this project.",
    tone: "muted",
    icon: "cloud",
    action: "sync-now",
    actionLabel: "Sync now",
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

// The meta line for a row backed by a SYNC HEAD rather than by the folder's
// backup history: the same row, but pressing Open links this device to the
// canonical copy instead of restoring a timestamped file. "sync" is allowed
// here precisely because a head exists — the /backups-only rows above keep
// restore language (docs/cloud-sync-plan.md, stage-1 label rule).
export function formatCloudProjectSyncMeta(input: {
  syncedIso: string | null;
  now?: number;
}): string {
  const when = input.syncedIso
    ? `Synced ${formatBackupRelativeTime(input.syncedIso, input.now)}`
    : "Synced from another device";
  return `${when} · opens here and keeps syncing`;
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

// ---------------------------------------------------------------------------
// The section's row model. The listing is TWO listings — the account's backup
// folders and its sync heads — and a project can be in either, or both. Deriving
// rows from the folders alone (what stage 1 did) makes a project with a head and
// no backup folder invisible, and that is not a hypothetical: enabling sync
// writes the head immediately while the first automatic backup waits out the
// settle delay, so "new project → sync on → close the tab" leaves exactly that
// shape — the very handoff this section exists to serve.
//
// Pure and component-free on purpose: which rows exist, and what each one says,
// is the part worth testing directly.
// ---------------------------------------------------------------------------

// A head file is /projects/<id>/current.sightlines — it carries no title, and
// this section refuses to invent one. Say what is known (a project, synced, from
// somewhere else) and let the short code below tell two of them apart.
export const CLOUD_PROJECT_UNTITLED_SYNC_TITLE = "Synced project";

// The same 8 chars the backup folder names carry, for the same reason: enough
// to distinguish two rows, never presented as something to act on.
export function formatSyncHeadShortId(projectId: string): string {
  return projectId.slice(0, 8);
}

// Row identity for a head-only row. Prefixed so it can share one "which row is
// opening" field with the folder rows (keyed by folder name) without the two
// namespaces ever colliding.
export function getCloudSyncRowKey(projectId: string): string {
  return `sync:${projectId}`;
}

// What pressing a row's action opens. A folder row hands the FOLDER back even
// when a head stands behind it: the store re-reads this device before choosing
// between the head and the newest backup, and that authoritative read — not this
// display model — is what may link a device.
export type CloudProjectRowTarget =
  | { kind: "folder"; folder: CloudProjectFolder }
  | { kind: "sync-head"; head: SyncHeadListing };

export type CloudProjectRow = {
  key: string;
  title: string;
  // Muted text beside the title: "Not on this device" for a folder row that has
  // no local counterpart, the short project code for a titleless synced one.
  tag: string | null;
  meta: string;
  actionLabel: string;
  actionAriaLabel: string;
  target: CloudProjectRowTarget;
};

// The one head whose project id starts with this folder's prefix. Exactly one,
// or none: the 8-char prefix is a display heuristic, and two heads sharing it
// means a row cannot honestly claim to know which project it opens. The store
// makes the same call for the same reason — here it only decides wording.
export function matchOneSyncHead(
  heads: SyncHeadListing[] | null,
  prefix: string
): SyncHeadListing | null {
  if (!heads || prefix.length === 0) return null;
  const matches = heads.filter((head) => head.projectId.startsWith(prefix));
  return matches.length === 1 ? matches[0]! : null;
}

export function buildCloudProjectRows(input: {
  folders: CloudProjectFolder[] | null;
  syncHeads: SyncHeadListing[] | null;
  // null means this device's own projects have not been read yet — NOT that
  // there are none. Head rows are withheld while it is null: a synthesized row
  // for a project already here would offer an import that overwrites it.
  localProjectIds: string[] | null;
  now?: number;
}): CloudProjectRow[] {
  const localIds = input.localProjectIds;
  const folders = input.folders ?? [];

  const folderRows = folders.map((folder): CloudProjectRow => {
    // Prefix agreement is a guess about identity, so it only chooses which
    // offer to make — the import pipeline decides what is written.
    const matchesLocalProject =
      folder.projectIdPrefix.length > 0 &&
      (localIds ?? []).some((id) => id.startsWith(folder.projectIdPrefix));
    // Only a row that is NOT here already can open from the head: a prefix
    // match keeps the save-a-copy path, and copies are never linked.
    const head = matchesLocalProject
      ? null
      : matchOneSyncHead(input.syncHeads, folder.projectIdPrefix);

    return {
      key: folder.folderName,
      title: folder.title,
      tag: matchesLocalProject ? null : CLOUD_PROJECT_ABSENT_TAG,
      meta: head
        ? formatCloudProjectSyncMeta({ syncedIso: head.serverModifiedIso, now: input.now })
        : formatCloudProjectMeta({
            latestBackupIso: folder.latestBackup?.serverModifiedIso ?? null,
            backupCount: folder.backupCount,
            now: input.now
          }),
      actionLabel: getCloudProjectActionLabel(matchesLocalProject),
      actionAriaLabel: getCloudProjectActionAriaLabel(matchesLocalProject, folder.title),
      target: { kind: "folder", folder }
    };
  });

  if (!input.syncHeads || localIds === null) return folderRows;

  const headRows = input.syncHeads
    .filter((head) => {
      // Already on this device: full id against full id, since a head's file
      // name IS the project id. Nothing useful could be offered here — the
      // project is open or openable from the list above, and importing it again
      // would write over it.
      if (localIds.includes(head.projectId)) return false;
      // A folder already speaks for this project. When exactly one head sits
      // under that folder's prefix the folder row opens the head itself; when
      // two do, the folder row falls back to restore language and this head goes
      // unrepresented — accepted, because two ids sharing 8 chars is a far
      // rarer event than the duplicate rows the alternative would produce.
      return !folders.some(
        (folder) =>
          folder.projectIdPrefix.length > 0 &&
          head.projectId.startsWith(folder.projectIdPrefix)
      );
    })
    // Newest first, id as the tiebreak so the order is stable across refreshes
    // (timestamps are display only — this is ordering, never ancestry).
    .sort((a, b) => {
      const byTime = (b.serverModifiedIso ?? "").localeCompare(a.serverModifiedIso ?? "");
      return byTime !== 0 ? byTime : a.projectId.localeCompare(b.projectId);
    })
    .map((head): CloudProjectRow => {
      const shortId = formatSyncHeadShortId(head.projectId);
      return {
        key: getCloudSyncRowKey(head.projectId),
        title: CLOUD_PROJECT_UNTITLED_SYNC_TITLE,
        tag: shortId,
        meta: formatCloudProjectSyncMeta({
          syncedIso: head.serverModifiedIso,
          now: input.now
        }),
        actionLabel: getCloudProjectActionLabel(false),
        actionAriaLabel: `Open synced project ${shortId} from Dropbox`,
        target: { kind: "sync-head", head }
      };
    });

  return [...folderRows, ...headRows];
}

// A heads listing that failed leaves this section unable to tell a project that
// syncs from one that only has backups — so an Open here may quietly bring a
// project in without linking it. Restoring beats blocking recovery, so the rows
// still open; this line is the part that must not be silent. The fix afterwards
// is the sync row's own "Sync across devices", which finds the head and parks
// the two copies in the conflict dialog.
export const CLOUD_SYNC_HEADS_UNAVAILABLE_NOTICE =
  "Couldn't check which projects sync across devices. One that does may open here " +
  "without syncing — you can turn syncing on after it opens.";

// Only after a listing pass that actually ran. "Never fetched" wears the same
// null (the dialog's first paint, a disconnected provider), and a notice about a
// failure that hasn't happened is its own kind of lie. A finished folder listing
// is the proof a pass ran: heads and folders are fetched together, and every
// successful heads fetch stores an array — empty included.
export function shouldWarnSyncHeadsUnavailable(input: {
  status: CloudProjectsStatus;
  syncHeads: SyncHeadListing[] | null;
}): boolean {
  return input.status === "loaded" && input.syncHeads === null;
}

// The provider-agnostic failure kinds a restore has distinct wording for;
// anything else a provider can classify collapses into "transient".
export type CloudProjectOpenErrorKind =
  | "reauth"
  | "not-found"
  | "rate-limit"
  | "quota"
  | "too-large"
  | "transient";

// Failure to download one backup. "not-found" gets no retry affordance — the
// file is gone, and the list is refreshed instead. "too-large" gets its own
// sentence because backup uploads are deliberately uncapped (a backup must
// never silently stop), so a file too big for this tab to open really can
// exist — and the honest answer names the place it can still be fetched from
// rather than implying a retry here would work.
export function getCloudProjectOpenErrorMessage(
  kind: CloudProjectOpenErrorKind
): string {
  switch (kind) {
    case "not-found":
      return "That backup is no longer in Dropbox.";
    case "too-large":
      return "That backup is too large to open here. You can download it from dropbox.com.";
    case "reauth":
      return "Reconnect Dropbox to open this backup.";
    case "rate-limit":
      return "Dropbox is busy. Try opening that backup again in a moment.";
    default:
      return "Couldn't download that backup from Dropbox.";
  }
}

export const CLOUD_PROJECT_NO_BACKUP_MESSAGE = "That folder has no backup to open.";

// The same failures, for a row opening from the project's SYNCED copy. Two
// kinds need their own sentence because "backup" would be the wrong noun: the
// file at stake is the one the user's other devices are working against, and
// naming it a backup would understate what is missing.
export function getCloudSyncOpenErrorMessage(
  kind: CloudProjectOpenErrorKind
): string {
  switch (kind) {
    case "not-found":
      return "That project's synced copy is no longer in Dropbox.";
    case "too-large":
      return "That project is too large to open here. You can download it from dropbox.com.";
    default:
      return getCloudProjectOpenErrorMessage(kind);
  }
}

// The two ways a head-only row can refuse before any bytes are spent. Opening a
// head imports under the project's OWN id, so a project already on this device
// must never take this path — and a device whose projects can't be read is the
// same refusal, since it cannot prove otherwise.
export const CLOUD_SYNC_PROJECT_ALREADY_HERE_MESSAGE =
  "That project is already on this device.";
export const CLOUD_SYNC_LOCAL_CHECK_FAILED_MESSAGE =
  "Couldn't check the projects on this device. Try opening that project again.";
