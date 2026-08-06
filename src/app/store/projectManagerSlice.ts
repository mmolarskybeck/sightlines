import { newId } from "../../domain/id";
import { createBlankProject } from "../../domain/newProject";
import type { Project, ProjectSummary } from "../../domain/project";
import { ProjectValidationError } from "../../domain/repositories/indexedDbProjectRepository";
import type { AppState, AppStoreDeps, ArtworkProjectMembership } from "../store";
import { telemetry } from "../telemetry/telemetry";

export type ProjectManagerSliceActions = {
  listProjectSummaries: () => Promise<ProjectSummary[]>;
  listArtworkProjectMemberships: (
    artworkIds: string[]
  ) => Promise<ArtworkProjectMembership[]>;
  openProject: (id: string) => Promise<void>;
  createProject: (title: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
};

export type ProjectManagerSliceInternals = {
  // Returns the document actually opened, which may differ from the one handed
  // in: setDocument runs the shared-opening load repair and writes nothing.
  setDocument: (project: Project, extras?: Partial<AppState>) => Project;
  persist: (project: Project) => Promise<boolean>;
  deps: AppStoreDeps;
  // Swap in a document that already exists in local storage: takes the
  // once-per-session recovery snapshot and, if the load repair changed the
  // document, writes the repaired copy back once that snapshot has landed. The
  // write-back is skipped (leaving the repair in memory on an "idle" badge) when
  // the snapshot failed or when the open document moved on during the wait.
  openLoadedDocument: (project: Project, extras?: Partial<AppState>) => Promise<Project>;
  // Populate recoveryOffer from the newest schema-valid snapshot, if any.
  offerRecovery: (projectId: string) => Promise<boolean>;
};

export function createProjectManagerSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: ProjectManagerSliceInternals
): { actions: ProjectManagerSliceActions } {
  const { setDocument, persist, deps, openLoadedDocument, offerRecovery } = internals;

  const actions: ProjectManagerSliceActions = {
    async listProjectSummaries() {
      try {
        return await deps.projectRepository.list();
      } catch {
        return [];
      }
    },

    async listArtworkProjectMemberships(artworkIds) {
      const uniqueArtworkIds = [...new Set(artworkIds)];
      if (uniqueArtworkIds.length === 0) return [];

      try {
        const summaries = await deps.projectRepository.list();
        const loadedProjects = await Promise.all(
          summaries.map(async (summary) => {
            try {
              return { summary, project: await deps.projectRepository.load(summary.id) };
            } catch {
              // A project may disappear between list and load. Skip that
              // stale summary without making the whole library query fail.
              return null;
            }
          })
        );

        return uniqueArtworkIds.map((artworkId) => ({
          artworkId,
          projects: loadedProjects.flatMap((entry) =>
            entry?.project.checklistArtworkIds.includes(artworkId) ? [entry.summary] : []
          )
        }));
      } catch {
        return uniqueArtworkIds.map((artworkId) => ({ artworkId, projects: [] }));
      }
    },

    async openProject(id) {
      if (get().project?.id === id) return;

      set({ saveState: "saving", error: null });

      try {
        const project = await deps.projectRepository.load(id);
        // saveState:"saved" describes the document as LOADED; if the load
        // repair changed it, openLoadedDocument writes the repaired copy back
        // (behind the recovery snapshot) so that stays true — or, when it can't
        // safely write, downgrades the badge to "idle" rather than lie.
        await openLoadedDocument(project, { viewMode: "plan", saveState: "saved" });
      } catch (error) {
        const message = `Could not open that project (${
          error instanceof Error ? error.message : "unknown error"
        }).`;
        set({
          saveState: "error",
          error: message,
          // Retry re-runs the same open.
          saveError: {
            scope: "projectLoad",
            message,
            retry: async () => {
              await actions.openProject(id);
            }
          }
        });
        // Only a typed corruption error can be answered by an earlier snapshot;
        // a transient read error must not substitute a copy for a fine document.
        if (error instanceof ProjectValidationError) {
          await offerRecovery(id);
        }
      }
    },

    async createProject(title) {
      const project = createBlankProject(title);
      // Named so a failed create can retry the save of this exact project.
      const save = async () => {
        set({ saveState: "saving", error: null });
        try {
          await deps.projectRepository.save(project);
          setDocument(project, { viewMode: "plan", saveState: "saved" });
          telemetry.track("project_created", {});
        } catch (error) {
          const message = `Could not create the new project (${
            error instanceof Error ? error.message : "unknown error"
          }).`;
          set({
            saveState: "error",
            error: message,
            saveError: { scope: "projectCreate", message, retry: save }
          });
        }
      };
      await save();
    },

    async duplicateProject(id) {
      // Named so a failed duplicate can retry the whole load-copy-save.
      const run = async () => {
        set({ saveState: "saving", error: null });
        try {
          const source = await deps.projectRepository.load(id);
          const now = new Date().toISOString();
          const copy: Project = {
            ...source,
            id: newId(),
            title: `${source.title} (copy)`,
            createdAt: now,
            updatedAt: now
          };
          await deps.projectRepository.save(copy);
          const opened = setDocument(copy, { viewMode: "plan", saveState: "saved" });
          // The record just written is the PRE-repair copy; if the load repair
          // changed it, write the repaired one over it rather than leaving the
          // copy stale behind a "Saved" badge. No recovery snapshot here (unlike
          // the open paths): this id was minted a few lines up, so the write
          // overwrites nothing the user could lose.
          if (opened !== copy) await persist(opened);
        } catch (error) {
          const message = `Could not duplicate that project (${
            error instanceof Error ? error.message : "unknown error"
          }).`;
          set({
            saveState: "error",
            error: message,
            saveError: { scope: "projectDuplicate", message, retry: run }
          });
        }
      };
      await run();
    },

    async deleteProject(id) {
      const wasOpen = get().project?.id === id;

      try {
        await deps.projectRepository.delete(id);
      } catch (error) {
        const message = `Could not delete that project (${
          error instanceof Error ? error.message : "unknown error"
        }).`;
        set({
          saveState: "error",
          error: message,
          // Retry re-runs the same delete.
          saveError: {
            scope: "projectDelete",
            message,
            retry: async () => {
              await actions.deleteProject(id);
            }
          }
        });
        return;
      }

      // Workspace-only records are outside project persistence and packages,
      // but still need to follow project lifecycle (§6.3). Best effort: a
      // localStorage failure must not resurrect a project that was already
      // deleted successfully from IndexedDB.
      try {
        await deps.onProjectDeleted?.(id);
      } catch {
        // The export-preference hook reports ordinary persistence failures.
      }

      // Recovery snapshots follow the project's lifecycle too — drop them so a
      // deleted project leaves no restorable copies behind. Best-effort.
      try {
        await deps.projectSnapshotRepository.deleteByProject(id);
      } catch {
        // A snapshot-store failure must not resurrect an already-deleted project.
      }

      if (!wasOpen) return;

      // The open project just disappeared out from under the user —
      // fall back to another saved project, or start a fresh one so the
      // app never sits on a document that no longer exists.
      const summaries = await deps.projectRepository.list();

      if (summaries[0]) {
        await get().openProject(summaries[0].id);
      } else {
        await get().createProject("Untitled Exhibition");
      }
    }
  };

  return { actions };
}
