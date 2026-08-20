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
}
