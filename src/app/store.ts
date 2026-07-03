import { create } from "zustand";
import { createBrowserImageProcessor } from "../domain/assets/browserImageProcessor";
import { titleFromFilename, validateImageFile, type ImageProcessor } from "../domain/assets/imageIntake";
import { createNextRectangleRoom } from "../domain/geometry/createRoom";
import { resizeWallPreservingAngles } from "../domain/geometry/editRoom";
import { getWallsWithGeometry } from "../domain/geometry/walls";
import { createBlankProject } from "../domain/newProject";
import type { PlacementWarning } from "../domain/placement/validatePlacement";
import { validateChangedWallPlacements } from "../domain/placement/validatePlacement";
import {
  CURRENT_ARTWORK_SCHEMA_VERSION,
  CURRENT_ASSET_SCHEMA_VERSION,
  type Artwork,
  type Asset,
  type DisplayUnit,
  type Project,
  type ProjectSummary,
  type Wall
} from "../domain/project";
import type { ArtworkLibraryRepository } from "../domain/repositories/artworkLibraryRepository";
import { assetBlobKey, type AssetRepository } from "../domain/repositories/assetRepository";
import { IndexedDbArtworkLibraryRepository } from "../domain/repositories/indexedDbArtworkLibraryRepository";
import { IndexedDbAssetRepository } from "../domain/repositories/indexedDbAssetRepository";
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
  libraryArtworks: Artwork[];
  intakeState: "idle" | "processing";
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
  addArtworksFromFiles: (files: File[]) => Promise<void>;
  removeArtworkFromChecklist: (artworkId: string) => Promise<void>;
};

export type AppStoreDeps = {
  projectRepository: ProjectRepository;
  artworkLibraryRepository: ArtworkLibraryRepository;
  assetRepository: AssetRepository;
  imageProcessor: ImageProcessor;
};

export function createAppStore(deps: AppStoreDeps) {
  return create<AppState>((set, get) => {
    async function persist(project: Project) {
      set({ saveState: "saving", error: null });

      try {
        await deps.projectRepository.save(project);
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
      libraryArtworks: [],
      intakeState: "idle",

      async boot() {
        // The library is a secondary document from the project's point of
        // view (docs/plan.md §4.1) — a failure to load it shouldn't take
        // down boot the way a failed project load does. Keep it empty and
        // say so calmly, but only if nothing more important already needs
        // to be surfaced.
        let libraryArtworks: Artwork[] = [];
        let libraryError: string | null = null;
        try {
          libraryArtworks = await deps.artworkLibraryRepository.list();
        } catch (error) {
          libraryError = `Could not load the artwork library (${
            error instanceof Error ? error.message : "unknown error"
          }). Your project is unaffected — try reloading to pick the library back up.`;
        }

        try {
          const summaries = await deps.projectRepository.list();
          const project = summaries[0]
            ? await deps.projectRepository.load(summaries[0].id)
            : createSampleProject();

          if (!summaries[0]) {
            await deps.projectRepository.save(project);
          }

          setDocument(project, { saveState: "saved", libraryArtworks, error: libraryError });
        } catch (error) {
          // Keep the app usable with an in-memory sample, but say plainly that
          // the saved project could not load — never silently substitute.
          // The project load failure is the more important message here, so
          // it wins over any calmer library-load note.
          setDocument(createSampleProject(), {
            saveState: "error",
            libraryArtworks,
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
          return await deps.projectRepository.list();
        } catch {
          return [];
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
      },

      async addArtworksFromFiles(files) {
        const project = get().project;
        if (!project || files.length === 0) return;

        set({ intakeState: "processing", error: null });

        const newArtworkIds: string[] = [];
        const failures: string[] = [];

        try {
          for (const file of files) {
            const validation = validateImageFile(file);
            if (!validation.ok) {
              failures.push(validation.reason);
              continue;
            }

            let processed;
            try {
              processed = await deps.imageProcessor.process(file);
            } catch (error) {
              failures.push(
                error instanceof Error ? error.message : `${file.name} could not be processed.`
              );
              continue;
            }

            const assetId = crypto.randomUUID();
            const asset: Asset = {
              id: assetId,
              schemaVersion: CURRENT_ASSET_SCHEMA_VERSION,
              mimeType: file.type,
              originalFilename: file.name,
              originalKey: assetBlobKey(assetId, "original"),
              displayKey: assetBlobKey(assetId, "display"),
              thumbnailKey: assetBlobKey(assetId, "thumbnail"),
              widthPx: processed.widthPx,
              heightPx: processed.heightPx,
              byteSize: processed.byteSize,
              sha256: processed.sha256
            };

            const artwork: Artwork = {
              id: crypto.randomUUID(),
              schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
              title: titleFromFilename(file.name),
              dimensions: { status: "unknown" },
              assetId,
              metadata: {}
            };

            try {
              await deps.assetRepository.saveAsset(asset, {
                original: processed.original,
                display: processed.display,
                thumbnail: processed.thumbnail
              });
              await deps.artworkLibraryRepository.save(artwork);
              newArtworkIds.push(artwork.id);
            } catch (error) {
              failures.push(
                error instanceof Error ? error.message : `${file.name} could not be saved.`
              );
            }
          }

          // Library/asset writes happen outside applyEdit, on purpose: they
          // are not part of the undoable document. Undoing this batch must
          // only remove checklist membership, never delete the library
          // record it points at — the same artwork may be shared with
          // another project or a future tour stop (docs/plan.md §4.1).
          if (newArtworkIds.length > 0) {
            set({ libraryArtworks: await deps.artworkLibraryRepository.list() });

            const label =
              newArtworkIds.length === 1 ? "Add artwork" : `Add ${newArtworkIds.length} artworks`;

            await applyEdit(label, (current) => ({
              ...current,
              checklistArtworkIds: [...current.checklistArtworkIds, ...newArtworkIds]
            }));
          }

          if (failures.length > 0) {
            set({
              error: `${failures.length} of ${files.length} image${
                files.length === 1 ? "" : "s"
              } could not be added: ${failures.join(" ")}`
            });
          }
        } finally {
          set({ intakeState: "idle" });
        }
      },

      async removeArtworkFromChecklist(artworkId) {
        const project = get().project;
        if (!project) return;

        const isChecklisted = project.checklistArtworkIds.includes(artworkId);
        const isPlaced = project.wallObjects.some(
          (wallObject) => wallObject.kind === "artwork" && wallObject.artworkId === artworkId
        );
        if (!isChecklisted && !isPlaced) return;

        // Removing from a checklist unlinks it from this project only — the
        // library record is untouched (docs/plan.md §4.1). Also drops any
        // placement referencing this artwork, defensively: placements don't
        // exist in the UI yet, but a checklist entry with a dangling
        // placement would be an invalid state to leave behind.
        await applyEdit("Remove from checklist", (current) => ({
          ...current,
          checklistArtworkIds: current.checklistArtworkIds.filter((id) => id !== artworkId),
          wallObjects: current.wallObjects.filter(
            (wallObject) => !(wallObject.kind === "artwork" && wallObject.artworkId === artworkId)
          )
        }));
      }
    };
  });
}

export const useAppStore = createAppStore({
  projectRepository: new IndexedDbProjectRepository(),
  artworkLibraryRepository: new IndexedDbArtworkLibraryRepository(),
  assetRepository: new IndexedDbAssetRepository(),
  imageProcessor: createBrowserImageProcessor()
});

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
