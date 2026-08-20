// Cloud project browser (docs/cloud-sync-plan.md stage 1): lists the provider's
// backup folders for the project manager and restores one into this device.
// Read-only semantics — nothing here ever replaces a local project. A folder
// whose id prefix looks like a project already on this device can only be
// opened as a copy; everything else opens under its own identity.
//
// The 8-char prefix carried by a backup folder name is a DISPLAY heuristic, not
// proof of identity: it decides a label and which import option is offered,
// never whether a write is safe. The import pipeline stays the authority — it
// re-ids on collision, so a wrong guess costs a redundant copy, not data.
//
// Stage 2 adds one thing and keeps that rule: when the account also holds a
// SYNC HEAD for a project this device doesn't have, the row opens the head
// instead of the newest backup and the device ends up linked to it. Still
// nothing here replaces a local project — a folder that looks like something
// already on this device can only ever be copied in.
//
// A head can also exist with NO backup folder behind it (sync writes the head
// at once; the first automatic backup waits out the settle delay), so the
// listing this surface shows is the union of the two — see buildCloudProjectRows
// in cloudBackupCopy.ts. Those rows open through openCloudSyncedProject, which
// shares this file's one head-open implementation.

import { toast } from "sonner";
import { CloudBackupError } from "../cloud/dropbox";
import {
  CLOUD_PROJECT_NO_BACKUP_MESSAGE,
  CLOUD_SYNC_LOCAL_CHECK_FAILED_MESSAGE,
  CLOUD_SYNC_PROJECT_ALREADY_HERE_MESSAGE,
  getCloudProjectOpenErrorMessage,
  getCloudSyncOpenErrorMessage,
  getCloudSyncRowKey,
  matchOneSyncHead,
  type CloudProjectOpenErrorKind
} from "../cloud/cloudBackupCopy";
import { MAX_BACKUP_DOWNLOAD_BYTES } from "../cloud/dropboxAuth";
import type {
  CloudBackupProvider,
  CloudProjectFolder,
  SyncHeadListing
} from "../cloud/provider";
import type { AppState, AppStoreDeps } from "../store";

export type CloudProjectsStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "error"
  | "reauth-required";

export type CloudProjectsSliceState = {
  // null means "never listed" — distinct from a successful empty listing, which
  // is the only thing allowed to say there are no cloud backups.
  cloudProjects: CloudProjectFolder[] | null;
  cloudProjectsStatus: CloudProjectsStatus;
  // The account's sync heads, listed alongside the backup folders so a row can
  // tell which folders have a canonical copy behind them. Also null-means-never-
  // listed, and deliberately its own failure domain: heads are an enhancement of
  // this listing, so losing them must never blank the backups the user came for.
  cloudSyncHeads: SyncHeadListing[] | null;
  // Row key of the open in flight, so that row can disable and spin: a folder
  // name for a backup folder's row, getCloudSyncRowKey(projectId) for a row that
  // exists only because a head does. One field, because only one open runs.
  cloudProjectOpening: string | null;
};

export type CloudProjectsSliceActions = {
  // Re-list the provider's backup folders (and its sync heads). Inert unless a
  // provider is connected.
  refreshCloudProjects: () => Promise<void>;
  // Open a cloud project into this device. A folder with a sync head and no
  // local counterpart opens FROM THE HEAD and links this device to it (the
  // device-handoff path); everything else downloads the folder's newest backup,
  // identity-preserving when no local project matches the folder's id prefix
  // and a forced copy when one does. Resolves true once the import pipeline has
  // accepted the package (which may mean it parked in the artwork conflict
  // dialog) so the caller can close the project manager.
  openCloudProjectBackup: (folder: CloudProjectFolder) => Promise<boolean>;
  // Open a project that exists in this account ONLY as a sync head — no backup
  // folder to restore from, which is the ordinary shape of a project synced
  // moments after it was created. Same head-open implementation the folder rows
  // reach through, minus the folder: there is no backup to fall back to, so
  // anything that makes linking unsafe refuses outright.
  openCloudSyncedProject: (head: SyncHeadListing) => Promise<boolean>;
};

export const CLOUD_PROJECTS_SLICE_INITIAL: CloudProjectsSliceState = {
  cloudProjects: null,
  cloudProjectsStatus: "idle",
  cloudSyncHeads: null,
  cloudProjectOpening: null
};

export type CloudProjectsSliceInternals = {
  deps: AppStoreDeps;
};

export function createCloudProjectsSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: CloudProjectsSliceInternals
): { actions: CloudProjectsSliceActions } {
  const { deps } = internals;

  function provider(): CloudBackupProvider | null {
    return deps.cloudBackupProvider ?? null;
  }

  // Narrow a provider's classification to the kinds this surface words
  // differently; a provider-specific kind with no restore meaning is transient.
  function openErrorKind(error: unknown): CloudProjectOpenErrorKind {
    if (!(error instanceof CloudBackupError)) return "transient";
    switch (error.kind) {
      case "reauth":
      case "not-found":
      case "rate-limit":
      case "quota":
      case "too-large":
        return error.kind;
      default:
        return "transient";
    }
  }

  // null means the device's projects could not be read — never "there are
  // none". Treating a failed read as an empty device is the direction that
  // could turn a copy into an identity-preserving import.
  async function localProjectIds(): Promise<string[] | null> {
    try {
      const summaries = await deps.projectRepository.list();
      return summaries.map((summary) => summary.id);
    } catch {
      return null;
    }
  }

  // The head whose project id starts with this folder's id prefix, if the
  // account has one. The prefix is the same 8-char display heuristic the rest
  // of this file distrusts — it only decides WHICH file to download, and the
  // import pipeline still reads identity from the manifest.
  //
  // Two heads under one prefix means the guess cannot pick between them, and
  // matchOneSyncHead answers null: fall back to the backup path rather than
  // linking this device to whichever one happened to be listed first. The row
  // model reads it the same way, from the same helper, so the label a row shows
  // and the file this action fetches can never disagree.
  function findSyncHead(prefix: string): SyncHeadListing | null {
    return matchOneSyncHead(get().cloudSyncHeads, prefix);
  }

  // Open the project's canonical copy and link this device to it. The import
  // preserves identity and records the rev, which is the whole handoff: from
  // the next check on, this device and the one that created the head are
  // syncing the same project.
  async function openFromSyncHead(
    active: CloudBackupProvider,
    head: SyncHeadListing
  ): Promise<boolean> {
    // Same ceiling, same reason as a backup download (this tab has to buffer
    // the whole file), answered from the listing before spending the bytes.
    if (typeof head.sizeBytes === "number" && head.sizeBytes > MAX_BACKUP_DOWNLOAD_BYTES) {
      toast.error(getCloudSyncOpenErrorMessage("too-large"));
      return false;
    }

    let downloaded: { bytes: Uint8Array; rev: string };
    try {
      downloaded = await active.downloadSyncHead(head.projectId);
    } catch (error) {
      const kind = openErrorKind(error);
      set({
        cloudBackupProviderStatus: active.getStatus(),
        ...(kind === "reauth" ? { cloudProjectsStatus: "reauth-required" as const } : {})
      });
      toast.error(getCloudSyncOpenErrorMessage(kind));
      // The listing is what claimed this head existed; a gone file makes the
      // whole listing suspect, not just this row.
      if (kind === "not-found") await actions.refreshCloudProjects();
      return false;
    }

    // Copy into a standalone ArrayBuffer: the provider may hand back a view
    // into a pooled buffer, and the import pipeline keeps the bytes.
    const buffer = new ArrayBuffer(downloaded.bytes.byteLength);
    new Uint8Array(buffer).set(downloaded.bytes);

    // `link`, never `replace`: there is no local project to supersede here, so
    // the commit only seeds the sync bookkeeping (rev + fingerprint) that makes
    // this device a participant.
    return await get().importSyncHeadPackage(buffer, {
      link: { projectId: head.projectId, rev: downloaded.rev }
    });
  }

  // The stage-1 restore path, unchanged: the folder's newest backup file,
  // identity-preserving unless a local project looks like this one.
  async function openFromNewestBackup(
    active: CloudBackupProvider,
    folder: CloudProjectFolder,
    // Passed only when the head branch already had to ask; otherwise this path
    // reads it after the download, exactly as it always has.
    knownMatchesLocalProject?: boolean
  ): Promise<boolean> {
    const latest = folder.latestBackup;
    if (!latest) {
      toast.error(CLOUD_PROJECT_NO_BACKUP_MESSAGE);
      return false;
    }

    // Uploads are deliberately uncapped (a backup that silently stops is the
    // worse failure), while a download has to fit in this tab's memory — so a
    // backup can legitimately exist that this surface can never open. Say so
    // from the listing's own size, before spending the bytes: the download
    // would only fail the same way after a long wait.
    if (
      typeof latest.sizeBytes === "number" &&
      latest.sizeBytes > MAX_BACKUP_DOWNLOAD_BYTES
    ) {
      toast.error(getCloudProjectOpenErrorMessage("too-large"));
      return false;
    }

    let bytes: Uint8Array;
    try {
      bytes = await active.downloadBackup(latest.path);
    } catch (error) {
      const kind = openErrorKind(error);
      set({
        cloudBackupProviderStatus: active.getStatus(),
        ...(kind === "reauth" ? { cloudProjectsStatus: "reauth-required" as const } : {})
      });
      toast.error(getCloudProjectOpenErrorMessage(kind));
      // The listing is what claimed this file existed, so a gone file makes
      // the whole listing suspect, not just this row.
      if (kind === "not-found") await actions.refreshCloudProjects();
      return false;
    }

    const matches =
      knownMatchesLocalProject ?? (await matchesLocalProject(folder.projectIdPrefix));

    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    // lastBackupIso is the timestamp of the very file being restored: on a
    // commit that preserves identity, the import seeds this device's
    // cloud-backup meta with it, so the scheduler doesn't immediately
    // re-upload content Dropbox already holds. Telemetry for a restore
    // fires at that commit too, never here — an import that only parks in
    // the conflict dialog may still be cancelled.
    return await get().importCloudBackupPackage(buffer, {
      asCopy: matches,
      lastBackupIso: latest.serverModifiedIso
    });
  }

  // Does a project on this device look like this folder's? An unreadable device
  // answers "yes", which is the fail-closed direction: it costs a redundant
  // copy, where a "no" could turn a copy into an identity-preserving import —
  // or, now, into a link this device has no business making.
  async function matchesLocalProject(prefix: string): Promise<boolean> {
    if (prefix.length === 0) return false;
    const localIds = await localProjectIds();
    return localIds === null || localIds.some((id) => id.startsWith(prefix));
  }

  const actions: CloudProjectsSliceActions = {
    async refreshCloudProjects() {
      const active = provider();
      if (!active || active.getStatus() !== "connected") {
        set({ ...CLOUD_PROJECTS_SLICE_INITIAL });
        return;
      }
      // One listing at a time; the dialog can ask on every open.
      if (get().cloudProjectsStatus === "loading") return;

      set({ cloudProjectsStatus: "loading" });
      // One round trip each, in parallel and settled independently: the heads
      // decide how a row OPENS, but the folders are the listing itself. A heads
      // failure therefore costs the handoff affordance for this pass, never the
      // backups the user opened this dialog to see.
      const [folders, heads] = await Promise.allSettled([
        active.listCloudProjects(),
        active.listSyncHeads()
      ]);

      set({
        // A failed heads listing reads as "not listed", not as "no project is
        // synced": claiming the latter would quietly offer a plain restore for
        // a project this device could have linked to.
        cloudSyncHeads: heads.status === "fulfilled" ? heads.value : null
      });

      if (folders.status === "fulfilled") {
        set({ cloudProjects: folders.value, cloudProjectsStatus: "loaded" });
        return;
      }
      const kind =
        folders.reason instanceof CloudBackupError ? folders.reason.kind : "transient";
      set({
        cloudProjectsStatus: kind === "reauth" ? "reauth-required" : "error",
        cloudBackupProviderStatus: active.getStatus()
      });
    },

    async openCloudProjectBackup(folder) {
      const active = provider();
      if (!active || active.getStatus() !== "connected") return false;
      if (get().cloudProjectOpening !== null) return false;

      // Claimed synchronously, before the first await: the row has to disable
      // immediately, and a second click must lose the race no matter which
      // branch below this one takes.
      set({ cloudProjectOpening: folder.folderName });
      try {
        // Device handoff: a project with a canonical copy in Dropbox that this
        // device does not have opens from the HEAD, not from a backup file —
        // that is what leaves the two devices editing one project. A prefix
        // match with something already here keeps the copy path untouched:
        // copies are never linked, and the prefix is a display guess besides.
        //
        // The local-projects read happens here only when a head is actually in
        // play; on the plain restore path it stays where it was, after the
        // download, so nothing about that path's timing changed.
        const head = findSyncHead(folder.projectIdPrefix);
        if (head) {
          const matches = await matchesLocalProject(folder.projectIdPrefix);
          if (!matches) return await openFromSyncHead(active, head);
          return await openFromNewestBackup(active, folder, matches);
        }

        return await openFromNewestBackup(active, folder);
      } finally {
        set({ cloudProjectOpening: null });
      }
    },

    async openCloudSyncedProject(head) {
      const active = provider();
      if (!active || active.getStatus() !== "connected") return false;
      if (get().cloudProjectOpening !== null) return false;

      set({ cloudProjectOpening: getCloudSyncRowKey(head.projectId) });
      try {
        // The row model already withheld this row for a project that is here,
        // but it read a list the dialog fetched once, minutes ago, and a head
        // open writes under the package's OWN id — an id already in use would be
        // overwritten with no snapshot behind it. So the device is re-read here,
        // authoritatively, exactly as the folder path re-reads it. Full id
        // against full id: a head's file name IS the project id, so there is no
        // prefix guess to make and none to forgive.
        const localIds = await localProjectIds();
        if (localIds === null) {
          toast.error(CLOUD_SYNC_LOCAL_CHECK_FAILED_MESSAGE);
          return false;
        }
        if (localIds.includes(head.projectId)) {
          toast.error(CLOUD_SYNC_PROJECT_ALREADY_HERE_MESSAGE);
          return false;
        }
        return await openFromSyncHead(active, head);
      } finally {
        set({ cloudProjectOpening: null });
      }
    }
  };

  return { actions };
}
