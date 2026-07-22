import { describe, expect, it } from "vitest";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import type { Project, SavedView } from "../../../domain/project";
import {
  reconcileDocumentExportPreferences,
  type EffectiveDocumentSettings
} from "../../../domain/export/documentSettings";
import { deriveDocumentPageManifest } from "../../../domain/export/pageComposition";
import {
  clampPageIndex,
  derivePreviewPages,
  previewPageCaption
} from "./exportPreviewModel";

function settingsFor(project: Project): EffectiveDocumentSettings {
  const settings = reconcileDocumentExportPreferences(
    project,
    undefined,
    "en-US"
  ).settings;
  settings.sections = {
    overview: true,
    roomPlans: true,
    elevations: true,
    threeDViews: true
  };
  // Include every child so the manifest exercises all page kinds.
  settings.rooms = settings.rooms.map((room) => ({
    ...room,
    planIncluded: true,
    walls: room.walls.map((wall) => ({ ...wall, included: true }))
  }));
  settings.savedViews = settings.savedViews.map((choice) => ({
    ...choice,
    included: choice.valid
  }));
  return settings;
}

function projectWithViews(): Project {
  const project = createSampleProject();
  const view: SavedView = {
    id: "view-1",
    ordinal: 1,
    title: "Entrance sightline",
    roomId: "room-main",
    pose: {
      position: { x: 1, y: 1.5, z: 2 },
      target: { x: 1, y: 1.5, z: 0 }
    },
    createdAt: "2026-07-16T00:00:00.000Z"
  };
  project.savedViews = [view];
  return project;
}

describe("derivePreviewPages", () => {
  it("stays in lockstep with the export manifest (count, order, kinds)", () => {
    const project = projectWithViews();
    const settings = settingsFor(project);

    const manifest = deriveDocumentPageManifest(project, settings);
    const pages = derivePreviewPages(project, settings);

    expect(pages).toHaveLength(manifest.length);
    expect(pages.map((page) => page.manifest.kind)).toEqual(
      manifest.map((page) => page.kind)
    );
    // Indices are 0-based and sequential.
    expect(pages.map((page) => page.index)).toEqual(
      manifest.map((_, index) => index)
    );
  });

  it("labels each kind, folding the title in for everything but the overview", () => {
    const project = projectWithViews();
    const pages = derivePreviewPages(project, settingsFor(project));

    const overview = pages.find((page) => page.manifest.kind === "overview");
    expect(overview?.detail).toBe("Overview");

    const elevation = pages.find((page) => page.manifest.kind === "elevation");
    expect(elevation?.detail).toMatch(/^Elevation — /);

    const threeD = pages.find((page) => page.manifest.kind === "three-d");
    expect(threeD?.detail).toBe("3D view — Main Gallery · Entrance sightline");
  });

  it("returns no pages when nothing is selected", () => {
    const project = createSampleProject();
    const settings = settingsFor(project);
    settings.sections = {
      overview: false,
      roomPlans: false,
      elevations: false,
      threeDViews: false
    };
    expect(derivePreviewPages(project, settings)).toHaveLength(0);
  });
});

describe("previewPageCaption", () => {
  it("prefixes the 1-based page position and total", () => {
    const project = projectWithViews();
    const pages = derivePreviewPages(project, settingsFor(project));
    expect(previewPageCaption(pages[0]!, pages.length)).toBe(
      `Page 1 of ${pages.length} · Overview`
    );
  });
});

describe("clampPageIndex", () => {
  it("keeps an in-range index untouched", () => {
    expect(clampPageIndex(2, 5)).toBe(2);
  });

  it("pulls an over-range index back to the last page", () => {
    expect(clampPageIndex(9, 3)).toBe(2);
  });

  it("floors negatives at zero", () => {
    expect(clampPageIndex(-4, 3)).toBe(0);
  });

  it("returns 0 for an empty manifest", () => {
    expect(clampPageIndex(3, 0)).toBe(0);
  });
});
