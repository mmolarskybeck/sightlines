// Cloud-backup store slice: connects the provider seam to the document, owns
// the auto-backup upload, and mirrors provider status into observable state for
// the UI. The scheduler (useCloudBackupScheduler) decides WHEN to call
// runCloudBackup; this slice decides WHAT gets uploaded and how success is
// recorded.
//
// The fingerprint is captured at upload START; after a successful upload the
// project is marked backed-up ONLY if its current fingerprint still matches the
// captured one — so an edit made during a long upload correctly leaves the
// project dirty for the next cycle.

import { CloudBackupError } from "../cloud/dropbox";
import type {
  CloudBackupProvider,
  CloudBackupProviderStatus
} from "../cloud/provider";
import {
  collectReferencedAssetIds,
  computeBackupFingerprint
} from "../../domain/backup/fingerprint";
import { selectReferencedArtworks } from "../../domain/package/buildPackage";
import { buildProjectPackage } from "../../domain/package/packageService";
import type { Artwork, Project } from "../../domain/project";
import type { AppState, AppStoreDeps } from "../store";
import { readCloudBackupMeta, writeCloudBackupMeta } from "./cloudBackupMeta";
import { telemetry } from "../telemetry/telemetry";

export type CloudBackupUploadStatus = "idle" | "uploading" | "error";

export type CloudBackupSliceState = {
  // Provider link status, mirrored from the provider for the UI.
  cloudBackupProviderStatus: CloudBackupProviderStatus;
  cloudBackupAccountLabel: string | null;
  // The upload lifecycle (distinct from link status).
  cloudBackupStatus: CloudBackupUploadStatus;
  // ISO time of the current project's last successful upload, or null.
  lastCloudBackupAt: string | null;
  // True while the project has changes not yet backed up and the scheduler is
  // waiting to upload them.
  cloudBackupPending: boolean;
  // Human-readable last upload error, or null.
  cloudBackupError: string | null;
};

export type CloudBackupSliceActions = {
  // Begin linking (full-page redirect for Dropbox).
  connectCloudBackup: () => Promise<void>;
  // Forget the local link. Remote backups are untouched.
  disconnectCloudBackup: () => void;
  // Finish a connect redirect on boot; refreshes status when it handled one.
  completeCloudBackupConnect: () => Promise<void>;
  // Build + upload a backup of the open project (see fingerprint semantics above).
  runCloudBackup: () => Promise<void>;
  // Re-read provider status/account + this project's stored meta into state.
  refreshCloudBackupStatus: () => void;
};

export const CLOUD_BACKUP_SLICE_INITIAL: CloudBackupSliceState = {
  cloudBackupProviderStatus: "disconnected",
  cloudBackupAccountLabel: null,
  cloudBackupStatus: "idle",
  lastCloudBackupAt: null,
  cloudBackupPending: false,
  cloudBackupError: null
};

// The backup fingerprint of a project + its library, the same derivation the
// snapshot layer uses. Shared with the scheduler's dirty check so both agree.
export function selectBackupFingerprint(
  project: Project,
  libraryArtworks: Artwork[]
): string {
  const artworks = selectReferencedArtworks(project, libraryArtworks);
  const assetIds = collectReferencedAssetIds(artworks);
  return computeBackupFingerprint({ project, artworks, assetIds });
}

export type CloudBackupSliceInternals = {
  deps: AppStoreDeps;
};

export function createCloudBackupSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: CloudBackupSliceInternals
): { actions: CloudBackupSliceActions } {
  const { deps } = internals;

  function provider(): CloudBackupProvider | null {
    return deps.cloudBackupProvider ?? null;
  }

  // Fold the provider's link status + the open project's stored meta into
  // observable state. Called on boot, after connect/disconnect/upload, and by
  // the wiring when the project changes.
  function refreshCloudBackupStatus(): void {
    const active = provider();
    if (!active) {
      set({ ...CLOUD_BACKUP_SLICE_INITIAL });
      return;
    }
    const project = get().project;
    const meta = project
      ? readCloudBackupMeta(project.id)
      : { lastCloudBackupAt: null, backedUpFingerprint: null };
    set({
      cloudBackupProviderStatus: active.getStatus(),
      cloudBackupAccountLabel: active.accountLabel(),
      lastCloudBackupAt: meta.lastCloudBackupAt
    });
  }

  const actions: CloudBackupSliceActions = {
    async connectCloudBackup() {
      const active = provider();
      if (!active) return;
      await active.startConnect();
    },

    disconnectCloudBackup() {
      const active = provider();
      if (!active) return;
      active.disconnect();
      set({
        cloudBackupProviderStatus: "disconnected",
        cloudBackupAccountLabel: null,
        cloudBackupStatus: "idle",
        cloudBackupPending: false,
        cloudBackupError: null
      });
    },

    async completeCloudBackupConnect() {
      const active = provider();
      if (!active) return;
      const handled = await active.completeConnect();
      if (handled) {
        refreshCloudBackupStatus();
        telemetry.track("cloud_backup_connected", { provider: "dropbox" });
      }
    },

    refreshCloudBackupStatus,

    async runCloudBackup() {
      const active = provider();
      const project = get().project;
      if (!active || !project) return;
      if (active.getStatus() !== "connected") {
        // Surface a reauth link state if that's why we can't upload.
        refreshCloudBackupStatus();
        return;
      }
      // One upload at a time.
      if (get().cloudBackupStatus === "uploading") return;

      const capturedFingerprint = selectBackupFingerprint(
        project,
        get().libraryArtworks
      );

      set({ cloudBackupStatus: "uploading", cloudBackupError: null });
      try {
        const { blob } = await buildProjectPackage({
          project,
          libraryArtworks: get().libraryArtworks,
          mode: "display",
          getAsset: (assetId) => deps.assetRepository.getAsset(assetId),
          getBlob: (key) => deps.assetRepository.getBlob(key)
        });
        const timestampIso = new Date().toISOString();
        await active.uploadBackup({
          projectId: project.id,
          projectTitle: project.title,
          blob,
          timestampIso
        });

        // Mark backed-up only if the project hasn't changed since we captured
        // the fingerprint. The upload itself always counts (records the time).
        const currentProject = get().project;
        const stillSame =
          currentProject !== null &&
          currentProject.id === project.id &&
          selectBackupFingerprint(currentProject, get().libraryArtworks) ===
            capturedFingerprint;

        const existing = readCloudBackupMeta(project.id);
        writeCloudBackupMeta(project.id, {
          lastCloudBackupAt: timestampIso,
          backedUpFingerprint: stillSame
            ? capturedFingerprint
            : existing.backedUpFingerprint
        });

        set({
          cloudBackupStatus: "idle",
          cloudBackupError: null,
          lastCloudBackupAt: timestampIso,
          // Still dirty if an edit landed mid-upload.
          cloudBackupPending: !stillSame,
          cloudBackupProviderStatus: active.getStatus(),
          cloudBackupAccountLabel: active.accountLabel()
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Cloud backup failed.";
        const kind =
          error instanceof CloudBackupError ? error.kind : "transient";
        // Rate limiting is expected backpressure, not a failure to surface: go
        // quiet (still pending) and let the next cycle retry. Everything else —
        // a reauth (the provider already flipped its internal flag), a quota
        // problem, or a transient network error — is a real failure the user
        // should see, on the cloud-backup toast surface.
        if (kind === "rate-limit") {
          set({
            cloudBackupStatus: "idle",
            cloudBackupProviderStatus: active.getStatus(),
            cloudBackupAccountLabel: active.accountLabel()
          });
          return;
        }
        set({
          cloudBackupStatus: "error",
          cloudBackupError: message,
          cloudBackupProviderStatus: active.getStatus(),
          cloudBackupAccountLabel: active.accountLabel()
        });
      }
    }
  };

  return { actions };
}
