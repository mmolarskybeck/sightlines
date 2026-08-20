// Persistence contract for per-project cross-device sync bookkeeping: which
// account and which remote revision this device's copy descends from. It is
// device-local state ABOUT a project, never part of the project document, undo
// history, or a `.sightlines` package — an exported project carries no claim
// about anyone's Dropbox.
//
// Losing a record degrades safely (the project reads as unlinked); a WRONG
// record does not, which is why every field the state machine trusts is
// validated on read and a malformed record is treated as absent.

// Bumped only when the meaning of these fields changes. A record from a future
// protocol is not reinterpreted — sync stops for that project instead.
export const SYNC_PROTOCOL_VERSION = 1;

export type ProjectSyncMeta = {
  projectId: string;
  provider: "dropbox";
  // Dropbox's stable account id, NOT the display name: a display name is
  // mutable and ambiguous, so binding to it would let a relink to a different
  // account inherit this account's revision lineage.
  accountId: string;
  // The head's provider path (syncHeadPath(projectId)). Stored rather than
  // recomputed so a future path-layout change can be detected, not silently
  // applied to records written under the old layout.
  remotePath: string;
  // The rev of the head this device's copy is based on — the ONLY ancestry
  // mechanism. Timestamps below are for display and never for lineage.
  lastAcceptedRev: string;
  // The local backup fingerprint corresponding to that rev. The fingerprint is
  // a dirty-check heuristic; pairing it with the rev is what lets the state
  // machine tell "this device changed" from "the remote changed".
  fingerprintAtRev: string;
  lastPullAtIso: string | null;
  lastPushAtIso: string | null;
  protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  // Set by "Not now" on a conflict: sync stops for this project and shows a
  // persisted "Needs review" state, so a reload does not re-prompt.
  paused: boolean;
};

export interface SyncMetaRepository {
  // undefined when the project is not linked — including when a stored record
  // is malformed or written by a newer protocol.
  get(projectId: string): Promise<ProjectSyncMeta | undefined>;
  put(record: ProjectSyncMeta): Promise<void>;
  // Unlinking a device. The remote head is deliberately untouched: other
  // devices rely on it, and turning sync off here must never destroy it.
  delete(projectId: string): Promise<void>;
  // Every linked project on this device (for the cloud project browser).
  list(): Promise<ProjectSyncMeta[]>;
}

// Corrupt-tolerant read, in the spirit of cloudBackupMeta's reader: a record
// that is missing a field the state machine depends on cannot be repaired by
// guessing, so it reads as "not linked" and the user can link again.
export function parseProjectSyncMeta(value: unknown): ProjectSyncMeta | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<ProjectSyncMeta>;
  if (
    typeof record.projectId !== "string" ||
    record.projectId.length === 0 ||
    record.provider !== "dropbox" ||
    typeof record.accountId !== "string" ||
    record.accountId.length === 0 ||
    typeof record.remotePath !== "string" ||
    typeof record.lastAcceptedRev !== "string" ||
    record.lastAcceptedRev.length === 0 ||
    typeof record.fingerprintAtRev !== "string" ||
    record.protocolVersion !== SYNC_PROTOCOL_VERSION
  ) {
    return undefined;
  }
  return {
    projectId: record.projectId,
    provider: "dropbox",
    accountId: record.accountId,
    remotePath: record.remotePath,
    lastAcceptedRev: record.lastAcceptedRev,
    fingerprintAtRev: record.fingerprintAtRev,
    lastPullAtIso:
      typeof record.lastPullAtIso === "string" ? record.lastPullAtIso : null,
    lastPushAtIso:
      typeof record.lastPushAtIso === "string" ? record.lastPushAtIso : null,
    protocolVersion: SYNC_PROTOCOL_VERSION,
    // An unreadable pause flag defaults to paused=false: the cost is one
    // re-prompt, where the opposite default silently stops syncing a project.
    paused: record.paused === true
  };
}
