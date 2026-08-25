// Shared, pure copy helpers for the cloud-backup UI surfaces (the topbar status
// badge, the save-status popover, the Export menu item, and the Settings
// block), so the four never drift and the wording is unit-testable. The store
// keeps three separate status models (link status + upload lifecycle + the
// per-project sync loop); these helpers are the ONLY place they're folded into
// presentation, so a copy or priority change lands in one file.

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
    return "Saved on this device. Dropbox needs attention. Open for details.";
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
// Save-status popover: ONE Dropbox row (icon + text + one inline action).
//
// Backup and sync stay separate machinery — one keeps timestamped history, the
// other keeps a single canonical copy in step — but they are not two promises
// to the curator. The promise is "this project is in Dropbox, and it's on your
// other devices"; the automatic safety copies are a detail that row mentions,
// never a second status to reconcile. Two rows made the user diff them.
//
// The row is worst-state-first: whatever most needs a decision wins, and the
// single action is that state's one next step.
// ---------------------------------------------------------------------------

export type CloudBackupPopoverTone = "muted" | "info" | "caution";
export type CloudBackupCloudIcon =
  | "cloud"
  | "cloud-check"
  | "cloud-warning"
  | "cloud-spinner";

// One union across both features, because one row dispatches it: the first four
// are provider/backup gestures, the last three are sync gestures.
export type DropboxRowAction =
  | "setup"
  | "reconnect"
  | "backup-retry"
  | "backup-now"
  | "enable"
  | "sync-now"
  | "review";

export type DropboxRowState = {
  text: string;
  // caution is amber attention, never destructive red — the copy on this
  // device is safe in every one of these states.
  tone: CloudBackupPopoverTone;
  icon: CloudBackupCloudIcon;
  action: DropboxRowAction | null;
  actionLabel: string | null;
  actionDisabled: boolean;
};

const SYNC_ROW_FALLBACK_ERROR = "Sync stopped. Try again.";

export function getDropboxRowState(input: {
  backup: {
    configured: boolean;
    status: CloudBackupProviderStatus;
    uploadStatus: CloudBackupUploadStatus;
    lastCloudBackupAt: string | null;
    pending: boolean;
    now?: number;
  };
  // `linked` is sync metadata on THIS device. It does not gate the attention
  // states below it: enabling sync can find a head another device created
  // first, which parks a conflict before any metadata exists.
  sync: {
    linked: boolean;
    status: ProjectSyncStatus;
    error: string | null;
  };
}): DropboxRowState {
  const { backup, sync } = input;

  if (!backup.configured) {
    return {
      text: "Not connected. Connect to keep this project safe and open it on your other devices.",
      tone: "muted",
      icon: "cloud",
      action: "setup",
      actionLabel: "Connect",
      actionDisabled: false
    };
  }

  // Provider trouble outranks everything below: it breaks both features, and
  // reconnecting is the only gesture that can fix either.
  if (backup.status === "reauthorization-required") {
    return {
      text: "Paused. Reconnect Dropbox.",
      tone: "caution",
      icon: "cloud-warning",
      action: "reconnect",
      actionLabel: "Reconnect",
      actionDisabled: false
    };
  }
  // "Disconnected" is the first-run state (the build ships configured, the
  // account isn't linked yet), so this line is most users' introduction to the
  // row — it has to carry the pitch, not just the standing.
  if (backup.status === "disconnected") {
    return {
      text: "Off. Turn on to keep this project safe and open it on your other devices.",
      tone: "muted",
      icon: "cloud",
      action: "setup",
      actionLabel: "Turn on",
      actionDisabled: false
    };
  }

  // Sync attention states ahead of backup trouble: these are decisions only the
  // curator can make, while a failed safety copy is a retry.
  if (sync.status === "error") {
    return {
      text: sync.error ?? SYNC_ROW_FALLBACK_ERROR,
      tone: "caution",
      icon: "cloud-warning",
      // Which retry actually retries depends on how far this project got. A
      // failed ENABLE leaves no metadata behind, and the manual check is a
      // no-op for an unlinked project — it would quietly reset the row to the
      // sync-off line, taking the error message with it and leaving the button
      // doing nothing. Retry the gesture that failed: turning sync on. Once
      // linked, the manual check is the right retry for everything.
      action: sync.linked ? "sync-now" : "enable",
      actionLabel: "Try again",
      actionDisabled: false
    };
  }
  if (sync.status === "conflict") {
    return {
      text: "This project changed in two places.",
      tone: "caution",
      icon: "cloud-warning",
      action: "review",
      actionLabel: "Review",
      actionDisabled: false
    };
  }
  if (sync.status === "needs-review") {
    return {
      text: "Needs review.",
      tone: "caution",
      icon: "cloud-warning",
      action: "review",
      actionLabel: "Review",
      actionDisabled: false
    };
  }

  const syncInFlight =
    sync.status === "checking" || sync.status === "pushing" || sync.status === "pulling";

  // Turning sync on takes seconds (build the package, upload the head), and
  // `linked` only becomes true once that upload lands — so the enable gesture
  // used to leave the row saying "off" with a live button the whole time. An
  // UNLINKED project can only be mid-round-trip because an enable is in flight
  // (or a keep-mine resolution of an enable-time conflict, which is the same
  // gesture finishing), so this state is the honest reading of that window.
  if (!sync.linked && syncInFlight) {
    return {
      text: "Turning on… Sending this project to Dropbox…",
      tone: "info",
      icon: "cloud-spinner",
      action: "enable",
      actionLabel: "Turning on…",
      actionDisabled: true
    };
  }

  if (backup.uploadStatus === "error") {
    return {
      text: "Last safety copy didn't finish.",
      tone: "caution",
      icon: "cloud-warning",
      action: "backup-retry",
      actionLabel: "Retry",
      actionDisabled: false
    };
  }

  // One in-flight line for all three round trips: which one is running is the
  // loop's business, not the curator's.
  if (sync.linked && syncInFlight) {
    return {
      text: "Syncing…",
      tone: "info",
      icon: "cloud-spinner",
      action: "sync-now",
      actionLabel: "Sync now",
      actionDisabled: true
    };
  }
  if (backup.uploadStatus === "uploading") {
    return {
      text: "Backing up changes…",
      tone: "info",
      icon: "cloud-spinner",
      action: "backup-now",
      actionLabel: "Back up now",
      actionDisabled: true
    };
  }

  if (sync.linked) {
    if (sync.status === "pending") {
      return {
        text: "Changes waiting to sync.",
        tone: "muted",
        icon: "cloud",
        action: "sync-now",
        actionLabel: "Sync now",
        actionDisabled: false
      };
    }
    if (sync.status === "synced") {
      return {
        text: "Up to date on your other devices.",
        tone: "muted",
        icon: "cloud-check",
        action: "sync-now",
        actionLabel: "Sync now",
        actionDisabled: false
      };
    }
    // "idle" with metadata on hand: linked, but this device hasn't evaluated
    // the state machine yet (the moment after a project opens). Say the durable
    // fact and offer the check rather than claiming a standing never read.
    return {
      text: "Sync is on for this project.",
      tone: "muted",
      icon: "cloud",
      action: "sync-now",
      actionLabel: "Sync now",
      actionDisabled: false
    };
  }

  // Not linked, nothing wrong: the backup side is working and the offer is the
  // thing this project does NOT have yet. Pending outranks the timestamp for
  // the same reason it always did — a last-backup time must never imply the
  // newest work is already in Dropbox.
  if (backup.pending) {
    return {
      text: "Changes waiting to back up. Not on your other devices yet.",
      tone: "muted",
      icon: "cloud",
      action: "enable",
      actionLabel: "Use on other devices",
      actionDisabled: false
    };
  }
  if (backup.lastCloudBackupAt) {
    return {
      text: `Backed up ${formatBackupRelativeTime(
        backup.lastCloudBackupAt,
        backup.now
      )}. Not on your other devices yet.`,
      tone: "muted",
      icon: "cloud-check",
      action: "enable",
      actionLabel: "Use on other devices",
      actionDisabled: false
    };
  }
  return {
    text: "Not on your other devices yet.",
    tone: "muted",
    icon: "cloud",
    action: "enable",
    actionLabel: "Use on other devices",
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
// is the Dropbox row's own "Use on other devices", which finds the head and
// parks the two copies in the conflict dialog.
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
