// Cross-device sync store slice (docs/cloud-sync-plan.md stage 2): the loop that
// keeps ONE canonical copy of a project in Dropbox — `/projects/<id>/current.sightlines` —
// in step with this device. The scheduler (useProjectSyncScheduler) decides WHEN
// to evaluate; this slice decides what the evaluation means and carries it out.
//
// Three rules the whole file is built around:
//   - The Dropbox `rev` is the only lineage. Timestamps are display-only —
//     clocks disagree and upload order is not ancestry. The fingerprint is a
//     dirty-check heuristic; pairing it with a rev is what distinguishes "this
//     device changed" from "the remote changed".
//   - Nothing is ever overwritten without a rev-conditional write, and a lost
//     race surfaces as a conflict for the curator to decide. Sightlines does not
//     merge layouts.
//   - A missing head is never silently recreated: the file the user's other
//     devices rely on disappearing is a condition to surface, not to paper over.
//
// The feature is inert with no provider, a disconnected provider, an unknown
// account id, or a project with no sync metadata.

import { newId } from "../../domain/id";
import { buildProjectPackage } from "../../domain/package/packageService";
import type { Project } from "../../domain/project";
import {
  SYNC_PROTOCOL_VERSION,
  type ProjectSyncMeta
} from "../../domain/repositories/syncMetaRepository";
import { assessSync } from "../../domain/sync/syncAssessment";
import { CloudBackupError } from "../cloud/dropbox";
import { syncHeadPath } from "../cloud/dropboxAuth";
import type { CloudBackupProvider } from "../cloud/provider";
import { telemetry } from "../telemetry/telemetry";
import type { AppState, AppStoreDeps } from "../store";
import { selectBackupFingerprint } from "./cloudBackupSlice";

export type ProjectSyncStatus =
  // Not linked (or not usable: no provider, wrong account, no meta).
  | "idle"
  | "checking"
  | "synced"
  // Local changes are waiting for the settle/interval gates.
  | "pending"
  | "pushing"
  | "pulling"
  // Both sides moved; the dialog owns the decision.
  | "conflict"
  // Quiet, persisted "the user has to look at this": a paused conflict, or a
  // head that vanished from Dropbox.
  | "needs-review"
  | "error";

// What a single sync operation is bound to: the project it was decided for,
// and that project's fingerprint at the moment the decision was taken. Every
// step after the decision — a download, a replace, a conflict dialog resolved
// minutes later — carries this binding instead of re-reading the store, because
// re-reading is exactly how the two failure modes happen:
//   - Re-deriving the fingerprint later LAUNDERS an edit that landed in
//     between into the "expected" value, so the commit's drift check waves
//     through a replace that silently discards it.
//   - The open project can change mid-flight. An operation decided for one
//     project must never download, replace, or write the head of another.
// A binding that no longer matches the open project is not an error: the
// curator simply moved on, and the next poll point evaluates what is open now.
export type SyncOperationBinding = {
  projectId: string;
  localFingerprint: string;
};

// The parked whole-project decision. `remoteMissing` is its own shape of
// trouble — there is no rev to write against, so "keep this device's version"
// means re-creating the head rather than superseding one.
export type SyncConflictRecord = {
  remoteRev: string | null;
  remoteModifiedIso: string | null;
  remoteMissing: boolean;
  // The project + fingerprint this conflict was parked against. The dialog can
  // sit open for minutes, so the resolution has to prove it is still acting on
  // the project (and the version of it) the user was shown.
  binding: SyncOperationBinding;
};

export type SyncConflictChoice =
  | "use-dropbox"
  | "keep-mine"
  | "keep-both"
  | "not-now";

export type CloudSyncSliceState = {
  // Sync metadata for the OPEN project, or null when it is not linked on this
  // device (which includes "linked to a different Dropbox account").
  syncMeta: ProjectSyncMeta | null;
  syncStatus: ProjectSyncStatus;
  syncError: string | null;
  syncConflict: SyncConflictRecord | null;
};

export type CloudSyncSliceActions = {
  // Fold the open project's stored sync metadata into observable state. Called
  // on project change and after every commit that touches the metadata.
  refreshProjectSyncState: () => Promise<void>;
  // Link the open project: create its head from this device's copy.
  enableProjectSync: () => Promise<void>;
  // Unlink this device. The remote head is deliberately untouched.
  disableProjectSync: () => Promise<void>;
  // Evaluate the state machine and act on the answer. `manual` is the explicit
  // "review now" gesture, which also clears a paused project.
  checkProjectSync: (options?: { manual?: boolean }) => Promise<void>;
  // Upload this device's copy against the accepted base rev.
  pushProjectSync: () => Promise<void>;
  // Apply the curator's whole-project decision to a parked conflict.
  resolveSyncConflict: (choice: SyncConflictChoice) => Promise<void>;
};

export const CLOUD_SYNC_SLICE_INITIAL: CloudSyncSliceState = {
  syncMeta: null,
  syncStatus: "idle",
  syncError: null,
  syncConflict: null
};

const RECONNECT_MESSAGE =
  "Reconnect Dropbox to sync this project across devices.";
// Shared with the import commit (packageSlice), which can land its own
// bookkeeping failure after a pull has already replaced this device's copy.
export const BOOKKEEPING_MESSAGE =
  "This device could not record where the synced copy stands. Try syncing again.";

// What a head write did, from the caller's point of view. "quiet" is expected
// backpressure (rate limiting): not a failure to show anyone, just a reason to
// stay pending and retry next cycle. "abandoned" is the bound project no longer
// being the open one — nothing happened and nothing needs saying.
type HeadWriteOutcome = "ok" | "conflict" | "quiet" | "failed" | "abandoned";

export type CloudSyncSliceInternals = {
  deps: AppStoreDeps;
};

export function createCloudSyncSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: CloudSyncSliceInternals
): { actions: CloudSyncSliceActions } {
  const { deps } = internals;

  function provider(): CloudBackupProvider | null {
    return deps.cloudBackupProvider ?? null;
  }

  function errorKind(error: unknown): string {
    return error instanceof CloudBackupError ? error.kind : "transient";
  }

  function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  // Mirror the provider's link status into observable state, exactly as
  // cloudBackupSlice does in its own failure paths. A 401 mid-operation flips
  // the provider's sticky reauth flag, and until that lands in state the UI
  // keeps presenting a "connected" surface whose retry silently no-ops on the
  // getStatus() guard — the sync row must yield to the Dropbox row's
  // "Reconnect" affordance instead.
  function mirrorProviderStatus(): Partial<AppState> {
    const active = provider();
    if (!active) return {};
    return {
      cloudBackupProviderStatus: active.getStatus(),
      cloudBackupAccountLabel: active.accountLabel()
    };
  }

  // The metadata this device may act on for `project`, or null when sync is
  // inert for it. A record bound to a DIFFERENT account id is not usable — a
  // relink to another Dropbox account must not inherit this account's revision
  // lineage — but it is also not deleted: reconnecting the original account
  // restores the link instead of starting over.
  async function loadUsableMeta(project: Project): Promise<ProjectSyncMeta | null> {
    const active = provider();
    if (!active) return null;
    const accountId = active.accountId();
    if (!accountId) return null;
    let meta: ProjectSyncMeta | undefined;
    try {
      meta = await deps.syncMetaRepository.get(project.id);
    } catch {
      // An unreadable record reads as unlinked. Guessing at lineage is the one
      // failure mode that could overwrite a good remote copy.
      return null;
    }
    if (!meta || meta.accountId !== accountId) return null;
    return meta;
  }

  async function saveMeta(next: ProjectSyncMeta): Promise<boolean> {
    try {
      await deps.syncMetaRepository.put(next);
      // The write is real either way, but observable state always describes
      // the OPEN project — a slow save finishing after a project switch must
      // not stamp another project's link onto whoever is on screen now.
      if (get().project?.id === next.projectId) set({ syncMeta: next });
      return true;
    } catch {
      // The head write already landed, so the remote is ahead of what this
      // device can prove it descends from. The next check therefore reads as a
      // conflict rather than as license to overwrite — the safe direction.
      // Same paint guard as above: the failure belongs to `next`'s project,
      // and its next open re-derives it honestly.
      if (get().project?.id === next.projectId) {
        set({ syncStatus: "error", syncError: BOOKKEEPING_MESSAGE });
      }
      return false;
    }
  }

  // True while a network round trip owns the status. checkProjectSync's own
  // "checking" is deliberately NOT in here: check delegates to push/pull.
  function writing(): boolean {
    const status = get().syncStatus;
    return status === "pushing" || status === "pulling";
  }

  // Bind an operation to the project on screen RIGHT NOW. Callers must call
  // this at the point the decision's inputs are read — not before an await —
  // so the fingerprint describes the same state the decision was made against.
  function bindToOpenProject(): SyncOperationBinding | null {
    const project = get().project;
    if (!project) return null;
    return {
      projectId: project.id,
      localFingerprint: selectBackupFingerprint(project, get().libraryArtworks)
    };
  }

  function stillOpen(binding: SyncOperationBinding): boolean {
    return get().project?.id === binding.projectId;
  }

  // The bound project is no longer open. Quietly re-derive the status of
  // whatever IS open rather than leaving a half-finished operation's status (or
  // an error about a project the user has moved on from) on screen.
  async function abandon(): Promise<void> {
    await actions.refreshProjectSyncState();
  }

  function statusForFingerprint(meta: ProjectSyncMeta, project: Project): ProjectSyncStatus {
    if (meta.paused) return "needs-review";
    const fingerprint = selectBackupFingerprint(project, get().libraryArtworks);
    return fingerprint === meta.fingerprintAtRev ? "synced" : "pending";
  }

  // Ask the provider where the head stands and park what it says. Used after a
  // rev-conditional write loses its race ("the remote moved on" — but to what?)
  // and when linking finds a head already there.
  //
  // The parked record gets a FRESH binding: this is a new decision point, and
  // whatever the user chooses next is a choice about the project as it stands
  // now, not as it stood when the losing write began.
  async function parkRemoteState(projectId: string): Promise<void> {
    const active = provider();
    if (!active) return;
    if (get().project?.id !== projectId) {
      await abandon();
      return;
    }
    let head;
    try {
      head = await active.getSyncHead(projectId);
    } catch (error) {
      if (get().project?.id !== projectId) {
        await abandon();
        return;
      }
      set({
        ...mirrorProviderStatus(),
        syncStatus: "error",
        syncError: errorMessage(error, "Dropbox could not be reached.")
      });
      return;
    }
    const binding = bindToOpenProject();
    if (!binding || binding.projectId !== projectId) {
      await abandon();
      return;
    }
    if (!head) {
      set({
        syncConflict: {
          remoteRev: null,
          remoteModifiedIso: null,
          remoteMissing: true,
          binding
        },
        syncStatus: "needs-review"
      });
      return;
    }
    set({
      syncConflict: {
        remoteRev: head.rev,
        remoteModifiedIso: head.serverModifiedIso,
        remoteMissing: false,
        binding
      },
      syncStatus: "conflict"
    });
  }

  // The one place a head is written. `baseRev` null creates it; a non-null base
  // asserts the head is still at that revision, and the provider fails the write
  // (kind "conflict") rather than overwriting if it is not.
  //
  // `binding` is checked, not used to build: the content and the fingerprint
  // recorded for it both come from the project as it is at BUILD time (the
  // captured-fingerprint discipline below), which is what keeps meta honest
  // about what the head actually holds. The binding's job here is only to prove
  // the project the caller decided about is still the one on screen — writing a
  // different project's document into this head would be a corruption.
  async function writeHead(
    binding: SyncOperationBinding,
    baseRev: string | null
  ): Promise<HeadWriteOutcome> {
    const active = provider();
    const project = get().project;
    if (!active || !project) return "failed";
    if (project.id !== binding.projectId) {
      await abandon();
      return "abandoned";
    }
    const accountId = active.accountId();
    if (!accountId) {
      set({ syncStatus: "error", syncError: RECONNECT_MESSAGE });
      return "failed";
    }

    // Captured at BUILD start, exactly like runCloudBackup — but recorded
    // unconditionally, because unlike a backup the head now HOLDS this captured
    // content. Pairing the returned rev with the captured fingerprint is what
    // leaves a project edited mid-upload correctly reading as "push" again.
    const capturedFingerprint = selectBackupFingerprint(project, get().libraryArtworks);
    const previous = get().syncMeta;
    set({ syncStatus: "pushing", syncError: null });
    try {
      const { blob } = await buildProjectPackage({
        project,
        libraryArtworks: get().libraryArtworks,
        // Display tier, the same package auto-backup and shares build: v1 sync's
        // stated fidelity promise (originals stay on the device that has them).
        mode: "display",
        getAsset: (assetId) => deps.assetRepository.getAsset(assetId),
        getBlob: (key) => deps.assetRepository.getBlob(key)
      });
      const head = await active.uploadSyncHead({
        projectId: project.id,
        blob,
        baseRev
      });

      const next: ProjectSyncMeta = {
        projectId: project.id,
        provider: "dropbox",
        accountId,
        remotePath: syncHeadPath(project.id),
        lastAcceptedRev: head.rev,
        fingerprintAtRev: capturedFingerprint,
        lastPullAtIso:
          previous && previous.projectId === project.id ? previous.lastPullAtIso : null,
        lastPushAtIso: new Date().toISOString(),
        protocolVersion: SYNC_PROTOCOL_VERSION,
        // A successful push is the answer to whatever "Not now" postponed.
        paused: false
      };
      if (!(await saveMeta(next))) return "failed";

      const current = get().project;
      if (current === null || current.id !== project.id) {
        // The push really happened and its lineage is recorded above — but the
        // project it belongs to is no longer on screen, so its outcome must
        // not be stamped onto whoever is. Repaint what IS open instead.
        await actions.refreshProjectSyncState();
        return "ok";
      }
      const stillSame =
        selectBackupFingerprint(current, get().libraryArtworks) === capturedFingerprint;
      set({
        syncStatus: stillSame ? "synced" : "pending",
        syncError: null,
        syncConflict: null
      });
      return "ok";
    } catch (error) {
      const kind = errorKind(error);
      if (kind === "conflict") return "conflict";
      if (kind === "rate-limit") {
        // Expected backpressure, not a failure to surface: stay pending.
        set({ syncStatus: "pending" });
        return "quiet";
      }
      set({
        ...mirrorProviderStatus(),
        syncStatus: "error",
        syncError: errorMessage(error, "This project could not be synced to Dropbox.")
      });
      return "failed";
    }
  }

  // Download the head and replace the open project with it. The replace
  // prerequisites (recovery snapshot, drift re-check) live in the import
  // commit — this only supplies the provenance that authorizes them.
  //
  // Everything here works from `binding`, never from fresh state: the project
  // id decides WHICH head is downloaded and replaced, and the fingerprint is
  // the version of this device's copy the replace decision was made against.
  async function pullHead(binding: SyncOperationBinding): Promise<void> {
    const active = provider();
    if (!active) return;
    if (!stillOpen(binding)) {
      await abandon();
      return;
    }

    set({ syncStatus: "pulling", syncError: null, syncConflict: null });
    let downloaded: { bytes: Uint8Array; rev: string };
    try {
      downloaded = await active.downloadSyncHead(binding.projectId);
    } catch (error) {
      if (!stillOpen(binding)) {
        await abandon();
        return;
      }
      const kind = errorKind(error);
      if (kind === "not-found") {
        // The head vanished between the check and the download. Never recreate
        // it behind the user's back.
        set({
          syncConflict: {
            remoteRev: null,
            remoteModifiedIso: null,
            remoteMissing: true,
            binding
          },
          syncStatus: "needs-review"
        });
        return;
      }
      if (kind === "rate-limit") {
        set({ syncStatus: "pending" });
        return;
      }
      set({
        ...mirrorProviderStatus(),
        syncStatus: "error",
        syncError: errorMessage(error, "The Dropbox version could not be downloaded.")
      });
      return;
    }

    if (!stillOpen(binding)) {
      await abandon();
      return;
    }

    // Copy into a standalone ArrayBuffer: the provider may hand back a view into
    // a pooled buffer, and the import pipeline keeps the bytes.
    const buffer = new ArrayBuffer(downloaded.bytes.byteLength);
    new Uint8Array(buffer).set(downloaded.bytes);

    const accepted = await get().importSyncHeadPackage(buffer, {
      replace: {
        targetProjectId: binding.projectId,
        rev: downloaded.rev,
        // Deliberately NOT recomputed here. This is the fingerprint the replace
        // decision was made against; the commit compares it to fresh state, so
        // an edit that landed anywhere between the decision and the commit —
        // during the head read, during the download, or while an artwork review
        // sat open — aborts the replace instead of being discarded. Recomputing
        // would launder that edit into the expected value and the drift check
        // would pass.
        expectedLocalFingerprint: binding.localFingerprint
      }
    });
    if (!accepted) {
      if (!stillOpen(binding)) {
        await abandon();
        return;
      }
      // The pipeline refused the package or a prerequisite failed. The sentence
      // claims something specific, so the commit is ordered to make it true:
      // for a replace, the target project's record is written LAST and nothing
      // after that write can unwind it (packageSlice's commitPackageImport), so
      // a false here always means the project is exactly as it was. It says
      // "this project" rather than "nothing on this device" because a failure
      // part-way through can still have added incoming artwork records to the
      // shared library — the deliberate, harmless side of the replace ordering,
      // but not something to deny.
      set({
        syncStatus: "error",
        syncError:
          "The Dropbox version could not be opened here, so this project was not replaced."
      });
      return;
    }
    // A pull that parked in the artwork review is still in flight: the commit
    // (and the sync-state refresh that follows it) happens when the user
    // resolves it, which may be minutes from now.
  }

  const actions: CloudSyncSliceActions = {
    async refreshProjectSyncState() {
      const project = get().project;
      if (!project) {
        set({ ...CLOUD_SYNC_SLICE_INITIAL });
        return;
      }
      const meta = await loadUsableMeta(project);
      // The open project can change while the metadata read is in flight, and
      // the switch triggers its own refresh — the NEWER refresh owns the
      // state. Applying this one anyway would paint one project's link status
      // (or clear a link) onto another.
      if (get().project?.id !== project.id) return;
      if (!meta) {
        set({ ...CLOUD_SYNC_SLICE_INITIAL });
        return;
      }
      set({
        syncMeta: meta,
        syncConflict: null,
        syncError: null,
        syncStatus: statusForFingerprint(meta, project)
      });
    },

    async enableProjectSync() {
      const active = provider();
      const project = get().project;
      if (!active || !project) return;
      if (active.getStatus() !== "connected") return;
      if (!active.accountId()) {
        set({ syncStatus: "error", syncError: RECONNECT_MESSAGE });
        return;
      }
      if (writing()) return;

      const binding = bindToOpenProject();
      if (!binding) return;
      // baseRev null: this device is CREATING the head, and the write must fail
      // if one already exists rather than replace another device's canonical
      // copy with ours.
      const outcome = await writeHead(binding, null);
      if (outcome === "ok") {
        telemetry.track("cloud_sync_enabled", {});
        return;
      }
      if (outcome !== "conflict") return;
      // A head is already there — another device linked this project first.
      // There is no common base, but the same whole-project choices apply, and
      // "keep mine" writes against the rev we are about to read.
      await parkRemoteState(binding.projectId);
    },

    async disableProjectSync() {
      const project = get().project;
      if (!project) return;
      const projectId = project.id;
      try {
        await deps.syncMetaRepository.delete(projectId);
      } catch {
        // The failure belongs to the project whose metadata we tried to delete,
        // not to whichever project may have opened while storage was pending.
        if (get().project?.id !== projectId) {
          await actions.refreshProjectSyncState();
          return;
        }
        set({ syncStatus: "error", syncError: BOOKKEEPING_MESSAGE });
        return;
      }
      // The remote head stays exactly where it is: other devices are still
      // syncing against it, and unlinking here must never destroy it.
      if (get().project?.id !== projectId) {
        // The unlink really happened for the captured project. Repaint the one
        // now on screen instead of clearing its valid metadata and status.
        await actions.refreshProjectSyncState();
        return;
      }
      set({ ...CLOUD_SYNC_SLICE_INITIAL });
    },

    async checkProjectSync(options = {}) {
      const active = provider();
      const project = get().project;
      if (!active || !project) return;
      if (active.getStatus() !== "connected") return;
      // Single-flight: an evaluation already owns the project.
      if (get().syncStatus === "checking" || writing()) return;

      let meta = await loadUsableMeta(project);
      // A project switch during the metadata read means this evaluation is
      // about a project that is no longer on screen — clearing or painting
      // state now would hit the wrong one. The switch's own refresh (and the
      // next poll point) cover whatever is open.
      if (get().project?.id !== project.id) {
        await abandon();
        return;
      }
      if (!meta) {
        set({ ...CLOUD_SYNC_SLICE_INITIAL });
        return;
      }
      if (meta.paused) {
        // "Not now" persists across reloads: only the explicit review gesture
        // clears it, so a background cycle can never re-prompt.
        if (!options.manual) {
          set({ syncMeta: meta, syncStatus: "needs-review" });
          return;
        }
        const resumed: ProjectSyncMeta = { ...meta, paused: false };
        if (!(await saveMeta(resumed))) return;
        meta = resumed;
      }

      set({ syncMeta: meta, syncStatus: "checking", syncError: null });
      let remoteRev: string | null;
      let head;
      try {
        head = await active.getSyncHead(project.id);
        remoteRev = head?.rev ?? null;
      } catch (error) {
        // Same stale-window rule as above: a head-read failure for a project
        // that is no longer open belongs to nobody on screen.
        if (get().project?.id !== project.id) {
          await abandon();
          return;
        }
        const kind = errorKind(error);
        if (kind === "rate-limit") {
          set({ syncStatus: statusForFingerprint(meta, project) });
          return;
        }
        set({
          ...mirrorProviderStatus(),
          syncStatus: "error",
          syncError: errorMessage(error, "Dropbox could not be reached.")
        });
        return;
      }

      // Bind the operation HERE, after the network work and immediately before
      // the matrix reads its inputs. The awaits above (metadata load + head
      // read) are long enough for an edit — or a whole project switch — to
      // land, and both have to be visible to the assessment rather than folded
      // in silently afterwards: an edit during the head read must make this a
      // conflict, not a pull whose "expected" fingerprint quietly includes it.
      const binding = bindToOpenProject();
      if (!binding || binding.projectId !== project.id) {
        // A different project is open now. This evaluation was about the old
        // one; the poll points will evaluate the new one on their own.
        await abandon();
        return;
      }

      const assessment = assessSync({
        localFingerprint: binding.localFingerprint,
        baseFingerprint: meta.fingerprintAtRev,
        baseRev: meta.lastAcceptedRev,
        remoteRev
      });

      switch (assessment) {
        case "synced":
          set({ syncStatus: "synced" });
          return;
        case "push":
          // The pre-upload evaluation IS this check; its push arm uploads.
          await writeHeadForPush(meta, binding);
          return;
        case "pull":
          await pullHead(binding);
          return;
        case "conflict":
          set({
            syncConflict: {
              remoteRev,
              remoteModifiedIso: head?.serverModifiedIso ?? null,
              remoteMissing: false,
              binding
            },
            syncStatus: "conflict"
          });
          return;
        case "remote-missing":
          // Surfaced, never repaired silently: the canonical copy other devices
          // rely on is gone, and only the user can say what that means.
          set({
            syncConflict: {
              remoteRev: null,
              remoteModifiedIso: null,
              remoteMissing: true,
              binding
            },
            syncStatus: "needs-review"
          });
          return;
      }
    },

    async pushProjectSync() {
      const active = provider();
      const project = get().project;
      if (!active || !project) return;
      if (active.getStatus() !== "connected") return;
      if (writing()) return;
      const meta = await loadUsableMeta(project);
      if (!meta || meta.paused) return;
      // Bound after the metadata load, for the same reason the check binds after
      // its head read: the project on screen may have changed during it.
      const binding = bindToOpenProject();
      if (!binding || binding.projectId !== project.id) {
        await abandon();
        return;
      }
      await writeHeadForPush(meta, binding);
    },

    async resolveSyncConflict(choice) {
      const conflict = get().syncConflict;
      const project = get().project;
      if (!conflict || !project) return;
      // The dialog can sit open across a project switch. Every choice below acts
      // on a specific project — replacing it, forking it, writing its head — so
      // a resolution that no longer matches the parked binding does nothing at
      // all rather than applying the decision to whatever is open now.
      if (conflict.binding.projectId !== project.id) {
        await abandon();
        return;
      }
      telemetry.track("cloud_sync_conflict_resolved", { choice });

      switch (choice) {
        case "not-now": {
          const meta = get().syncMeta;
          if (!meta || meta.projectId !== project.id) {
            // Postponing the head-already-exists conflict from linking: there is
            // no link yet, so there is nothing to pause. Leave it unlinked.
            set({ ...CLOUD_SYNC_SLICE_INITIAL });
            return;
          }
          const paused: ProjectSyncMeta = { ...meta, paused: true };
          if (!(await saveMeta(paused))) return;
          set({ syncConflict: null, syncStatus: "needs-review", syncError: null });
          return;
        }

        case "keep-mine": {
          set({ syncConflict: null });
          // Still a guarded write: if the remote advanced again while the dialog
          // sat open, the conditional write simply fails and we re-park. No
          // extra recheck machinery (docs/cloud-sync-plan.md, "Conflict UX").
          const outcome = await writeHead(
            conflict.binding,
            conflict.remoteMissing ? null : conflict.remoteRev
          );
          if (outcome === "conflict") await parkRemoteState(conflict.binding.projectId);
          return;
        }

        case "keep-both": {
          // The divergent LOCAL copy becomes a separate, UNLINKED project: a new
          // id, its own name, saved through the repository and deliberately NOT
          // opened (the Dropbox version is what lands in the linked identity).
          // It keeps referencing the shared library artworks, so the fork needs
          // no artwork work of its own.
          const copy: Project = {
            ...project,
            id: newId(),
            title: `${project.title} (this device)`,
            updatedAt: new Date().toISOString()
          };
          try {
            await deps.projectRepository.save(copy);
          } catch (error) {
            // The conflict stays parked: pulling now would destroy the very copy
            // the user asked to keep.
            set({
              syncStatus: "conflict",
              syncError: errorMessage(
                error,
                "This device's version could not be saved as a separate project, so nothing was replaced."
              )
            });
            return;
          }
          set({ syncConflict: null });
          // Re-baseline the pull AFTER the fork is saved, deliberately: the
          // conflict-time fingerprint would abort the replace if the curator
          // kept editing while the dialog was open, but here nothing is at risk
          // — everything this device holds, those edits included, has just been
          // written to the fork. The fork IS the recovery, so aborting would
          // only strand the user back in the conflict having lost nothing but
          // the resolution they asked for.
          const rebound = bindToOpenProject();
          if (!rebound || rebound.projectId !== conflict.binding.projectId) {
            await abandon();
            return;
          }
          await pullHead(rebound);
          return;
        }

        case "use-dropbox": {
          set({ syncConflict: null });
          // The conflict-time binding, NOT a fresh one: an edit made while the
          // dialog sat open must abort the replace (the commit's drift check
          // catches it) rather than be thrown away by a decision the user took
          // against an older version of the project. The next check re-parks the
          // conflict honestly, and the plan doc's rule holds — an edit is never
          // discarded silently.
          await pullHead(conflict.binding);
          return;
        }
      }
    }
  };

  // Push against the accepted base. A lost race means the remote moved on while
  // we were building: re-run the check so the matrix answers with a pull or a
  // conflict, rather than this path guessing which one it was.
  async function writeHeadForPush(
    meta: ProjectSyncMeta,
    binding: SyncOperationBinding
  ): Promise<void> {
    const outcome = await writeHead(binding, meta.lastAcceptedRev);
    if (outcome !== "conflict") return;
    set({ syncStatus: "pending" });
    await actions.checkProjectSync();
  }

  return { actions };
}
