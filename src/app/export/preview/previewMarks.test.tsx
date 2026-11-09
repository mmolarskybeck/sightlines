import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  fitBoundsToRect,
  type DocumentBoundsMm
} from "../../../domain/export/pageComposition";
import { reconcileDocumentExportPreferences } from "../../../domain/export/documentSettings";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import type { ElevationScene } from "../../../domain/scene2d/elevationScene";
import { elevationPageMarks } from "./elevationPageMarks";
import { planObjectMarks } from "./planPageMarks";
import { planTransform } from "./previewTransforms";

afterEach(cleanup);

// The export preview card is a look-ahead at the PDF, so the one failure mode
// that matters here is DRIFT: a support drawn on the canvas and in the artifact
// but missing (or differently placed) in the preview. These assert the support
// marks on both surfaces of the card against the same scene numbers the PDF
// writer consumes.

const BOUNDS: DocumentBoundsMm = {
  minXMm: 0,
  minYMm: 0,
  maxXMm: 4000,
  maxYMm: 3000,
  widthMm: 4000,
  heightMm: 3000
};
const RECT = { xPt: 0, yPt: 0, widthPt: 4000, heightPt: 3000 };

function settings() {
  return reconcileDocumentExportPreferences(createSampleProject(), undefined, "en-US")
    .settings;
}

const workRect: PlanRect = {
  centerXMm: 2000,
  centerYMm: 1500,
  widthMm: 400,
  depthMm: 400,
  angleDeg: 0
};

function renderMarks(marks: JSX.Element | JSX.Element[]) {
  return render(<svg>{marks}</svg>);
}

describe("ExportPdfPreview — plan support marks", () => {
  const xf = planTransform(BOUNDS, fitBoundsToRect(BOUNDS, RECT));

  it("draws a support's own footprint, filled and undashed, from its scene entry", () => {
    // Deliberately wider than a work: this is what a re-derived "same as the
    // placement" footprint would get wrong.
    const supportRect: PlanRect = { ...workRect, widthMm: 900, depthMm: 700 };
    const { container } = renderMarks(
      planObjectMarks(supportRect, "support", true, false, xf, "fobj-0")
    );

    const polygons = Array.from(container.querySelectorAll("polygon"));
    // One footprint, and nothing else: a support has no inner mark.
    expect(polygons).toHaveLength(1);
    const xs = polygons[0]!
      .getAttribute("points")!
      .split(" ")
      .map((pair) => Number(pair.split(",")[0]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(900 * xf.scalePtPerMm);
    // A support is a solid volume seen from above — never the floor object's
    // dashed outline.
    expect(polygons[0]!.getAttribute("stroke-dasharray")).toBeFalsy();
  });

  it("adds a dashed bonnet polygon at the same footprint, and only with a bonnet", () => {
    const supportRect: PlanRect = { ...workRect, widthMm: 900, depthMm: 700 };
    const dashedCount = (container: Element) =>
      container.querySelectorAll("polygon[stroke-dasharray]").length;

    const { container: plain } = renderMarks(
      planObjectMarks(supportRect, "support", true, false, xf, "fobj-0")
    );
    expect(dashedCount(plain)).toBe(0);

    const { container: bonneted } = renderMarks(
      planObjectMarks(supportRect, "support", true, false, xf, "fobj-0", undefined, true)
    );
    // Bonnet footprint = support footprint (USER DECISION 2026-09-17), so the
    // dash is the whole of what distinguishes it.
    expect(dashedCount(bonneted)).toBe(1);
  });

  it("ignores hasBonnet on a work, which keeps exactly the marks it always had", () => {
    const { container } = renderMarks(
      planObjectMarks(workRect, "artwork", true, false, xf, "fobj-0", undefined, true)
    );
    // The footprint plus the generic artwork inset — what it drew before
    // supports existed.
    expect(container.querySelectorAll("polygon")).toHaveLength(2);
  });
});

describe("ExportPdfPreview — elevation support ghost marks", () => {
  function scene(
    ghost: Partial<ElevationScene["supportGhosts"][number]> = {}
  ): ElevationScene {
    return {
      wallLengthMm: 4000,
      wallHeightMm: 3000,
      floorLineSvgY: 3000,
      centerlineSvgY: 1500,
      artworks: [],
      openings: [],
      wallTexts: [],
      cases: [],
      shelves: [],
      floorCaseGhosts: [],
      suspendedArtworkGhosts: [],
      supportGhosts: [
        {
          objectId: "support-1",
          xMinMm: 1000,
          xMaxMm: 1600,
          heightMm: 1100,
          supportKind: "pedestal",
          ...ghost
        }
      ],
      monitorGhosts: [],
      partitionProfiles: []
    };
  }

  const bounds: DocumentBoundsMm = {
    minXMm: 0,
    minYMm: 0,
    maxXMm: 4000,
    maxYMm: 3000,
    widthMm: 4000,
    heightMm: 3000
  };
  const xf = planTransform(bounds, fitBoundsToRect(bounds, RECT));

  function ghostRects(container: Element) {
    return Array.from(container.querySelectorAll("rect")).filter((rect) =>
      rect.getAttribute("stroke-dasharray")
    );
  }

  it("draws the block on the floor line at the projected span", () => {
    const { container } = renderMarks(
      elevationPageMarks(scene(), bounds, xf, settings(), false)
    );

    const rects = ghostRects(container);
    expect(rects).toHaveLength(1);
    const block = rects[0]!;
    // This surface is SVG-y-down from the wall top: the block's TOP is
    // 3000 - 1100 = 1900 down.
    expect(Number(block.getAttribute("y"))).toBeCloseTo(1900 * xf.scalePtPerMm);
    expect(Number(block.getAttribute("height"))).toBeCloseTo(1100 * xf.scalePtPerMm);
    expect(Number(block.getAttribute("x"))).toBeCloseTo(1000 * xf.scalePtPerMm);
    expect(Number(block.getAttribute("width"))).toBeCloseTo(600 * xf.scalePtPerMm);
  });

  it("adds the bonnet from the top face at the support's footprint", () => {
    const { container } = renderMarks(
      elevationPageMarks(scene({ bonnetHeightMm: 475 }), bounds, xf, settings(), false)
    );

    const rects = ghostRects(container);
    expect(rects).toHaveLength(2);
    const bonnet = rects[1]!;
    // 3000 - (1100 + 475) = 1425 down from the wall top.
    expect(Number(bonnet.getAttribute("y"))).toBeCloseTo(1425 * xf.scalePtPerMm);
    expect(Number(bonnet.getAttribute("height"))).toBeCloseTo(475 * xf.scalePtPerMm);
    expect(Number(bonnet.getAttribute("width"))).toBeCloseTo(600 * xf.scalePtPerMm);
  });
});

describe("ExportPdfPreview — elevation monitor ghost marks", () => {
  function scene(
    ghost: Partial<ElevationScene["monitorGhosts"][number]> = {}
  ): ElevationScene {
    return {
      wallLengthMm: 4000,
      wallHeightMm: 3000,
      floorLineSvgY: 3000,
      centerlineSvgY: 1500,
      artworks: [],
      openings: [],
      wallTexts: [],
      cases: [],
      shelves: [],
      floorCaseGhosts: [],
      suspendedArtworkGhosts: [],
      supportGhosts: [],
      monitorGhosts: [
        {
          object: { id: "floor-monitor" } as ElevationScene["monitorGhosts"][number]["object"],
          // A 500mm cabinet standing on the bare floor.
          xMinMm: 2750,
          xMaxMm: 3250,
          monitorHeightMm: 375,
          baseHeightMm: 0,
          ...ghost
        }
      ],
      partitionProfiles: []
    };
  }

  const bounds: DocumentBoundsMm = {
    minXMm: 0,
    minYMm: 0,
    maxXMm: 4000,
    maxYMm: 3000,
    widthMm: 4000,
    heightMm: 3000
  };
  const xf = planTransform(bounds, fitBoundsToRect(bounds, RECT));

  function ghostRects(container: Element) {
    return Array.from(container.querySelectorAll("rect")).filter((rect) =>
      rect.getAttribute("stroke-dasharray")
    );
  }

  it("draws the cabinet and its screen on the floor line, and no plinth", () => {
    const { container } = renderMarks(
      elevationPageMarks(scene(), bounds, xf, settings(), false)
    );

    const rects = ghostRects(container);
    // Cabinet + screen only.
    expect(rects).toHaveLength(2);
    const cabinet = rects[0]!;
    // SVG-y-down from the wall top: the cabinet's TOP is 3000 - 375 = 2625 down.
    expect(Number(cabinet.getAttribute("y"))).toBeCloseTo(2625 * xf.scalePtPerMm);
    expect(Number(cabinet.getAttribute("x"))).toBeCloseTo(2750 * xf.scalePtPerMm);
    expect(Number(cabinet.getAttribute("width"))).toBeCloseTo(500 * xf.scalePtPerMm);
  });

  it("lifts a RIDER cabinet to its base height — the pedestal's top face", () => {
    const { container } = renderMarks(
      elevationPageMarks(scene({ baseHeightMm: 800 }), bounds, xf, settings(), false)
    );

    const cabinet = ghostRects(container)[0]!;
    // 3000 - (800 + 375) = 1825 down from the wall top.
    expect(Number(cabinet.getAttribute("y"))).toBeCloseTo(1825 * xf.scalePtPerMm);
  });
});

// A shelf is the newest wall kind, so the drift the card exists to catch is the
// live one: the preview card and the PDF writer both read the SAME scene entry
// (ElevationScene.shelves / a PlanScene wall-object rect), and these assert the
// preview's marks against those numbers directly. The PDF twins
// (drawElevationShelf, drawPlanObject's shelf branch) consume the identical
// entries and the identical glyph module, so matching the entry here is what
// "PDF and SVG parity" means for this kind.
describe("ExportPdfPreview — shelf marks", () => {
  const bounds: DocumentBoundsMm = BOUNDS;
  const xf = planTransform(bounds, fitBoundsToRect(bounds, RECT));

  it("draws the plan slab as a FILLED polygon at the scene rect's footprint", () => {
    const shelfRect: PlanRect = {
      centerXMm: 2000,
      centerYMm: 1500,
      widthMm: 1200,
      depthMm: 300,
      angleDeg: 0
    };
    const { container } = renderMarks(
      planObjectMarks(shelfRect, "shelf", false, false, xf, "wobj-shelf")
    );

    const polygons = Array.from(container.querySelectorAll("polygon"));
    // The object's own footprint, then the slab mark on top of it.
    expect(polygons).toHaveLength(2);
    const slab = polygons[1]!;
    // Filled, not hollow: that is the whole of the shelf glyph.
    expect(slab.getAttribute("fill")).not.toBe("none");
    const xs = slab
      .getAttribute("points")!
      .split(" ")
      .map((pair) => Number(pair.split(",")[0]));
    const ys = slab
      .getAttribute("points")!
      .split(" ")
      .map((pair) => Number(pair.split(",")[1]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1200 * xf.scalePtPerMm);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(300 * xf.scalePtPerMm);
  });

  it("draws the elevation band from the scene entry's span and slab centre", () => {
    const scene: ElevationScene = {
      wallLengthMm: 4000,
      wallHeightMm: 3000,
      floorLineSvgY: 3000,
      centerlineSvgY: 1500,
      artworks: [],
      openings: [],
      wallTexts: [],
      cases: [],
      shelves: [
        {
          objectId: "wobj-shelf",
          xMinMm: 1000,
          xMaxMm: 2200,
          // Slab CENTRE at 1180 with a 40mm thickness — top face at 1200.
          yMm: 1180,
          heightMm: 40,
          depthMm: 300
        }
      ],
      floorCaseGhosts: [],
      suspendedArtworkGhosts: [],
      supportGhosts: [],
      monitorGhosts: [],
      partitionProfiles: []
    };

    const { container } = renderMarks(
      elevationPageMarks(scene, bounds, xf, settings(), false)
    );

    // The wall's own face rect is drawn first; the slab is the one carrying
    // the entry's span.
    const slab = Array.from(container.querySelectorAll("rect")).find(
      (rect) =>
        !rect.getAttribute("stroke-dasharray") &&
        Math.abs(Number(rect.getAttribute("width")) - 1200 * xf.scalePtPerMm) < 0.01
    );
    expect(slab).toBeTruthy();
    expect(Number(slab!.getAttribute("x"))).toBeCloseTo(1000 * xf.scalePtPerMm);
    expect(Number(slab!.getAttribute("width"))).toBeCloseTo(1200 * xf.scalePtPerMm);
    // SVG-y-down from the wall top: the slab's TOP face (1200) is 1800 down.
    expect(Number(slab!.getAttribute("y"))).toBeCloseTo(1800 * xf.scalePtPerMm);
    expect(Number(slab!.getAttribute("height"))).toBeCloseTo(40 * xf.scalePtPerMm);
    expect(slab!.getAttribute("fill")).not.toBe("none");
  });
});
