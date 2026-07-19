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

  // Build the package into the provider's backup location and prune old copies
  // to the retention cap. Resolves on a successful UPLOAD even if pruning fails
  // (pruning retries next cycle). Rejects on a failed upload; the thrown error
  // is classified (transient vs. auth-revocation vs. quota) so the caller can
  // decide whether to surface a reauth prompt or just retry later.
  uploadBackup(input: UploadBackupInput): Promise<void>;
}
