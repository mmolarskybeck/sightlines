// Cross-device sync scheduler. Mirrors useCloudBackupScheduler's shape — an
// idle SETTLE window plus a MIN interval, evaluated by a pure gate — but the
// gates are much tighter (seconds, not minutes): a synced project is a project
// another device may be waiting on, and the head is one small display-tier file
// that gets replaced rather than a retention slot that gets burned.
//
// The gate never pushes directly. It runs checkProjectSync(), whose "push" arm
// uploads — because the pre-upload evaluation IS the state machine, and a blind
// push would overwrite a remote that moved on (or rather, fail its conditional
// write for no reason).

import { useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../store";
import { selectBackupFingerprint } from "../store/cloudBackupSlice";

// Idle settle after the last change before syncing (~20s).
export const CLOUD_SYNC_SETTLE_MS = readMsEnv(
  import.meta.env.VITE_CLOUD_SYNC_SETTLE_MS,
  20_000
);
// Minimum spacing between head writes (~60s).
export const CLOUD_SYNC_MIN_INTERVAL_MS = readMsEnv(
  import.meta.env.VITE_CLOUD_SYNC_MIN_INTERVAL_MS,
  60_000
);
// How often the scheduler re-evaluates the gates.
const CHECK_INTERVAL_MS = 5_000;

function readMsEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export type ShouldSyncNowInput = {
  connected: boolean;
  // The open project has usable sync metadata for this account.
  linked: boolean;
  // "Not now" on a conflict: the project waits for an explicit review.
  paused: boolean;
  // Local content differs from the fingerprint recorded at the accepted rev.
  dirty: boolean;
  // A check, push, or pull already owns the project.
  busy: boolean;
  // Time since the last observed change (idle settle is measured from here).
  msSinceLastChange: number;
  // Time since the last push or pull (Infinity when neither has happened).
  msSinceLastSync: number;
  settleMs: number;
  minIntervalMs: number;
};

// Pure gate: evaluate only when the project is linked and syncing, has changes
// nobody has sent yet, nothing is already in flight, the changes have settled,
// AND we are past the minimum interval. Remote-only changes are picked up by the
// focus/visibility/project-open poll points instead — polling Dropbox every few
// seconds for a project this device isn't touching buys nothing.
export function shouldSyncNow(input: ShouldSyncNowInput): boolean {
  if (!input.connected) return false;
  if (!input.linked) return false;
  if (input.paused) return false;
  if (!input.dirty) return false;
  if (input.busy) return false;
  if (input.msSinceLastChange < input.settleMs) return false;
  if (input.msSinceLastSync < input.minIntervalMs) return false;
  return true;
}

// Most recent push or pull, whichever is later. Only used for spacing writes —
// never for lineage, which is the rev alone.
function msSinceLastSyncOf(
  lastPushAtIso: string | null,
  lastPullAtIso: string | null,
  now: number
): number {
  const times = [lastPushAtIso, lastPullAtIso]
    .filter((iso): iso is string => iso !== null)
    .map((iso) => Date.parse(iso))
    .filter((value) => Number.isFinite(value));
  if (times.length === 0) return Number.POSITIVE_INFINITY;
  return now - Math.max(...times);
}

export function useProjectSyncScheduler(): void {
  const project = useAppStore((state) => state.project);
  const libraryArtworks = useAppStore((state) => state.libraryArtworks);
  const providerStatus = useAppStore((state) => state.cloudBackupProviderStatus);
  const syncMeta = useAppStore((state) => state.syncMeta);
  const checkProjectSync = useAppStore((state) => state.checkProjectSync);
  const refreshProjectSyncState = useAppStore((state) => state.refreshProjectSyncState);

  const connected = providerStatus === "connected";
  const projectId = project?.id ?? null;

  // Current fingerprint of the open project + its library — the same derivation
  // the slice compares against meta.fingerprintAtRev, so the two always agree.
  const currentFingerprint = useMemo(
    () => (project ? selectBackupFingerprint(project, libraryArtworks) : null),
    [project, libraryArtworks]
  );

  const linked =
    connected && syncMeta !== null && projectId !== null && syncMeta.projectId === projectId;
  const dirty =
    linked && currentFingerprint !== null && currentFingerprint !== syncMeta!.fingerprintAtRev;

  // Measure the settle window from the most recent edit, not from mount.
  const lastActivityAtRef = useRef(Date.now());
  useEffect(() => {
    lastActivityAtRef.current = Date.now();
  }, [currentFingerprint]);

  // Reflect "Changes waiting to sync" for the status surfaces — but only over
  // the two statuses that describe a quiet project. A conflict, a needs-review,
  // an error, or an in-flight round trip all outrank a dirty fingerprint.
  useEffect(() => {
    const status = useAppStore.getState().syncStatus;
    if (dirty && status === "synced") useAppStore.setState({ syncStatus: "pending" });
    if (!dirty && status === "pending") useAppStore.setState({ syncStatus: "synced" });
  }, [dirty]);

  // Keep the latest observed values in refs so the single interval reads fresh
  // state without re-subscribing on every render.
  const stateRef = useRef({ connected, linked, dirty, syncMeta, checkProjectSync });
  stateRef.current = { connected, linked, dirty, syncMeta, checkProjectSync };

  // Periodic gate evaluation.
  useEffect(() => {
    const tick = () => {
      const {
        connected: isConnected,
        linked: isLinked,
        dirty: isDirty,
        syncMeta: meta,
        checkProjectSync: check
      } = stateRef.current;
      const status = useAppStore.getState().syncStatus;
      const now = Date.now();
      if (
        shouldSyncNow({
          connected: isConnected,
          linked: isLinked,
          paused: meta?.paused === true,
          dirty: isDirty,
          busy: status === "checking" || status === "pushing" || status === "pulling",
          msSinceLastChange: now - lastActivityAtRef.current,
          msSinceLastSync: msSinceLastSyncOf(
            meta?.lastPushAtIso ?? null,
            meta?.lastPullAtIso ?? null,
            now
          ),
          settleMs: CLOUD_SYNC_SETTLE_MS,
          minIntervalMs: CLOUD_SYNC_MIN_INTERVAL_MS
        })
      ) {
        void check();
      }
    };
    const handle = window.setInterval(tick, CHECK_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, []);

  // Device handoff lives here: coming back to the tab is exactly when the other
  // device's work should arrive, so focus and becoming visible both evaluate the
  // state machine (its pull arm downloads). Going hidden is a best-effort flush
  // of local changes, like the backup scheduler's — no await guarantee, and the
  // guarded write plus the check on the next open is what makes handoff
  // reliable, not this.
  useEffect(() => {
    // Both directions of a visibility change evaluate: becoming visible is the
    // pull point, going hidden is the flush. Same call either way — the state
    // machine's own arms decide which one it turns out to be.
    const evaluate = () => {
      const { connected: isConnected, linked: isLinked, checkProjectSync: check } =
        stateRef.current;
      if (isConnected && isLinked) void check();
    };
    window.addEventListener("focus", evaluate);
    document.addEventListener("visibilitychange", evaluate);
    return () => {
      window.removeEventListener("focus", evaluate);
      document.removeEventListener("visibilitychange", evaluate);
    };
  }, []);

  // Opening a project: read its stored metadata, THEN evaluate. The order
  // matters — a check that runs before the refresh would find no metadata and
  // conclude the project is unlinked.
  useEffect(() => {
    if (!projectId || !connected) return;
    let cancelled = false;
    void (async () => {
      await refreshProjectSyncState();
      if (cancelled) return;
      await checkProjectSync();
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, connected, refreshProjectSyncState, checkProjectSync]);
}
