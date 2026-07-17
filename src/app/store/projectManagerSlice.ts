import { newId } from "../../domain/id";
import { createBlankProject } from "../../domain/newProject";
import type { Project, ProjectSummary } from "../../domain/project";
import type { AppState, AppStoreDeps, ArtworkProjectMembership } from "../store";

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
  setDocument: (project: Project, extras?: Partial<AppState>) => void;
  deps: AppStoreDeps;
};

export function createProjectManagerSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: ProjectManagerSliceInternals
): { actions: ProjectManagerSliceActions } {
  const { setDocument, deps } = internals;

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
        setDocument(project, { viewMode: "plan", saveState: "saved" });
      } catch (error) {
        set({
          saveState: "error",
          error: `Could not open that project (${
            error instanceof Error ? error.message : "unknown error"
          }).`
        });
      }
    },

    async createProject(title) {
      const project = createBlankProject(title);
      set({ saveState: "saving", error: null });

      try {
        await deps.projectRepository.save(project);
        setDocument(project, { viewMode: "plan", saveState: "saved" });
      } catch (error) {
        set({
          saveState: "error",
          error: `Could not create the new project (${
            error instanceof Error ? error.message : "unknown error"
          }).`
        });
      }
    },

    async duplicateProject(id) {
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
        setDocument(copy, { viewMode: "plan", saveState: "saved" });
      } catch (error) {
        set({
          saveState: "error",
          error: `Could not duplicate that project (${
            error instanceof Error ? error.message : "unknown error"
          }).`
        });
      }
    },

    async deleteProject(id) {
      const wasOpen = get().project?.id === id;

      try {
        await deps.projectRepository.delete(id);
      } catch (error) {
        set({
          saveState: "error",
          error: `Could not delete that project (${
            error instanceof Error ? error.message : "unknown error"
          }).`
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
