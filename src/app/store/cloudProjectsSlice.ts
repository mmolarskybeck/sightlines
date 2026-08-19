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

import { toast } from "sonner";
import { CloudBackupError } from "../cloud/dropbox";
import {
  CLOUD_PROJECT_NO_BACKUP_MESSAGE,
  getCloudProjectOpenErrorMessage,
  type CloudProjectOpenErrorKind
} from "../cloud/cloudBackupCopy";
import type { CloudBackupProvider, CloudProjectFolder } from "../cloud/provider";
import type { AppState, AppStoreDeps } from "../store";
import { telemetry } from "../telemetry/telemetry";

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
  // folderName of the restore in flight, so its row can disable and spin.
  cloudProjectOpening: string | null;
};

export type CloudProjectsSliceActions = {
  // Re-list the provider's backup folders. Inert unless a provider is connected.
  refreshCloudProjects: () => Promise<void>;
  // Download a folder's newest backup and import it: identity-preserving when
  // no local project matches the folder's id prefix, forced copy when one does.
  // Resolves true once the import pipeline has accepted the package (which may
  // mean it parked in the artwork conflict dialog) so the caller can close the
  // project manager.
  openCloudProjectBackup: (folder: CloudProjectFolder) => Promise<boolean>;
};

export const CLOUD_PROJECTS_SLICE_INITIAL: CloudProjectsSliceState = {
  cloudProjects: null,
  cloudProjectsStatus: "idle",
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
      try {
        const folders = await active.listCloudProjects();
        set({ cloudProjects: folders, cloudProjectsStatus: "loaded" });
      } catch (error) {
        const kind = error instanceof CloudBackupError ? error.kind : "transient";
        set({
          cloudProjectsStatus: kind === "reauth" ? "reauth-required" : "error",
          cloudBackupProviderStatus: active.getStatus()
        });
      }
    },

    async openCloudProjectBackup(folder) {
      const active = provider();
      if (!active || active.getStatus() !== "connected") return false;
      if (get().cloudProjectOpening !== null) return false;

      const latest = folder.latestBackup;
      if (!latest) {
        toast.error(CLOUD_PROJECT_NO_BACKUP_MESSAGE);
        return false;
      }

      set({ cloudProjectOpening: folder.folderName });
      let bytes: Uint8Array;
      try {
        bytes = await active.downloadBackup(latest.path);
      } catch (error) {
        const kind = openErrorKind(error);
        set({
          cloudProjectOpening: null,
          cloudBackupProviderStatus: active.getStatus(),
          ...(kind === "reauth" ? { cloudProjectsStatus: "reauth-required" as const } : {})
        });
        toast.error(getCloudProjectOpenErrorMessage(kind));
        // The listing is what claimed this file existed, so a gone file makes
        // the whole listing suspect, not just this row.
        if (kind === "not-found") await actions.refreshCloudProjects();
        return false;
      }

      try {
        const prefix = folder.projectIdPrefix;
        const localIds = await localProjectIds();
        const matchesLocalProject =
          prefix.length === 0
            ? false
            : localIds === null || localIds.some((id) => id.startsWith(prefix));

        // Copy into a standalone ArrayBuffer: the provider may hand back a view
        // into a pooled buffer, and the import pipeline keeps the bytes.
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);

        const imported = await get().importCloudBackupPackage(buffer, {
          asCopy: matchesLocalProject
        });
        if (imported) telemetry.track("cloud_project_opened", {});
        return imported;
      } finally {
        set({ cloudProjectOpening: null });
      }
    }
  };

  return { actions };
}
