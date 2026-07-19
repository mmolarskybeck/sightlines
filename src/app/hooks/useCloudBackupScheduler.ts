// Auto-backup scheduler. Watches the open project for changes and, once they
// settle and enough time has passed since the last upload, fires a single cloud
// backup. Two gates keep a large display-tier package from re-uploading on
// every edit: an idle SETTLE window after the last change, and a MIN interval
// between uploads. The decision itself is the pure shouldBackupNow (unit-tested
// as a matrix); the hook only feeds it observed timings and wires the flush.

import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useAppStore } from "../store";
import {
  selectBackupFingerprint
} from "../store/cloudBackupSlice";
import { readCloudBackupMeta } from "../store/cloudBackupMeta";

// Idle settle after the last change before backing up (~3 min).
export const CLOUD_BACKUP_SETTLE_MS = readMsEnv(
  import.meta.env.VITE_CLOUD_BACKUP_SETTLE_MS,
  180_000
);
// Minimum spacing between uploads (~12 min).
export const CLOUD_BACKUP_MIN_INTERVAL_MS = readMsEnv(
  import.meta.env.VITE_CLOUD_BACKUP_MIN_INTERVAL_MS,
  720_000
);
// How often the scheduler re-evaluates the gates.
const CHECK_INTERVAL_MS = 15_000;

function readMsEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export type ShouldBackupNowInput = {
  connected: boolean;
  dirty: boolean;
  uploading: boolean;
  // Time since the last observed change (idle settle is measured from here).
  msSinceLastSave: number;
  // Time since the last successful upload (Infinity when never uploaded).
  msSinceLastUpload: number;
  settleMs: number;
  minIntervalMs: number;
};

// Pure gate: back up only when connected, there are un-backed-up changes, no
// upload is already running, the changes have settled, AND we're past the
// minimum interval since the last upload.
export function shouldBackupNow(input: ShouldBackupNowInput): boolean {
  if (!input.connected) return false;
  if (!input.dirty) return false;
  if (input.uploading) return false;
  if (input.msSinceLastSave < input.settleMs) return false;
  if (input.msSinceLastUpload < input.minIntervalMs) return false;
  return true;
}

export function useCloudBackupScheduler(): void {
  const project = useAppStore((state) => state.project);
  const libraryArtworks = useAppStore((state) => state.libraryArtworks);
  const providerStatus = useAppStore((state) => state.cloudBackupProviderStatus);
  const lastCloudBackupAt = useAppStore((state) => state.lastCloudBackupAt);
  const runCloudBackup = useAppStore((state) => state.runCloudBackup);

  const connected = providerStatus === "connected";

  // Current backup fingerprint of the open project + its library.
  const currentFingerprint = useMemo(
    () => (project ? selectBackupFingerprint(project, libraryArtworks) : null),
    [project, libraryArtworks]
  );

  // Backed-up fingerprint from stored meta; re-read whenever an upload lands
  // (lastCloudBackupAt advances) or the project changes.
  const backedUpFingerprint = useMemo(
    () => (project ? readCloudBackupMeta(project.id).backedUpFingerprint : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.id, lastCloudBackupAt]
  );

  const dirty =
    connected &&
    currentFingerprint !== null &&
    currentFingerprint !== backedUpFingerprint;

  // Mark the last time the document changed, so the settle window is measured
  // from the most recent edit rather than from mount.
  const lastActivityAtRef = useRef(Date.now());
  useEffect(() => {
    lastActivityAtRef.current = Date.now();
  }, [currentFingerprint]);

  // Surface "changes waiting to back up" for the popover/status copy.
  useEffect(() => {
    useAppStore.setState({ cloudBackupPending: dirty });
  }, [dirty]);

  // Keep the latest observed values in refs so the single interval reads fresh
  // state without re-subscribing on every render.
  const stateRef = useRef({
    connected,
    dirty,
    lastCloudBackupAt,
    runCloudBackup
  });
  stateRef.current = { connected, dirty, lastCloudBackupAt, runCloudBackup };

  // Periodic gate evaluation.
  useEffect(() => {
    const tick = () => {
      const { connected: isConnected, dirty: isDirty, lastCloudBackupAt: lastUpload, runCloudBackup: run } =
        stateRef.current;
      const uploading = useAppStore.getState().cloudBackupStatus === "uploading";
      const now = Date.now();
      const msSinceLastUpload = lastUpload
        ? now - Date.parse(lastUpload)
        : Number.POSITIVE_INFINITY;
      if (
        shouldBackupNow({
          connected: isConnected,
          dirty: isDirty,
          uploading,
          msSinceLastSave: now - lastActivityAtRef.current,
          msSinceLastUpload,
          settleMs: CLOUD_BACKUP_SETTLE_MS,
          minIntervalMs: CLOUD_BACKUP_MIN_INTERVAL_MS
        })
      ) {
        void run();
      }
    };
    const handle = window.setInterval(tick, CHECK_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, []);

  // Best-effort flush when the tab is hidden: a curator switching away or
  // closing the tab shouldn't lose the settle-window's changes. No await
  // guarantee (the page may unload); one upload at a time is still enforced by
  // runCloudBackup. The settle/interval gates are skipped on hide — this is the
  // last chance to capture pending work.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      const { connected: isConnected, dirty: isDirty, runCloudBackup: run } =
        stateRef.current;
      if (isConnected && isDirty) void run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}

// Cloud backup failures get their OWN toast surface — separate from the
// save-error toast so a project-save failure and a cloud-upload failure never
// masquerade as each other. Fires once on the transition into a new error
// message (a repeated same-message failure across retry cycles is one episode),
// with a Retry that re-runs the upload.
export function useCloudBackupErrorToast(): void {
  const cloudBackupError = useAppStore((state) => state.cloudBackupError);
  const runCloudBackup = useAppStore((state) => state.runCloudBackup);
  const prevRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = cloudBackupError;
    if (!cloudBackupError || cloudBackupError === prev) return;
    toast.error(cloudBackupError, {
      action: {
        label: "Retry",
        onClick: () => {
          void runCloudBackup();
        }
      }
    });
  }, [cloudBackupError, runCloudBackup]);
}
