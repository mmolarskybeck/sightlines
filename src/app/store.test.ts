import { beforeEach, describe, expect, it } from "vitest";
import type { ImageProcessor, ProcessedImage } from "../domain/assets/imageIntake";
import { CURRENT_SCHEMA_VERSION } from "../domain/project";
import type { Artwork, Asset, Project, ProjectSummary } from "../domain/project";
import type { ArtworkLibraryRepository } from "../domain/repositories/artworkLibraryRepository";
import type { AssetRepository } from "../domain/repositories/assetRepository";
import type { ProjectRepository } from "../domain/repositories/projectRepository";
import { createSampleProject } from "../domain/sample/sampleProject";
import { parseArtwork, parseAsset } from "../domain/schema/artworkSchema";
import { MAX_IMPORT_JSON_LENGTH, parseProject } from "../domain/schema/projectSchema";
import type { AppStoreDeps } from "./store";
import { createAppStore, exportProjectJson, getSelectedWall } from "./store";

class InMemoryProjectRepository implements ProjectRepository {
  projects = new Map<string, Project>();

  async load(id: string): Promise<Project> {
    const project = this.projects.get(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return project;
  }

  async save(project: Project): Promise<void> {
    parseProject(project);
    this.projects.set(project.id, project);
  }

  async list(): Promise<ProjectSummary[]> {
    return [...this.projects.values()]
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(id: string): Promise<void> {
    this.projects.delete(id);
  }
}

// Validates on save the same way IndexedDbArtworkLibraryRepository does
// (parseArtwork), so a store bug that writes a malformed record fails the
// test the same way it would fail against the real repository.
class InMemoryArtworkLibraryRepository implements ArtworkLibraryRepository {
  artworks = new Map<string, Artwork>();

  async list(): Promise<Artwork[]> {
    return [...this.artworks.values()];
  }

  async get(id: string): Promise<Artwork> {
    const artwork = this.artworks.get(id);
    if (!artwork) throw new Error(`Artwork not found: ${id}`);
    return artwork;
  }

  async save(artwork: Artwork): Promise<void> {
    parseArtwork(artwork);
    this.artworks.set(artwork.id, artwork);
  }

  async delete(id: string): Promise<void> {
    this.artworks.delete(id);
  }
}

// Same validate-on-save shape as IndexedDbAssetRepository, backed by plain
// maps instead of IndexedDB — real Blob instances flow through unchanged so
// tests can assert on their content.
class InMemoryAssetRepository implements AssetRepository {
  assets = new Map<string, Asset>();
  blobs = new Map<string, Blob>();

  async saveAsset(
    asset: Asset,
    blobs: { original: Blob; display: Blob; thumbnail: Blob }
  ): Promise<void> {
    parseAsset(asset);
    this.assets.set(asset.id, asset);
    this.blobs.set(asset.originalKey, blobs.original);
    this.blobs.set(asset.displayKey, blobs.display);
    this.blobs.set(asset.thumbnailKey, blobs.thumbnail);
  }

  async getAsset(id: string): Promise<Asset> {
    const asset = this.assets.get(id);
    if (!asset) throw new Error(`Asset not found: ${id}`);
    return asset;
  }

  async getBlob(key: string): Promise<Blob> {
    const blob = this.blobs.get(key);
    if (!blob) throw new Error(`Asset blob not found: ${key}`);
    return blob;
  }

  async delete(id: string): Promise<void> {
    this.assets.delete(id);
  }
}

// A fake processor that skips real image decoding entirely (jsdom has no
// Canvas/ImageBitmap support) — it returns tiny deterministic blobs and
// metadata instead, and can be told to throw for specific filenames to
// exercise the store's per-file failure containment.
class FakeImageProcessor implements ImageProcessor {
  processedFilenames: string[] = [];

  constructor(private readonly failingFilenames: ReadonlySet<string> = new Set()) {}

  async process(file: File): Promise<ProcessedImage> {
    this.processedFilenames.push(file.name);

    if (this.failingFilenames.has(file.name)) {
      throw new Error(`${file.name} could not be read as an image.`);
    }

    return {
      widthPx: 100,
      heightPx: 100,
      sha256: `sha256-${file.name}`,
      byteSize: file.size,
      original: new Blob([`original:${file.name}`]),
      display: new Blob([`display:${file.name}`]),
      thumbnail: new Blob([`thumbnail:${file.name}`])
    };
  }
}

function makeImageFile(name: string, type = "image/jpeg"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

describe("app store", () => {
  let repository: InMemoryProjectRepository;
  let artworkLibraryRepository: InMemoryArtworkLibraryRepository;
  let assetRepository: InMemoryAssetRepository;
  let imageProcessor: FakeImageProcessor;
  let store: ReturnType<typeof createAppStore>;

  function makeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
    return {
      projectRepository: repository,
      artworkLibraryRepository,
      assetRepository,
      imageProcessor,
      ...overrides
    };
  }

  beforeEach(async () => {
    repository = new InMemoryProjectRepository();
    artworkLibraryRepository = new InMemoryArtworkLibraryRepository();
    assetRepository = new InMemoryAssetRepository();
    imageProcessor = new FakeImageProcessor();
    store = createAppStore(makeDeps());
    await store.getState().boot();
  });

  it("boots an empty repository into a persisted sample project", () => {
    const state = store.getState();

    expect(state.project?.title).toBe("Untitled Exhibition");
    expect(state.saveState).toBe("saved");
    expect(repository.projects.size).toBe(1);
    expect(state.selectedWallId).toBe("wall-north");
  });

  it("resize creates one undo entry and undo/redo round-trips the document", async () => {
    const state = store.getState();
    const originalLength = getSelectedWall(
      state.project!,
      state.selectedWallId
    )!.lengthMm;

    await state.resizeSelectedWall(10_000);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(
      getSelectedWall(store.getState().project!, "wall-north")!.lengthMm
    ).toBeCloseTo(10_000);

    await store.getState().undo();
    expect(
      getSelectedWall(store.getState().project!, "wall-north")!.lengthMm
    ).toBeCloseTo(originalLength);
    expect(store.getState().redoStack).toHaveLength(1);

    await store.getState().redo();
    expect(
      getSelectedWall(store.getState().project!, "wall-north")!.lengthMm
    ).toBeCloseTo(10_000);

    const persisted = repository.projects.get(store.getState().project!.id)!;
    expect(getSelectedWall(persisted, "wall-north")!.lengthMm).toBeCloseTo(10_000);
  });

  it("resizeWall edits a wall other than the current selection", async () => {
    await store.getState().resizeWall("wall-east", 6_000);

    expect(
      getSelectedWall(store.getState().project!, "wall-east")!.lengthMm
    ).toBeCloseTo(6_000);
    expect(store.getState().selectedWallId).toBe("wall-north");
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("a new edit clears the redo stack", async () => {
    await store.getState().resizeSelectedWall(10_000);
    await store.getState().undo();
    expect(store.getState().redoStack).toHaveLength(1);

    await store.getState().renameProject("Winter Show");
    expect(store.getState().redoStack).toHaveLength(0);
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("setUnit updates the project's display unit, persists, and is undoable", async () => {
    const project = store.getState().project!;
    expect(project.unit).toBe("ft");

    await store.getState().setUnit("m");

    const state = store.getState();
    expect(state.project?.unit).toBe("m");
    expect(state.undoStack).toHaveLength(1);

    const persisted = repository.projects.get(state.project!.id)!;
    expect(persisted.unit).toBe("m");

    await store.getState().undo();
    expect(store.getState().project?.unit).toBe("ft");
  });

  it("skips a setUnit call that does not change the unit", async () => {
    const before = store.getState().project!;

    await store.getState().setUnit(before.unit);

    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().project).toBe(before);
  });

  it("skips no-op and empty renames instead of recording undo entries", async () => {
    const before = store.getState().project!;

    await store.getState().renameProject("   ");
    await store.getState().renameProject(before.title);

    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().project).toBe(before);
  });

  it("skips a resize that does not change any wall", async () => {
    const state = store.getState();
    const currentLength = getSelectedWall(
      state.project!,
      state.selectedWallId
    )!.lengthMm;

    await state.resizeSelectedWall(currentLength);

    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("rejects text that is not valid JSON, and leaves the current project untouched", async () => {
    const before = store.getState().project;

    await store.getState().importProjectJson("not json at all");

    expect(store.getState().error).toMatch(/Import failed/);
    expect(store.getState().error).toMatch(/not valid JSON/);
    expect(store.getState().project).toBe(before);
  });

  it("rejects valid JSON that is not a Sightlines project, and leaves the current project untouched", async () => {
    const before = store.getState().project;

    await store.getState().importProjectJson(JSON.stringify({ hello: 1 }));

    expect(store.getState().error).toMatch(/Import failed/);
    expect(store.getState().error).toMatch(/not a Sightlines project/);
    expect(store.getState().project).toBe(before);
  });

  it("rejects a project made with a newer schema version, distinctly, and leaves the current project untouched", async () => {
    const before = store.getState().project;
    const fromTheFuture = {
      ...createSampleProject(),
      schemaVersion: CURRENT_SCHEMA_VERSION + 1
    };

    await store.getState().importProjectJson(JSON.stringify(fromTheFuture));

    expect(store.getState().error).toMatch(/newer version of Sightlines/);
    expect(store.getState().project).toBe(before);
  });

  it("rejects a same-version project that fails validation, and leaves the current project untouched", async () => {
    const before = store.getState().project;
    const broken = createSampleProject();
    broken.floor.rooms[0].room.walls[0].startVertexId = "missing";

    await store.getState().importProjectJson(JSON.stringify(broken));

    expect(store.getState().error).toMatch(/doesn't match the Sightlines format/);
    expect(store.getState().project).toBe(before);
  });

  it("rejects an oversized import before parsing it, and leaves the current project untouched", async () => {
    const before = store.getState().project;
    const oversized = "a".repeat(MAX_IMPORT_JSON_LENGTH + 1);

    await store.getState().importProjectJson(oversized);

    expect(store.getState().error).toMatch(/too large/);
    expect(store.getState().project).toBe(before);
  });

  it("rejects non-string input instead of throwing, and leaves the current project untouched", async () => {
    const before = store.getState().project;

    await store.getState().importProjectJson(null as unknown as string);

    expect(store.getState().error).toMatch(/Import failed/);
    expect(store.getState().project).toBe(before);
  });

  it("exported project JSON always re-imports successfully and round-trips exactly", async () => {
    const original = store.getState().project!;
    const json = exportProjectJson(original);

    await store.getState().importProjectJson(json);

    const state = store.getState();
    expect(state.error).toBeNull();
    expect(state.project).toEqual(original);
    expect(repository.projects.get(original.id)).toEqual(original);
  });

  it("a valid import replaces the document and resets edit history", async () => {
    await store.getState().resizeSelectedWall(10_000);
    expect(store.getState().undoStack).toHaveLength(1);

    const imported = { ...createSampleProject(), id: "imported", title: "Imported" };
    await store.getState().importProjectJson(JSON.stringify(imported));

    const state = store.getState();
    expect(state.project?.id).toBe("imported");
    expect(state.undoStack).toHaveLength(0);
    expect(state.redoStack).toHaveLength(0);
    expect(state.error).toBeNull();
    expect(repository.projects.has("imported")).toBe(true);
  });

  it("surfaces a load failure instead of silently swapping in the sample", async () => {
    const failing = new InMemoryProjectRepository();
    const broken = createSampleProject();
    failing.projects.set(broken.id, broken);
    failing.load = async () => {
      throw new Error("stored document failed validation");
    };

    const failingStore = createAppStore(makeDeps({ projectRepository: failing }));
    await failingStore.getState().boot();

    const state = failingStore.getState();
    expect(state.error).toMatch(/Could not load the saved project/);
    expect(state.error).toMatch(/stored document failed validation/);
    expect(state.saveState).toBe("error");
    expect(state.project?.title).toBe("Untitled Exhibition");
  });

  it("save validates before writing, so an invalid document cannot persist", async () => {
    const project = store.getState().project!;
    const invalid = { ...project, title: "" };

    await expect(repository.save(invalid)).rejects.toThrow();
  });

  it("createProject opens a new, blank, roomless project and lists it alongside the original", async () => {
    const originalId = store.getState().project!.id;

    await store.getState().createProject("Winter Show");

    const state = store.getState();
    expect(state.project?.title).toBe("Winter Show");
    expect(state.project?.id).not.toBe(originalId);
    expect(state.project?.floor.rooms).toEqual([]);
    expect(state.selectedWallId).toBeNull();
    expect(state.undoStack).toHaveLength(0);

    const summaries = await state.listProjectSummaries();
    expect(summaries.map((summary) => summary.title).sort()).toEqual([
      "Untitled Exhibition",
      "Winter Show"
    ]);
  });

  it("openProject switches the current document and resets edit history", async () => {
    const original = store.getState().project!;
    await store.getState().createProject("Winter Show");

    await store.getState().openProject(original.id);

    const state = store.getState();
    expect(state.project?.id).toBe(original.id);
    expect(state.selectedWallId).toBe("wall-north");
    expect(state.undoStack).toHaveLength(0);
  });

  it("openProject is a no-op when the requested project is already open", async () => {
    const project = store.getState().project!;
    await store.getState().resizeSelectedWall(9_000);
    expect(store.getState().undoStack).toHaveLength(1);

    await store.getState().openProject(project.id);

    // Re-opening the already-open project must not reset the edit history
    // that was just built up.
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("deleteProject removes a non-open project without touching the current one", async () => {
    const original = store.getState().project!;
    await store.getState().createProject("Winter Show");
    const winterShow = store.getState().project!;
    await store.getState().openProject(original.id);

    await store.getState().deleteProject(winterShow.id);

    expect(repository.projects.has(winterShow.id)).toBe(false);
    expect(store.getState().project?.id).toBe(original.id);
  });

  it("deleteProject falls back to another saved project when the open one is deleted", async () => {
    const original = store.getState().project!;
    await store.getState().createProject("Winter Show");

    await store.getState().deleteProject(original.id);

    const state = store.getState();
    expect(repository.projects.has(original.id)).toBe(false);
    expect(state.project?.title).toBe("Winter Show");
  });

  it("deleteProject creates a fresh blank project when the last one is deleted", async () => {
    const original = store.getState().project!;

    await store.getState().deleteProject(original.id);

    const state = store.getState();
    expect(repository.projects.has(original.id)).toBe(false);
    expect(state.project?.floor.rooms).toEqual([]);
    expect(repository.projects.size).toBe(1);
  });

  describe("addArtworksFromFiles", () => {
    it("uploads two files as two library records with three blobs each, in one undo entry", async () => {
      const files = [makeImageFile("one.jpg"), makeImageFile("two.png", "image/png")];

      await store.getState().addArtworksFromFiles(files);

      const state = store.getState();
      expect(state.error).toBeNull();
      expect(state.intakeState).toBe("idle");
      expect(state.undoStack).toHaveLength(1);
      expect(state.undoStack[0].label).toBe("Add 2 artworks");
      expect(artworkLibraryRepository.artworks.size).toBe(2);
      expect(assetRepository.assets.size).toBe(2);
      expect(state.libraryArtworks).toHaveLength(2);

      const newIds = state.project!.checklistArtworkIds;
      expect(newIds).toHaveLength(2);

      for (const id of newIds) {
        const artwork = artworkLibraryRepository.artworks.get(id)!;
        expect(artwork.assetId).toBeDefined();
        const asset = assetRepository.assets.get(artwork.assetId!)!;
        expect(await assetRepository.getBlob(asset.originalKey)).toBeInstanceOf(Blob);
        expect(await assetRepository.getBlob(asset.displayKey)).toBeInstanceOf(Blob);
        expect(await assetRepository.getBlob(asset.thumbnailKey)).toBeInstanceOf(Blob);
      }

      const titles = newIds
        .map((id) => artworkLibraryRepository.artworks.get(id)!.title)
        .sort();
      expect(titles).toEqual(["one", "two"]);
    });

    it("undo removes checklist membership but keeps the library records and assets; redo restores membership without duplicating them", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("keeper.jpg")]);

      const afterUpload = store.getState();
      const artworkId = afterUpload.project!.checklistArtworkIds[0];
      expect(artworkLibraryRepository.artworks.size).toBe(1);
      expect(assetRepository.assets.size).toBe(1);

      await store.getState().undo();

      const afterUndo = store.getState();
      expect(afterUndo.project!.checklistArtworkIds).not.toContain(artworkId);
      expect(artworkLibraryRepository.artworks.has(artworkId)).toBe(true);
      expect(assetRepository.assets.size).toBe(1);

      await store.getState().redo();

      const afterRedo = store.getState();
      expect(afterRedo.project!.checklistArtworkIds).toContain(artworkId);
      expect(artworkLibraryRepository.artworks.size).toBe(1);
      expect(assetRepository.assets.size).toBe(1);
    });

    it("contains a per-file validation failure: the good file is checklisted, the bad one is reported", async () => {
      const goodFile = makeImageFile("good.jpg");
      const badFile = makeImageFile("bad.gif", "image/gif");

      await store.getState().addArtworksFromFiles([goodFile, badFile]);

      const state = store.getState();
      expect(state.intakeState).toBe("idle");
      expect(state.undoStack).toHaveLength(1);
      expect(state.project!.checklistArtworkIds).toHaveLength(1);
      expect(artworkLibraryRepository.artworks.size).toBe(1);
      expect(state.error).toMatch(/1 of 2 images could not be added/);
      expect(state.error).toMatch(/bad\.gif/);
      expect(state.error).toMatch(/not a supported image type/);

      // The bad file never reached the processor at all.
      expect(imageProcessor.processedFilenames).toEqual(["good.jpg"]);
    });

    it("contains a per-file processor failure: the good file is checklisted, the throwing one is reported", async () => {
      imageProcessor = new FakeImageProcessor(new Set(["broken.jpg"]));
      store = createAppStore(makeDeps());
      await store.getState().boot();

      const goodFile = makeImageFile("good.jpg");
      const brokenFile = makeImageFile("broken.jpg");

      await store.getState().addArtworksFromFiles([goodFile, brokenFile]);

      const state = store.getState();
      expect(state.intakeState).toBe("idle");
      expect(state.undoStack).toHaveLength(1);
      expect(state.project!.checklistArtworkIds).toHaveLength(1);
      expect(artworkLibraryRepository.artworks.size).toBe(1);
      expect(state.error).toMatch(/1 of 2 images could not be added/);
      expect(state.error).toMatch(/broken\.jpg/);
    });

    it("is a no-op for an empty file list: no undo entry, no error", async () => {
      const before = store.getState().project;

      await store.getState().addArtworksFromFiles([]);

      const state = store.getState();
      expect(state.project).toBe(before);
      expect(state.undoStack).toHaveLength(0);
      expect(state.error).toBeNull();
      expect(state.intakeState).toBe("idle");
    });

    it("is a no-op when no project is open", async () => {
      const freshStore = createAppStore(makeDeps());

      await freshStore.getState().addArtworksFromFiles([makeImageFile("orphan.jpg")]);

      expect(artworkLibraryRepository.artworks.size).toBe(0);
      expect(freshStore.getState().project).toBeNull();
    });
  });

  describe("removeArtworkFromChecklist", () => {
    it("removes checklist membership and any artwork wallObjects, but leaves the library record intact", async () => {
      await store.getState().addArtworksFromFiles([makeImageFile("piece.jpg")]);
      const artworkId = store.getState().project!.checklistArtworkIds[0];

      // Defensive coverage per docs/plan.md §4.1 — placements don't exist in
      // the UI yet, but the action should still clean up a dangling one.
      await applyPlacementDirectly(repository, store, artworkId);

      await store.getState().removeArtworkFromChecklist(artworkId);

      const state = store.getState();
      expect(state.project!.checklistArtworkIds).not.toContain(artworkId);
      expect(state.project!.wallObjects).toHaveLength(0);
      expect(artworkLibraryRepository.artworks.has(artworkId)).toBe(true);
      expect(assetRepository.assets.size).toBe(1);
    });

    it("is a no-op when the artwork is not on the checklist and not placed", async () => {
      const before = store.getState().project;

      await store.getState().removeArtworkFromChecklist("never-added");

      const state = store.getState();
      expect(state.project).toBe(before);
      expect(state.undoStack).toHaveLength(0);
    });
  });
});

// Injects a wall placement directly into the current project, bypassing
// applyEdit, purely to set up the "dangling placement" scenario for the
// removeArtworkFromChecklist test above — there's no store action yet that
// creates placements (docs/plan.md's placement UI is a later milestone).
async function applyPlacementDirectly(
  repository: InMemoryProjectRepository,
  store: ReturnType<typeof createAppStore>,
  artworkId: string
): Promise<void> {
  const project = store.getState().project!;
  const wallId = getSelectedWall(project, store.getState().selectedWallId)?.id;
  if (!wallId) throw new Error("Test setup requires a wall to place the artwork on.");

  const updated: Project = {
    ...project,
    wallObjects: [
      ...project.wallObjects,
      {
        id: "wall-object-test",
        wallId,
        kind: "artwork",
        artworkId,
        xMm: 0,
        yMm: 0,
        widthMm: 100,
        heightMm: 100
      }
    ]
  };

  await repository.save(updated);
  store.setState({ project: updated });
}
