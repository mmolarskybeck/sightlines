import { create } from "zustand";
import { getWallsWithGeometry } from "../domain/geometry/walls";
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
  boot: () => Promise<void>;
  setViewMode: (viewMode: ViewMode) => void;
  selectWall: (wallId: string) => void;
  renameProject: (title: string) => Promise<void>;
  importProjectJson: (text: string) => Promise<void>;
};

const repository = new IndexedDbProjectRepository();

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  selectedWallId: null,
  viewMode: "plan",
  saveState: "idle",
  error: null,

  async boot() {
    try {
      const summaries = await repository.list();
      const project =
        summaries[0] ? await repository.load(summaries[0].id) : createSampleProject();

      if (!summaries[0]) {
        await repository.save(project);
      }

      const selectedWallId = getFirstWall(project)?.id ?? null;
      set({ project, selectedWallId, saveState: "saved", error: null });
    } catch (error) {
      set({
        project: createSampleProject(),
        selectedWallId: "wall-north",
        saveState: "error",
        error: error instanceof Error ? error.message : "Could not load project."
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

  async importProjectJson(text) {
    const project = migrateProject(JSON.parse(text));
    await saveProject(project, set);
    set({ selectedWallId: getFirstWall(project)?.id ?? null });
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
  set: (partial: Partial<AppState>) => void
) {
  set({ saveState: "saving", error: null });

  try {
    await repository.save(project);
    set({ project, saveState: "saved", error: null });
  } catch (error) {
    set({
      project,
      saveState: "error",
      error: error instanceof Error ? error.message : "Could not save project."
    });
  }
}

function getFirstWall(project: Project): Wall | null {
  return project.floor.rooms[0]?.room.walls[0] ?? null;
}
