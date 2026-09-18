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

  it("draws the support polygon beneath the work, at the scene's own footprint", () => {
    // Deliberately wider than the work: this is what a re-derived
    // "same as the placement" footprint would get wrong.
    const supportRect: PlanRect = { ...workRect, widthMm: 900, depthMm: 700 };
    const { container } = renderMarks(
      planObjectMarks(workRect, "artwork", true, false, xf, "fobj-0", undefined, {
        rect: supportRect,
        hasBonnet: false
      })
    );

    const polygons = Array.from(container.querySelectorAll("polygon"));
    // Support first, then the work's own footprint — the canvas's and the PDF
    // writer's paint order.
    expect(polygons.length).toBeGreaterThanOrEqual(2);
    const supportSpanPt =
      900 * xf.scalePtPerMm;
    const firstXs = polygons[0]!
      .getAttribute("points")!
      .split(" ")
      .map((pair) => Number(pair.split(",")[0]));
    expect(Math.max(...firstXs) - Math.min(...firstXs)).toBeCloseTo(supportSpanPt);
    const secondXs = polygons[1]!
      .getAttribute("points")!
      .split(" ")
      .map((pair) => Number(pair.split(",")[0]));
    expect(Math.max(...secondXs) - Math.min(...secondXs)).toBeCloseTo(
      workRect.widthMm * xf.scalePtPerMm
    );
  });

  it("adds a dashed bonnet polygon at the same footprint, and only with a bonnet", () => {
    const supportRect: PlanRect = { ...workRect, widthMm: 900, depthMm: 700 };
    // A FLOOR placement's own outline is already dashed, so the bonnet has to
    // be identified by its footprint (the support's, 900 wide) rather than by
    // counting dashed polygons.
    const dashedWidthsPt = (container: Element) =>
      Array.from(container.querySelectorAll("polygon[stroke-dasharray]")).map(
        (polygon) => {
          const xs = polygon
            .getAttribute("points")!
            .split(" ")
            .map((pair) => Number(pair.split(",")[0]));
          return Math.max(...xs) - Math.min(...xs);
        }
      );

    const { container: plain } = renderMarks(
      planObjectMarks(workRect, "artwork", true, false, xf, "fobj-0", undefined, {
        rect: supportRect,
        hasBonnet: false
      })
    );
    expect(dashedWidthsPt(plain)).not.toContain(900 * xf.scalePtPerMm);

    const { container: bonneted } = renderMarks(
      planObjectMarks(workRect, "artwork", true, false, xf, "fobj-0", undefined, {
        rect: supportRect,
        hasBonnet: true
      })
    );
    // Bonnet footprint = support footprint (USER DECISION 2026-09-17).
    expect(dashedWidthsPt(bonneted)).toContain(900 * xf.scalePtPerMm);
  });

  it("draws no support marks for a work standing on the bare floor", () => {
    const { container } = renderMarks(
      planObjectMarks(workRect, "artwork", true, false, xf, "fobj-0")
    );
    // The footprint plus the generic artwork inset — what it drew before
    // supports existed.
    expect(container.querySelectorAll("polygon")).toHaveLength(2);
  });
});

describe("ExportPdfPreview — elevation supported-artwork ghost marks", () => {
  function scene(
    ghost: Partial<ElevationScene["supportedArtworkGhosts"][number]> = {}
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
      floorCaseGhosts: [],
      suspendedArtworkGhosts: [],
      supportedArtworkGhosts: [
        {
          kind: "supported-artwork",
          objectId: "fobj-1",
          xMinMm: 1000,
          xMaxMm: 1600,
          supportHeightMm: 1100,
          workHeightMm: 400,
          workXMinMm: 1100,
          workXMaxMm: 1500,
          supportXMinMm: 1000,
          supportXMaxMm: 1600,
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

  it("draws the support on the floor line and the work on top, each on its own span", () => {
    const { container } = renderMarks(
      elevationPageMarks(scene(), bounds, xf, settings(), false)
    );

    const rects = ghostRects(container);
    expect(rects).toHaveLength(2);
    const [support, work] = rects;
    // This surface is SVG-y-down from the wall top: the support's TOP is
    // 3000 - 1100 = 1900 down, the work's is 3000 - 1500 = 1500 down.
    expect(Number(support!.getAttribute("y"))).toBeCloseTo(1900 * xf.scalePtPerMm);
    expect(Number(support!.getAttribute("height"))).toBeCloseTo(1100 * xf.scalePtPerMm);
    expect(Number(support!.getAttribute("x"))).toBeCloseTo(1000 * xf.scalePtPerMm);
    expect(Number(support!.getAttribute("width"))).toBeCloseTo(600 * xf.scalePtPerMm);

    expect(Number(work!.getAttribute("y"))).toBeCloseTo(1500 * xf.scalePtPerMm);
    expect(Number(work!.getAttribute("height"))).toBeCloseTo(400 * xf.scalePtPerMm);
    // The work's own narrower span, not the assembly's.
    expect(Number(work!.getAttribute("x"))).toBeCloseTo(1100 * xf.scalePtPerMm);
    expect(Number(work!.getAttribute("width"))).toBeCloseTo(400 * xf.scalePtPerMm);
  });

  it("adds the bonnet from the support's top at the support's footprint", () => {
    const { container } = renderMarks(
      elevationPageMarks(scene({ bonnetHeightMm: 475 }), bounds, xf, settings(), false)
    );

    const rects = ghostRects(container);
    expect(rects).toHaveLength(3);
    const bonnet = rects[2]!;
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
      floorCaseGhosts: [],
      suspendedArtworkGhosts: [],
      supportedArtworkGhosts: [],
      monitorGhosts: [
        {
          object: { id: "floor-monitor" } as ElevationScene["monitorGhosts"][number]["object"],
          // A 500mm cabinet on its own 800mm default pedestal: the legacy
          // shape, where the plinth's span and the cabinet's coincide.
          xMinMm: 2750,
          xMaxMm: 3250,
          monitorHeightMm: 375,
          pedestalHeightMm: 800,
          supportXMinMm: 2750,
          supportXMaxMm: 3250,
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

  it("LEGACY: plinth, cabinet and screen at the cabinet's own span, no bonnet", () => {
    const { container } = renderMarks(
      elevationPageMarks(scene(), bounds, xf, settings(), false)
    );

    const rects = ghostRects(container);
    expect(rects).toHaveLength(3);
    const [pedestal, cabinet] = rects;
    // SVG-y-down from the wall top: the plinth's TOP is 3000 - 800 = 2200 down.
    expect(Number(pedestal!.getAttribute("y"))).toBeCloseTo(2200 * xf.scalePtPerMm);
    expect(Number(pedestal!.getAttribute("x"))).toBeCloseTo(2750 * xf.scalePtPerMm);
    expect(Number(pedestal!.getAttribute("width"))).toBeCloseTo(500 * xf.scalePtPerMm);
    expect(Number(cabinet!.getAttribute("y"))).toBeCloseTo(1825 * xf.scalePtPerMm);
  });

  it("draws an EXPLICIT plinth and its bonnet across the SUPPORT's span", () => {
    const { container } = renderMarks(
      elevationPageMarks(
        scene({
          pedestalHeightMm: 150,
          supportXMinMm: 2650,
          supportXMaxMm: 3550,
          bonnetHeightMm: 450
        }),
        bounds,
        xf,
        settings(),
        false
      )
    );

    const rects = ghostRects(container);
    // Plinth, cabinet, screen, bonnet.
    expect(rects).toHaveLength(4);
    const pedestal = rects[0]!;
    expect(Number(pedestal.getAttribute("x"))).toBeCloseTo(2650 * xf.scalePtPerMm);
    expect(Number(pedestal.getAttribute("width"))).toBeCloseTo(900 * xf.scalePtPerMm);
    // The cabinet keeps its own, narrower span.
    expect(Number(rects[1]!.getAttribute("x"))).toBeCloseTo(2750 * xf.scalePtPerMm);
    expect(Number(rects[1]!.getAttribute("width"))).toBeCloseTo(500 * xf.scalePtPerMm);

    const bonnet = rects[3]!;
    // 3000 - (150 + 450) = 2400 down from the wall top.
    expect(Number(bonnet.getAttribute("y"))).toBeCloseTo(2400 * xf.scalePtPerMm);
    expect(Number(bonnet.getAttribute("height"))).toBeCloseTo(450 * xf.scalePtPerMm);
    // Bonnet footprint = support footprint (USER DECISION 2026-09-17).
    expect(Number(bonnet.getAttribute("x"))).toBeCloseTo(2650 * xf.scalePtPerMm);
    expect(Number(bonnet.getAttribute("width"))).toBeCloseTo(900 * xf.scalePtPerMm);
  });
});
