// Per-project cloud-backup bookkeeping, kept in localStorage keyed by project
// id. Provider-agnostic (it records WHAT was backed up and WHEN, not HOW), and
// deliberately separate from the provider's auth record. Reads are
// corrupt-tolerant: a malformed or partial record degrades to "no meta" rather
// than throwing, so a bad localStorage value never breaks the scheduler.

export const CLOUD_BACKUP_META_KEY_PREFIX = "sightlines:cloudBackupMeta:";

export type CloudBackupMeta = {
  // ISO time of the last successful upload for this project.
  lastCloudBackupAt: string | null;
  // The backup fingerprint that was uploaded (dirty check compares against the
  // project's current fingerprint). null when never successfully backed up.
  backedUpFingerprint: string | null;
};

const EMPTY_META: CloudBackupMeta = {
  lastCloudBackupAt: null,
  backedUpFingerprint: null
};

function keyFor(projectId: string): string {
  return `${CLOUD_BACKUP_META_KEY_PREFIX}${projectId}`;
}

export function readCloudBackupMeta(projectId: string): CloudBackupMeta {
  if (typeof window === "undefined") return { ...EMPTY_META };
  try {
    const raw = window.localStorage.getItem(keyFor(projectId));
    if (!raw) return { ...EMPTY_META };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...EMPTY_META };
    }
    const record = parsed as Partial<CloudBackupMeta>;
    return {
      lastCloudBackupAt:
        typeof record.lastCloudBackupAt === "string"
          ? record.lastCloudBackupAt
          : null,
      backedUpFingerprint:
        typeof record.backedUpFingerprint === "string"
          ? record.backedUpFingerprint
          : null
    };
  } catch {
    return { ...EMPTY_META };
  }
}

export function writeCloudBackupMeta(
  projectId: string,
  meta: CloudBackupMeta
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(keyFor(projectId), JSON.stringify(meta));
}

export function deleteCloudBackupMeta(projectId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(keyFor(projectId));
}
