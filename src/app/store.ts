import { create } from "zustand";
import { createNextRectangleRoom } from "../domain/geometry/createRoom";
import { resizeWallPreservingAngles } from "../domain/geometry/editRoom";
import { getWallsWithGeometry } from "../domain/geometry/walls";
import type { PlacementWarning } from "../domain/placement/validatePlacement";
import { validateChangedWallPlacements } from "../domain/placement/validatePlacement";
import type { Project, Wall } from "../domain/project";
import { IndexedDbProjectRepository } from "../domain/repositories/indexedDbProjectRepository";
import { createSampleProject } from "../domain/sample/sampleProject";
import { migrateProject } from "../domain/schema/projectSchema";

type ViewMode = "plan" | "elevation" | "data";

type AppState = {
  project: Project | null;
  selectedWallId: string | null;
  viewMode: ViewMode;
  saveState: "idle" | "saving" | "saved" | "error";
  error: string | null;
  placementWarnings: PlacementWarning[];
  lastGeometryEdit: {
    anchorVertexId: string;
    changedWallIds: string[];
  } | null;
  boot: () => Promise<void>;
  setViewMode: (viewMode: ViewMode) => void;
  selectWall: (wallId: string) => void;
  renameProject: (title: string) => Promise<void>;
  addRectangleRoom: () => Promise<void>;
  resizeSelectedWall: (lengthMm: number) => Promise<void>;
  importProjectJson: (text: string) => Promise<void>;
  resetLocalProject: () => Promise<void>;
};

const repository = new IndexedDbProjectRepository();

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  selectedWallId: null,
  viewMode: "plan",
  saveState: "idle",
  error: null,
  placementWarnings: [],
  lastGeometryEdit: null,

  async boot() {
    try {
      const summaries = await repository.list();
      const project =
        summaries[0] ? await repository.load(summaries[0].id) : createSampleProject();

      if (!summaries[0]) {
        await repository.save(project);
      }

      const selectedWallId = getFirstWall(project)?.id ?? null;
      set({
        project,
        selectedWallId,
        saveState: "saved",
        error: null,
        placementWarnings: [],
        lastGeometryEdit: null
      });
    } catch (error) {
      set({
        project: createSampleProject(),
        selectedWallId: "wall-north",
        saveState: "error",
        error: error instanceof Error ? error.message : "Could not load project.",
        placementWarnings: [],
        lastGeometryEdit: null
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
    if (!project) return;

    const nextProject = { ...project, title, updatedAt: new Date().toISOString() };
    await saveProject(nextProject, set);
  },

  async addRectangleRoom() {
    const project = get().project;
    if (!project) return;

    const roomPlacement = createNextRectangleRoom(
      project.floor,
      project.defaultWallHeightMm
    );
    const nextProject = {
      ...project,
      floor: {
        rooms: [...project.floor.rooms, roomPlacement]
      },
      updatedAt: new Date().toISOString()
    };

    await saveProject(nextProject, set, {
      placementWarnings: [],
      lastGeometryEdit: null
    });
    set({
      selectedWallId: roomPlacement.room.walls[0]?.id ?? null,
      viewMode: "plan"
    });
  },

  async resizeSelectedWall(lengthMm) {
    const project = get().project;
    const selectedWallId = get().selectedWallId;
    if (!project || !selectedWallId) return;

    const result = resizeWallPreservingAngles(project, selectedWallId, lengthMm);
    const nextProject = {
      ...result.project,
      updatedAt: new Date().toISOString()
    };
    const placementWarnings = validateChangedWallPlacements(
      nextProject,
      result.changedWallIds
    );

    await saveProject(nextProject, set, {
      placementWarnings,
      lastGeometryEdit: {
        anchorVertexId: result.anchorVertexId,
        changedWallIds: result.changedWallIds
      }
    });
  },

  async importProjectJson(text) {
    const project = migrateProject(JSON.parse(text));
    await saveProject(project, set, {
      placementWarnings: [],
      lastGeometryEdit: null
    });
    set({ selectedWallId: getFirstWall(project)?.id ?? null });
  },

  async resetLocalProject() {
    const project = createSampleProject();
    set({
      saveState: "saving",
      error: null,
      placementWarnings: [],
      lastGeometryEdit: null
    });

    try {
      const summaries = await repository.list();
      for (const summary of summaries) {
        await repository.delete(summary.id);
      }
      await repository.save(project);
      set({
        project,
        selectedWallId: getFirstWall(project)?.id ?? null,
        viewMode: "plan",
        saveState: "saved",
        error: null,
        placementWarnings: [],
        lastGeometryEdit: null
      });
    } catch (error) {
      set({
        saveState: "error",
        error:
          error instanceof Error
            ? error.message
            : "Could not reset the local project."
      });
    }
  }
}));

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

async function saveProject(
  project: Project,
  set: (partial: Partial<AppState>) => void,
  extraState: Partial<Pick<AppState, "placementWarnings" | "lastGeometryEdit">> = {}
) {
  set({ saveState: "saving", error: null });

  try {
    await repository.save(project);
    set({ project, saveState: "saved", error: null, ...extraState });
  } catch (error) {
    set({
      project,
      saveState: "error",
      error: error instanceof Error ? error.message : "Could not save project.",
      ...extraState
    });
  }
}

function getFirstWall(project: Project): Wall | null {
  return project.floor.rooms[0]?.room.walls[0] ?? null;
}
