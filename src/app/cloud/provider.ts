// The cloud-backup provider seam. Dropbox ships first (see dropbox.ts), but the
// interface is deliberately provider-agnostic so Drive/OneDrive can slot in
// later. The status model must distinguish "reauthorization-required" from
// "disconnected": future providers need renewed top-level authorization on a
// clock (Google testing refresh tokens expire after ~7 days, Microsoft SPA
// refresh tokens after 24h), and Safari can evict a still-valid Dropbox refresh
// token — in all of those the remote files survive and the fix is a cheap
// "Reconnect", not a fresh setup. "Connected" alone can't carry that.

export type CloudBackupProviderStatus =
  | "disconnected"
  | "connected"
  | "reauthorization-required";

export type CloudErrorKind =
  | "reauth"
  | "quota"
  | "rate-limit"
  | "not-found"
  | "conflict"
  | "too-large"
  | "transient";

// A typed error so a caller can tell reauth/quota/rate-limit/transient apart
// without re-parsing provider-specific HTTP details. Every CloudBackupProvider
// implementation throws this shape.
export class CloudBackupError extends Error {
  kind: CloudErrorKind;
  constructor(kind: CloudErrorKind, message: string) {
    super(message);
    this.name = "CloudBackupError";
    this.kind = kind;
  }
}

// A single backup to push: the pre-built package blob plus the identity the
// provider needs to key retention (full project id) and name the file (title +
// timestamp). The provider owns path construction and pruning.
export type UploadBackupInput = {
  projectId: string;
  projectTitle: string;
  blob: Blob;
  timestampIso: string;
};

// One backup file inside a project's backup folder, as listed for the cloud
// project browser. `path` is the provider path handed back to downloadBackup.
export type CloudProjectBackup = {
  path: string;
  name: string;
  serverModifiedIso: string | null;
  sizeBytes: number | null;
};

// A per-project backup folder in the provider's backup location. Identity here
// is heuristic: the folder name usually carries only the first 8 chars of the
// project UUID, so "matches a local project" is a display-level guess —
// authoritative identity is the manifest's project id, read only after
// download. Never treat projectIdPrefix as proof of identity. It may also be a
// full id (a pre-migration folder named with the bare project id) or "" (a
// folder holding backups under a name this app never wrote); both are still
// only labels.
export type CloudProjectFolder = {
  folderName: string;
  title: string;
  projectIdPrefix: string;
  backupCount: number;
  latestBackup: CloudProjectBackup | null;
};

// The state of one project's canonical synced copy ("sync head") as the
// provider reports it. `rev` is the whole lineage mechanism: a device records
// the rev its local copy is based on and writes conditionally against it, so
// two devices can never silently overwrite each other. Timestamps are display
// only — clocks disagree and upload order is not ancestry.
export type SyncHeadMetadata = {
  rev: string;
  serverModifiedIso: string | null;
  sizeBytes: number | null;
};

// A sync head as seen from a listing, which knows the project id (it is the
// folder name) and the provider path.
export type SyncHeadListing = SyncHeadMetadata & {
  projectId: string;
  path: string;
};

// Copy a provider's downloaded bytes into a standalone ArrayBuffer: a provider
// may hand back a view into a pooled buffer it reuses, and a caller (the
// import pipeline) needs to keep the bytes after this call returns.
export function toStandaloneArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

// --- storage management (docs/dropbox-storage-plan.md phase 2) -------------

// One file this app wrote, as the storage inventory reports it. `rev` lets a
// later delete assert "still the file the preview showed" (null when the
// provider gave none, in which case a delete is unconditional on content).
export type StorageFile = {
  path: string;
  name: string;
  sizeBytes: number;
  serverModifiedIso: string | null;
  rev: string | null;
};

// One backup folder: the unit retention prunes. A project can have more than
// one (the pre-migration bare-id folder plus the titled one).
export type StorageBackupFolder = {
  path: string;
  folderName: string;
  // Newest first.
  backups: StorageFile[];
};

// Everything stored for one project, grouped for display. Grouping by the
// 8-char id prefix is a DISPLAY aid only: deletion always works on the
// explicit file paths and revs listed here, never on the group.
export type StorageProjectGroup = {
  // Stable React/selection key: the full project id when known, otherwise
  // "prefix:<id8>", otherwise "folder:<area>:<lowercased folder name>".
  key: string;
  // Full project id, known only from a sync head path or a bare-id folder.
  projectId: string | null;
  idPrefix: string;
  // From the backup folder name, else the share folder name; null for a
  // project that exists only as a sync head (the UI supplies a label).
  title: string | null;
  head: StorageFile | null;
  backupFolders: StorageBackupFolder[];
  // Newest first.
  shares: StorageFile[];
};

export type StorageUsage = {
  usedBytes: number;
  // null when the account reports no individual/team allocation.
  allocatedBytes: number | null;
};

export type StorageInventory = {
  groups: StorageProjectGroup[];
  // Files under the app folder in no shape this app writes. Counted, never
  // offered for deletion.
  otherFiles: StorageFile[];
  // null when the usage request failed; the inventory is still usable.
  usage: StorageUsage | null;
  listedAtIso: string;
};

// Account-wide storage preferences, stored in the provider so every device
// agrees. Absent file = defaults.
export type StorageSettings = {
  backupsPerProject: number;
};

export type StorageDeleteOutcome =
  | "deleted"
  // Already gone — the goal state, reported separately for honesty.
  | "gone"
  // The file's rev no longer matches the preview; left alone.
  | "changed"
  | "failed";

export type StorageDeleteResult = {
  path: string;
  outcome: StorageDeleteOutcome;
  // Set for "failed".
  errorKind?: CloudErrorKind;
};

export interface CloudBackupProvider {
  // Stable machine id (e.g. "dropbox") and a human label ("Dropbox").
  readonly id: string;
  readonly label: string;

  // Begin linking. For a browser-only PKCE provider this is a full-page
  // redirect and never resolves in this document — the app reloads at the
  // redirect_uri and finishes in completeConnect(). Resolving vs. not is left
  // to the implementation so a future popup/token-exchange provider still fits.
  startConnect(): Promise<void>;

  // Called once on boot. Inspects the redirect params (?code=&state=), and if
  // this load is the tail of a connect redirect, completes the token exchange
  // and cleans the URL. Returns whether it handled a redirect for this provider
  // (so the caller can refresh status only when something changed).
  completeConnect(): Promise<boolean>;

  // Forget stored tokens locally. Remote files are untouched.
  disconnect(): void;

  // Cheap, synchronous read of the stored auth record's shape — never triggers
  // a network refresh (that happens lazily inside uploadBackup). "connected"
  // means a usable refresh token is on hand; "reauthorization-required" means
  // one existed but was revoked/evicted and the user must relink.
  getStatus(): CloudBackupProviderStatus;

  // Display name for the linked account, or null when not connected / unknown.
  accountLabel(): string | null;

  // Stable machine identifier for the linked account, or null when not
  // connected / unknown. Sync bookkeeping binds to THIS, never to
  // accountLabel(): a display name is mutable and ambiguous, so relinking to a
  // different account under the same name would otherwise resurrect another
  // account's revisions. Records written before the id was captured have none,
  // which is why null is a legitimate answer for a connected provider.
  accountId(): string | null;

  // The provider path a project's sync head lives at, and the ceiling on a
  // single download this tab can safely buffer. OPTIONAL: a caller falls back
  // to its own default when a provider (e.g. a test fake) does not implement
  // one, since only the real Dropbox provider needs to be asked.
  remotePathFor(projectId: string): string;
  maxDownloadBytes: number;

  // Build the package into the provider's backup location and prune old copies
  // to the retention cap. Resolves on a successful UPLOAD even if pruning fails
  // (pruning retries next cycle). Rejects on a failed upload; the thrown error
  // is classified (transient vs. auth-revocation vs. quota) so the caller can
  // decide whether to surface a reauth prompt or just retry later.
  uploadBackup(input: UploadBackupInput): Promise<void>;

  // Upload a frozen package snapshot and return a provider-hosted, view-only
  // file link. The caller wraps this provider URL in a Sightlines deep link;
  // later project edits never mutate an already-shared snapshot.
  createShareLink(input: UploadBackupInput): Promise<string>;

  // List the provider's per-project backup folders with their newest backup.
  // Read operations need a scope the original grant didn't include, so this
  // rejects with a classified "reauth" error when the stored grant predates
  // the read scope — the caller offers a one-time Reconnect, mirroring
  // createShareLink's gate.
  listCloudProjects(): Promise<CloudProjectFolder[]>;

  // Download one backup file's raw bytes for the package-import pipeline.
  // Rejects with a classified error; a path that no longer exists surfaces as
  // "not-found" (distinct from transient network trouble) so the caller can
  // say "that backup is gone" instead of offering a retry.
  downloadBackup(path: string): Promise<Uint8Array>;

  // --- cross-device sync ----------------------------------------------------
  //
  // The sync head is one canonical file per project, separate from the backup
  // history and from shared snapshots. Every method here is scope-gated the
  // same way the read side is: sync that cannot pull is useless.

  // Current state of a project's head, or null IFF it does not exist — a
  // project that has never been synced, or whose head was removed. Every other
  // failure rejects with a classified error, because "no head" is a decision
  // the caller acts on and must never be a guess about a failed request.
  getSyncHead(projectId: string): Promise<SyncHeadMetadata | null>;

  // Fetch the head's bytes together with the rev they came from — the rev the
  // pulling device will record as its base. Rejects "not-found" when the head
  // vanished between the check and the download, and enforces the same
  // download size ceiling as downloadBackup.
  downloadSyncHead(projectId: string): Promise<{ bytes: Uint8Array; rev: string }>;

  // Write the head as a revision-conditional upload. `baseRev` null means this
  // device is creating the head; a non-null baseRev asserts "the head is still
  // at this revision". Either way the write must FAIL, classified "conflict",
  // rather than overwrite a head that moved on or spawn a "(1)" copy — the
  // failure is what makes the conflict visible to the user.
  uploadSyncHead(input: {
    projectId: string;
    blob: Blob;
    baseRev: string | null;
  }): Promise<SyncHeadMetadata>;

  // Every synced project in the account, for the cloud project browser's
  // device-handoff rows. An empty list means no project has ever been synced
  // (the sync location does not exist yet), not that listing failed.
  listSyncHeads(): Promise<SyncHeadListing[]>;

  // --- storage management ----------------------------------------------------

  // One listing of everything this app stored, grouped by project, plus the
  // account's space usage (best-effort: usage null if that request fails).
  // Scope-gated like the read side.
  getStorageInventory(): Promise<StorageInventory>;

  // Delete specific backup or share files. MUST refuse (throw before any
  // request) a path outside /backups/<folder>/<file>.sightlines or
  // /shares/<folder>/<file>.sightlines, so a sync head can never be removed
  // through this method. Sequential, per-file results; never throws for a
  // single file's failure.
  deleteStorageFiles(
    files: Array<{ path: string; rev: string | null }>
  ): Promise<StorageDeleteResult[]>;

  // Account-wide storage settings; null when none were ever saved (or the
  // stored file is unreadable/invalid — callers then use defaults).
  readStorageSettings(): Promise<StorageSettings | null>;
  writeStorageSettings(settings: StorageSettings): Promise<void>;
}
