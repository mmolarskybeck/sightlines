import { create } from "zustand";
import { createNextRectangleRoom } from "../domain/geometry/createRoom";
import { resizeWallPreservingAngles } from "../domain/geometry/editRoom";
import { getWallsWithGeometry } from "../domain/geometry/walls";
import { createBlankProject } from "../domain/newProject";
import type { PlacementWarning } from "../domain/placement/validatePlacement";
import { validateChangedWallPlacements } from "../domain/placement/validatePlacement";
import type { DisplayUnit, Project, ProjectSummary, Wall } from "../domain/project";
import { IndexedDbProjectRepository } from "../domain/repositories/indexedDbProjectRepository";
import type { ProjectRepository } from "../domain/repositories/projectRepository";
import { createSampleProject } from "../domain/sample/sampleProject";
import { migrateProjectJson } from "../domain/schema/projectSchema";

type ViewMode = "plan" | "elevation" | "data";

type EditEntry = {
  label: string;
  before: Project;
  after: Project;
};

const UNDO_STACK_LIMIT = 100;

type GeometryEditInfo = {
  anchorVertexId: string;
  changedWallIds: string[];
};

type AppState = {
  project: Project | null;
  selectedWallId: string | null;
  viewMode: ViewMode;
  saveState: "idle" | "saving" | "saved" | "error";
  error: string | null;
  placementWarnings: PlacementWarning[];
  lastGeometryEdit: GeometryEditInfo | null;
  undoStack: EditEntry[];
  redoStack: EditEntry[];
  boot: () => Promise<void>;
  setViewMode: (viewMode: ViewMode) => void;
  selectWall: (wallId: string) => void;
  renameProject: (title: string) => Promise<void>;
  setUnit: (unit: DisplayUnit) => Promise<void>;
  addRectangleRoom: () => Promise<void>;
  resizeWall: (wallId: string, lengthMm: number) => Promise<void>;
  resizeSelectedWall: (lengthMm: number) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  importProjectJson: (text: string) => Promise<void>;
  listProjectSummaries: () => Promise<ProjectSummary[]>;
  openProject: (id: string) => Promise<void>;
  createProject: (title: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
};

export function createAppStore(repository: ProjectRepository) {
  return create<AppState>((set, get) => {
    async function persist(project: Project) {
      set({ saveState: "saving", error: null });

      try {
        await repository.save(project);
        set({ saveState: "saved" });
      } catch (error) {
        set({
          saveState: "error",
          error: error instanceof Error ? error.message : "Could not save project."
        });
      }
    }

    // Every document mutation flows through here: stamp updatedAt, push the
    // undo stack, drop the redo stack, persist. Actions stay thin constructors.
    async function applyEdit(
      label: string,
      buildNextProject: (project: Project) => Project,
      extras: Partial<
        Pick<AppState, "placementWarnings" | "lastGeometryEdit" | "selectedWallId" | "viewMode">
      > = {}
    ) {
      const before = get().project;
      if (!before) return;

      const after = {
        ...buildNextProject(before),
        updatedAt: new Date().toISOString()
      };

      set({
        project: after,
        undoStack: [...get().undoStack, { label, before, after }].slice(
          -UNDO_STACK_LIMIT
        ),
        redoStack: [],
        placementWarnings: [],
        lastGeometryEdit: null,
        ...extras
      });
      await persist(after);
    }

    // Replacing the whole document (boot, import, reset) starts a new edit
    // history — undoing across a document swap would resurrect the old one.
    function setDocument(project: Project, extras: Partial<AppState> = {}) {
      set({
        project,
        selectedWallId: getFirstWall(project)?.id ?? null,
        placementWarnings: [],
        lastGeometryEdit: null,
        undoStack: [],
        redoStack: [],
        error: null,
        ...extras
      });
    }

    return {
      project: null,
      selectedWallId: null,
      viewMode: "plan",
      saveState: "idle",
      error: null,
      placementWarnings: [],
      lastGeometryEdit: null,
      undoStack: [],
      redoStack: [],

      async boot() {
        try {
          const summaries = await repository.list();
          const project = summaries[0]
            ? await repository.load(summaries[0].id)
            : createSampleProject();

          if (!summaries[0]) {
            await repository.save(project);
          }

          setDocument(project, { saveState: "saved" });
        } catch (error) {
          // Keep the app usable with an in-memory sample, but say plainly that
          // the saved project could not load — never silently substitute.
          setDocument(createSampleProject(), {
            saveState: "error",
            error: `Could not load the saved project (${
              error instanceof Error ? error.message : "unknown error"
            }). Showing an unsaved sample instead — your data is still in browser storage.`
          });
        }
      },

      setViewMode(viewMode) {
        set({ viewMode });
      },

      selectWall(wallId) {
        set({ selectedWallId: wallId });
      },

      async renameProject(title) {
        const project = get().project;
        const trimmed = title.trim();
        if (!project || trimmed.length === 0 || trimmed === project.title) return;

        await applyEdit("Rename project", (current) => ({
          ...current,
          title: trimmed
        }));
      },

      async setUnit(unit) {
        const project = get().project;
        if (!project || project.unit === unit) return;

        await applyEdit("Change display unit", (current) => ({
          ...current,
          unit
        }));
      },

      async addRectangleRoom() {
        const project = get().project;
        if (!project) return;

        const roomPlacement = createNextRectangleRoom(
          project.floor,
          project.defaultWallHeightMm
        );

        await applyEdit(
          `Add ${roomPlacement.room.name}`,
          (current) => ({
            ...current,
            floor: { rooms: [...current.floor.rooms, roomPlacement] }
          }),
          {
            selectedWallId: roomPlacement.room.walls[0]?.id ?? null,
            viewMode: "plan"
          }
        );
      },

      async resizeWall(wallId, lengthMm) {
        const project = get().project;
        if (!project) return;

        const result = resizeWallPreservingAngles(project, wallId, lengthMm);
        if (result.changedWallIds.length === 0) return;

        const placementWarnings = validateChangedWallPlacements(
          result.project,
          result.changedWallIds
        );

        await applyEdit("Resize wall", () => result.project, {
          placementWarnings,
          lastGeometryEdit: {
            anchorVertexId: result.anchorVertexId,
            changedWallIds: result.changedWallIds
          }
        });
      },

      async resizeSelectedWall(lengthMm) {
        const selectedWallId = get().selectedWallId;
        if (!selectedWallId) return;

        await get().resizeWall(selectedWallId, lengthMm);
      },

      async undo() {
        const entry = get().undoStack.at(-1);
        if (!entry) return;

        set({
          project: entry.before,
          undoStack: get().undoStack.slice(0, -1),
          redoStack: [...get().redoStack, entry],
          placementWarnings: [],
          lastGeometryEdit: null
        });
        await persist(entry.before);
      },

      async redo() {
        const entry = get().redoStack.at(-1);
        if (!entry) return;

        set({
          project: entry.after,
          redoStack: get().redoStack.slice(0, -1),
          undoStack: [...get().undoStack, entry],
          placementWarnings: [],
          lastGeometryEdit: null
        });
        await persist(entry.after);
      },

      async importProjectJson(text) {
        let project: Project;

        // migrateProjectJson owns the whole parse → validate-shape →
        // migrate → validate pipeline (docs/plan.md §2) and throws a
        // specific, human-readable reason for every way an externally
        // authored file can be bad — oversized, not JSON, not a Sightlines
        // project, a newer schema version than this app knows, or a
        // Sightlines project whose data fails validation. The current
        // project is never touched until that pipeline has fully succeeded.
        try {
          project = migrateProjectJson(text);
        } catch (error) {
          set({
            error: `Import failed: ${
              error instanceof Error ? error.message : "the file could not be read."
            }`
          });
          return;
        }

        setDocument(project, { viewMode: "plan" });
        await persist(project);
      },

      async listProjectSummaries() {
        try {
          return await repository.list();
        } catch {
          return [];
        }
      },

      async openProject(id) {
        if (get().project?.id === id) return;

        set({ saveState: "saving", error: null });

        try {
          const project = await repository.load(id);
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
          await repository.save(project);
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

      async deleteProject(id) {
        const wasOpen = get().project?.id === id;

        try {
          await repository.delete(id);
        } catch (error) {
          set({
            saveState: "error",
            error: `Could not delete that project (${
              error instanceof Error ? error.message : "unknown error"
            }).`
          });
          return;
        }

        if (!wasOpen) return;

        // The open project just disappeared out from under the user —
        // fall back to another saved project, or start a fresh one so the
        // app never sits on a document that no longer exists.
        const summaries = await repository.list();

        if (summaries[0]) {
          await get().openProject(summaries[0].id);
        } else {
          await get().createProject("Untitled Exhibition");
        }
      }
    };
  });
}

export const useAppStore = createAppStore(new IndexedDbProjectRepository());

export function exportProjectJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function getProjectWalls(project: Project) {
  return project.floor.rooms.flatMap((placement) =>
    getWallsWithGeometry(placement.room)
  );
}

export function getSelectedWall(project: Project, selectedWallId: string | null) {
  const walls = getProjectWalls(project);
  return walls.find((wall) => wall.id === selectedWallId) ?? walls[0] ?? null;
}

function getFirstWall(project: Project): Wall | null {
  return project.floor.rooms[0]?.room.walls[0] ?? null;
}
