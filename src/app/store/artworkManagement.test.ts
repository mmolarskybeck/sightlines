// Checklist/artwork-management store actions: the single-work updateArtwork
// characterization (pinned BEFORE its body was factored into planArtworkEdit),
// then the bulk/duplicate/blank/image actions built on that seam, and the
// history-safety rules deleteLibraryArtworks applies to the undo/redo stacks.
import { beforeEach, describe, expect, it } from "vitest";
import { MONITOR_ASPECT_RATIO, MONITOR_DEPTH_MM } from "../../domain/project";
import type { Project } from "../../domain/project";
import type { ImageProcessor, ProcessedImage } from "../../domain/assets/imageIntake";
import { PLACEHOLDER_ARTWORK_WIDTH_MM } from "../../domain/placement/placeArtwork";
import { makeImageFile } from "../../test/inMemoryRepositories";
import { createTestAppStore, type TestAppStore } from "../../test/testAppStore";
import { getSelectedArtworkId, getSelectedWall } from "../store";

let t: TestAppStore;
const state = () => t.store.getState();
const project = () => state().project!;
const record = (id: string) => state().libraryArtworks.find((a) => a.id === id);
const wallId = () => getSelectedWall(project(), state().wallContextId)!.id;

async function addWork(name = "piece.jpg"): Promise<string> {
  await state().addArtworksFromFiles([makeImageFile(name)]);
  return project().checklistArtworkIds.at(-1)!;
}

async function addFloorWork(
  name: string,
  dimensions: { widthMm: number; heightMm: number; depthMm?: number },
  xMm = 4000,
  yMm = 4000
) {
  const artworkId = await addWork(name);
  await state().updateArtwork(artworkId, { dimensions: { ...dimensions, status: "known" } });
  await state().placeArtworkOnFloor(artworkId, xMm, yMm);
  return { artworkId, objectId: project().floorObjects.at(-1)!.id };
}

const floorObject = (objectId: string) =>
  project().floorObjects.find((o) => o.id === objectId)!;

const isPlaced = (artworkId: string, p: Project = project()) =>
  p.wallObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId) ||
  p.floorObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId);

beforeEach(async () => {
  t = createTestAppStore();
  await state().boot();
});

describe("updateArtwork characterization", () => {
  it("writes medium into metadata.medium and deletes the key when blank", async () => {
    const id = await addWork();
    await state().updateArtwork(id, { medium: "Oil on canvas" });
    expect(record(id)!.metadata.medium).toBe("Oil on canvas");
    expect("medium" in record(id)!).toBe(false);

    await state().updateArtwork(id, { medium: " " });
    expect("medium" in record(id)!.metadata).toBe(false);
  });

  it("pushes no undo entry for a no-op edit", async () => {
    const id = await addWork();
    const depth = state().undoStack.length;
    await state().updateArtwork(id, { title: record(id)!.title });
    await state().updateArtwork(id, { medium: undefined });
    expect(state().undoStack).toHaveLength(depth);
  });

  it("resizes a wall placement without displayDimensionsOverride on a dimension edit", async () => {
    const id = await addWork();
    await state().placeArtwork(id, wallId(), 1000, 1450);
    const placementId = project().wallObjects.at(-1)!.id;
    expect(project().wallObjects.at(-1)!.widthMm).toBe(PLACEHOLDER_ARTWORK_WIDTH_MM);
    const depth = state().undoStack.length;

    await state().updateArtwork(id, {
      dimensions: { widthMm: 500, heightMm: 400, status: "known" }
    });

    const placement = project().wallObjects.find((o) => o.id === placementId)!;
    expect(placement).toMatchObject({ widthMm: 500, heightMm: 400 });
    expect(state().undoStack).toHaveLength(depth + 1);
    expect(state().undoStack.at(-1)!.label).toBe("Edit artwork");
    expect(state().undoStack.at(-1)!.project).toBeDefined();
  });

  it("follows an undiverged floor placement, but not a diverged one", async () => {
    const a = await addFloorWork("a.jpg", { widthMm: 500, heightMm: 400, depthMm: 300 }, 3000);
    const b = await addFloorWork("b.jpg", { widthMm: 500, heightMm: 400, depthMm: 300 }, 5000);
    await state().updateFloorObject(b.objectId, { widthMm: 2000 });

    for (const { artworkId } of [a, b]) {
      await state().updateArtwork(artworkId, {
        dimensions: { widthMm: 800, heightMm: 600, depthMm: 300, status: "known" }
      });
    }

    expect(floorObject(a.objectId)).toMatchObject({ widthMm: 800, heightMm: 600 });
    expect(floorObject(b.objectId)).toMatchObject({ widthMm: 2000, heightMm: 400 });
  });

  it("rebakes the floor cabinet when displayAs becomes monitor", async () => {
    const { artworkId, objectId } = await addFloorWork("crt.jpg", {
      widthMm: 500,
      heightMm: 400,
      depthMm: 20
    });
    expect(floorObject(objectId).depthMm).toBe(20);

    await state().updateArtwork(artworkId, { displayAs: "monitor" });

    const after = floorObject(objectId);
    expect(after.widthMm).toBe(500);
    expect(after.heightMm).toBeCloseTo(500 / MONITOR_ASPECT_RATIO, 6);
    expect(after.depthMm).toBe(MONITOR_DEPTH_MM);
  });

  it("revalidates placements when frameIncludedInImage toggles", async () => {
    const id = await addWork("framed.jpg");
    await state().updateArtwork(id, {
      dimensions: { widthMm: 400, heightMm: 300, status: "known" },
      matWidthMm: 75,
      frame: { widthMm: 25, finish: "black" }
    });
    await state().placeArtwork(id, wallId(), 250, 1450);
    const placementId = project().wallObjects.at(-1)!.id;
    expect(state().placementWarnings.some((w) => w.wallObjectId === placementId)).toBe(true);

    await state().updateArtwork(id, { frameIncludedInImage: true });
    expect(state().placementWarnings.some((w) => w.wallObjectId === placementId)).toBe(false);

    await state().updateArtwork(id, { frameIncludedInImage: false });
    expect(state().placementWarnings.some((w) => w.wallObjectId === placementId)).toBe(true);
  });
});

// An image processor whose results the test releases by hand, so a test can
// act on the store WHILE an image is "processing".
class DeferredImageProcessor implements ImageProcessor {
  private pending: { resolve: (image: ProcessedImage) => void; reject: (e: Error) => void; name: string }[] = [];

  process(file: File): Promise<ProcessedImage> {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject, name: file.name });
    });
  }

  get waiting(): number {
    return this.pending.length;
  }

  resolveNext(): void {
    const next = this.pending.shift()!;
    next.resolve({
      widthPx: 100,
      heightPx: 100,
      sha256: `sha256-${next.name}`,
      byteSize: 4,
      original: new Blob([`original:${next.name}`]),
      display: new Blob([`display:${next.name}`]),
      thumbnail: new Blob([`thumbnail:${next.name}`])
    });
  }

  rejectNext(message = "Not an image."): void {
    this.pending.shift()!.reject(new Error(message));
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("updateArtworks", () => {
  it("skips placementForm per field for a placed work, in one undo entry", async () => {
    const placed = await addWork("placed.jpg");
    const loose = await addWork("loose.jpg");
    await state().placeArtwork(placed, wallId(), 1000, 1450);
    const placedFormBefore = record(placed)!.placementForm;
    const depth = state().undoStack.length;

    const result = await state().updateArtworks([placed, loose, placed], {
      artist: "Agnes Martin",
      placementForm: "floor"
    });

    expect(result).toEqual({ updated: 2, placementTypeSkipped: 1 });
    expect(record(placed)!.artist).toBe("Agnes Martin");
    expect(record(loose)!.artist).toBe("Agnes Martin");
    expect(record(placed)!.placementForm).toBe(placedFormBefore);
    expect(record(loose)!.placementForm).toBe("floor");
    expect(state().undoStack).toHaveLength(depth + 1);
    expect(state().undoStack.at(-1)!.label).toBe("Edit 2 works");
    expect(t.artworkLibraryRepository.artworks.get(loose)?.placementForm).toBe("floor");

    await state().undo();
    expect(record(placed)!.artist).toBeUndefined();
    expect(record(loose)!.artist).toBeUndefined();
    expect(record(loose)!.placementForm).toBeUndefined();

    await state().redo();
    expect(record(placed)!.artist).toBe("Agnes Martin");
    expect(record(loose)!.placementForm).toBe("floor");
  });

  it("labels a one-work batch as a plain edit and pushes nothing for a no-op", async () => {
    const id = await addWork();
    await state().updateArtworks([id], { artist: "A" });
    expect(state().undoStack.at(-1)!.label).toBe("Edit artwork");
    const depth = state().undoStack.length;
    expect(await state().updateArtworks([id, "missing"], { artist: "A" })).toEqual({
      updated: 0,
      placementTypeSkipped: 0
    });
    expect(state().undoStack).toHaveLength(depth);
  });

  it("rebakes every monitor cabinet in the final project (no overwrite)", async () => {
    const a = await addFloorWork("a.jpg", { widthMm: 500, heightMm: 400, depthMm: 20 }, 3000);
    const b = await addFloorWork("b.jpg", { widthMm: 800, heightMm: 600, depthMm: 20 }, 6000);
    const depth = state().undoStack.length;

    await state().updateArtworks([a.artworkId, b.artworkId], { displayAs: "monitor" });

    expect(floorObject(a.objectId)).toMatchObject({ widthMm: 500, depthMm: MONITOR_DEPTH_MM });
    expect(floorObject(b.objectId)).toMatchObject({ widthMm: 800, depthMm: MONITOR_DEPTH_MM });
    expect(floorObject(b.objectId).heightMm).toBeCloseTo(800 / MONITOR_ASPECT_RATIO, 6);
    expect(state().undoStack).toHaveLength(depth + 1);
    expect(t.projectRepository.projects.get(project().id)!.floorObjects).toEqual(
      project().floorObjects
    );

    await state().undo();
    expect(floorObject(a.objectId).depthMm).toBe(20);
    expect(floorObject(b.objectId).depthMm).toBe(20);
  });

  it("aborts the whole batch on an invalid value", async () => {
    const a = await addWork("a.jpg");
    const depth = state().undoStack.length;
    const result = await state().updateArtworks([a], {
      displayAs: "nonsense" as unknown as "framed"
    });
    expect(result.updated).toBe(0);
    expect(state().error).toBeTruthy();
    expect(state().undoStack).toHaveLength(depth);
  });
});

describe("removeArtworksFromChecklist", () => {
  it("drops membership and placements in one entry, and undo restores both", async () => {
    const a = await addWork("a.jpg");
    const b = await addWork("b.jpg");
    const c = await addWork("c.jpg");
    await state().placeArtwork(a, wallId(), 1000, 1450);
    const before = project();
    const depth = state().undoStack.length;

    await state().removeArtworksFromChecklist([a, b, "not-here"]);

    expect(project().checklistArtworkIds).toEqual([c]);
    expect(isPlaced(a)).toBe(false);
    expect(state().undoStack).toHaveLength(depth + 1);
    expect(state().undoStack.at(-1)!.label).toBe("Remove 2 works from checklist");
    expect(record(a)).toBeDefined();

    await state().undo();
    expect(project().checklistArtworkIds).toEqual(before.checklistArtworkIds);
    expect(isPlaced(a)).toBe(true);
  });

  it("keeps the singular label through removeArtworkFromChecklist and no-ops on strangers", async () => {
    const a = await addWork("a.jpg");
    await state().removeArtworkFromChecklist(a);
    expect(state().undoStack.at(-1)!.label).toBe("Remove from checklist");
    const depth = state().undoStack.length;
    await state().removeArtworksFromChecklist([a]);
    expect(state().undoStack).toHaveLength(depth);
  });
});

describe("duplicateArtworks", () => {
  it("inserts each copy after its source, sharing the asset, and undo keeps the record", async () => {
    const a = await addWork("a.jpg");
    const b = await addWork("b.jpg");
    await state().updateArtwork(a, { accessionNumber: "2024.1", title: "Field" });
    const depth = state().undoStack.length;

    const [copyId] = await state().duplicateArtworks([a]);

    expect(project().checklistArtworkIds).toEqual([a, copyId, b]);
    const copy = record(copyId)!;
    expect(copy.title).toBe("Field (copy)");
    expect("accessionNumber" in copy).toBe(false);
    expect(copy.assetId).toBe(record(a)!.assetId);
    expect(state().undoStack).toHaveLength(depth + 1);
    expect(state().undoStack.at(-1)!.label).toBe("Duplicate artwork");
    expect(getSelectedArtworkId(project(), state().selection)).toBe(copyId);

    await state().undo();
    expect(project().checklistArtworkIds).toEqual([a, b]);
    expect(record(copyId)).toBeDefined();
  });

  it("puts multiple copies after their own sources; library-only sources get no entry", async () => {
    const a = await addWork("a.jpg");
    const b = await addWork("b.jpg");
    await state().addArtworksFromFiles([makeImageFile("lib.jpg")], { destination: "library" });
    const lib = state().libraryArtworks.find((x) => !project().checklistArtworkIds.includes(x.id))!;

    const ids = await state().duplicateArtworks([b, a, lib.id]);

    expect(ids).toHaveLength(3);
    const [copyB, copyA, copyLib] = ids;
    expect(project().checklistArtworkIds).toEqual([a, copyA, b, copyB]);
    expect(state().undoStack.at(-1)!.label).toBe("Duplicate 2 works");
    expect(record(copyLib)!.title).toBe("lib (copy)");
    expect(project().checklistArtworkIds).not.toContain(copyLib);
  });

  it("deleting the duplicate keeps the shared asset", async () => {
    const a = await addWork("a.jpg");
    const assetId = record(a)!.assetId!;
    const [copyId] = await state().duplicateArtworks([a]);

    await state().deleteLibraryArtworks([copyId]);

    expect(record(copyId)).toBeUndefined();
    expect(t.assetRepository.assets.has(assetId)).toBe(true);
  });
});

describe("createBlankArtwork", () => {
  it("adds an image-less known-size work to the checklist and selects it", async () => {
    const depth = state().undoStack.length;
    const id = (await state().createBlankArtwork({
      title: "  ",
      artist: "Rothko",
      widthMm: 600,
      heightMm: 900,
      placementForm: "wall"
    }))!;

    const work = record(id)!;
    expect(work.assetId).toBeUndefined();
    expect(work).toMatchObject({
      title: "Untitled",
      artist: "Rothko",
      placementForm: "wall",
      dimensions: { widthMm: 600, heightMm: 900, status: "known" }
    });
    expect(project().checklistArtworkIds.at(-1)).toBe(id);
    expect(state().undoStack).toHaveLength(depth + 1);
    expect(state().undoStack.at(-1)!.label).toBe("Add artwork");
    expect(getSelectedArtworkId(project(), state().selection)).toBe(id);

    await state().undo();
    expect(project().checklistArtworkIds).not.toContain(id);
    expect(record(id)).toBeDefined();
  });

  it("rejects an invalid size without writing anything", async () => {
    const count = state().libraryArtworks.length;
    const id = await state().createBlankArtwork({
      widthMm: -1,
      heightMm: 10,
      placementForm: "floor"
    });
    expect(id).toBeNull();
    expect(state().error).toBeTruthy();
    expect(state().libraryArtworks).toHaveLength(count);
  });
});

describe("setArtworkImage", () => {
  let processor: DeferredImageProcessor;

  beforeEach(async () => {
    processor = new DeferredImageProcessor();
    t = createTestAppStore({ imageProcessor: processor });
    await state().boot();
  });

  async function addBlank(): Promise<string> {
    return (await state().createBlankArtwork({
      title: "Blank",
      widthMm: 500,
      heightMm: 400,
      placementForm: "wall"
    }))!;
  }

  async function addImaged(name: string): Promise<string> {
    const pending = state().addArtworksFromFiles([makeImageFile(name)]);
    await flush();
    processor.resolveNext();
    await pending;
    return project().checklistArtworkIds.at(-1)!;
  }

  it("leaves the work unchanged when processing fails", async () => {
    const id = await addBlank();
    const depth = state().undoStack.length;
    const assetCount = t.assetRepository.assets.size;

    const pending = state().setArtworkImage(id, makeImageFile("bad.jpg"));
    await flush();
    processor.rejectNext("Not an image.");
    await pending;

    expect(state().error).toBe("Could not use that image (Not an image.).");
    expect(record(id)!.assetId).toBeUndefined();
    expect(state().undoStack).toHaveLength(depth);
    expect(t.assetRepository.assets.size).toBe(assetCount);
  });

  it("keeps an edit made while processing, and undo restores the previous asset", async () => {
    const id = await addImaged("first.jpg");
    const firstAsset = record(id)!.assetId!;

    const pending = state().setArtworkImage(id, makeImageFile("second.jpg"));
    await flush();
    await state().updateArtwork(id, { artist: "Mid-flight" });
    processor.resolveNext();
    await pending;

    const work = record(id)!;
    expect(work.artist).toBe("Mid-flight");
    expect(work.assetId).not.toBe(firstAsset);
    expect(t.assetRepository.assets.has(work.assetId!)).toBe(true);
    expect(state().undoStack.at(-1)!.label).toBe("Replace image");

    await state().undo();
    expect(record(id)!.assetId).toBe(firstAsset);
    expect(record(id)!.artist).toBe("Mid-flight");
    expect(t.assetRepository.assets.has(firstAsset)).toBe(true);
  });

  it("labels a first image as Add image, and removeArtworkImage unlinks without deleting", async () => {
    const id = await addBlank();
    const pending = state().setArtworkImage(id, makeImageFile("new.jpg"));
    await flush();
    processor.resolveNext();
    await pending;
    expect(state().undoStack.at(-1)!.label).toBe("Add image");
    const assetId = record(id)!.assetId!;

    await state().removeArtworkImage(id);
    expect("assetId" in record(id)!).toBe(false);
    expect(state().undoStack.at(-1)!.label).toBe("Remove image");
    expect(t.assetRepository.assets.has(assetId)).toBe(true);

    const depth = state().undoStack.length;
    await state().removeArtworkImage(id);
    expect(state().undoStack).toHaveLength(depth);
  });

  it("stops when the work is deleted while processing", async () => {
    const id = await addBlank();
    const pending = state().setArtworkImage(id, makeImageFile("late.jpg"));
    await flush();
    await state().deleteLibraryArtworks([id]);
    processor.resolveNext();
    await pending;

    expect(state().error).toBe("That work was deleted before its image finished processing.");
    expect(record(id)).toBeUndefined();
    expect(t.artworkLibraryRepository.artworks.has(id)).toBe(false);
  });

  it("does not apply when the project changes while processing", async () => {
    const id = await addBlank();
    const pending = state().setArtworkImage(id, makeImageFile("late.jpg"));
    await flush();
    await state().createProject("Another show");
    processor.resolveNext();
    await pending;

    expect(state().error).toBe(
      "The image was saved, but not applied because the open project changed."
    );
    expect(record(id)!.assetId).toBeUndefined();
  });
});

describe("deleteLibraryArtworks history safety", () => {
  it("keeps an asset that undo can still point a surviving work back at", async () => {
    const original = await addWork("a.jpg");
    const assetA = record(original)!.assetId!;
    const [duplicate] = await state().duplicateArtworks([original]);

    await state().setArtworkImage(original, makeImageFile("b.jpg"));
    expect(record(original)!.assetId).not.toBe(assetA);

    await state().deleteLibraryArtworks([duplicate]);
    expect(t.assetRepository.assets.has(assetA)).toBe(true);

    await state().undo();
    expect(record(original)!.assetId).toBe(assetA);
  });

  it("drops entries carrying a deleted work's artwork half, so undo cannot resurrect it", async () => {
    const id = await addWork("a.jpg");
    await state().updateArtwork(id, { artist: "Gone" });

    await state().deleteLibraryArtworks([id]);
    expect(state().undoStack.some((e) => e.artwork?.before.id === id)).toBe(false);

    while (state().undoStack.length > 0) await state().undo();
    expect(t.artworkLibraryRepository.artworks.has(id)).toBe(false);
    expect(record(id)).toBeUndefined();
  });

  it("keeps a bulk entry's surviving halves when one of its works is deleted", async () => {
    const kept = await addWork("kept.jpg");
    const gone = await addWork("gone.jpg");
    await state().updateArtworks([kept, gone], { artist: "Bulk" });

    await state().deleteLibraryArtworks([gone]);
    const entry = state().undoStack.at(-1)!;
    expect(entry.label).toBe("Edit 2 works");
    expect(entry.artworks?.map((half) => half.after.id)).toEqual([kept]);

    await state().undo();
    expect(record(kept)!.artist).toBeUndefined();
    expect(t.artworkLibraryRepository.artworks.has(gone)).toBe(false);
  });

  it("strips a deleted work from project halves through full undo and redo", async () => {
    const w = await addWork("w.jpg");
    await state().placeArtwork(w, wallId(), 1000, 1450);
    await state().setDefaultCenterlineHeightMm(1500);

    await state().deleteLibraryArtworks([w]);

    const check = () => {
      expect(project().checklistArtworkIds).not.toContain(w);
      expect(isPlaced(w)).toBe(false);
    };
    check();
    while (state().undoStack.length > 0) {
      await state().undo();
      check();
    }
    while (state().redoStack.length > 0) {
      await state().redo();
      check();
    }
    expect(project().defaultCenterlineHeightMm).toBe(1500);
  });
});
