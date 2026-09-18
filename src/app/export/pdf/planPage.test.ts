import { PDFDocument, type PDFPage } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import {
  planRectCorners,
  type DocumentBoundsMm
} from "../../../domain/export/pageComposition";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import type {
  ArtworkFloorObject,
  SupportFloorObject
} from "../../../domain/project";
import type { PlanScene, PlanSceneFloorObject } from "../../../domain/scene2d/planScene";
import { drawPlanScene } from "./planPage";
import { polygonPath } from "./transforms";

// A support's plan footprint reaches the printed page from its OWN scene entry
// (a `kind: "support"` PlanSceneFloorObject) and nothing else — the drawer must
// never reconstruct it from the placement of a work standing on it.

const BOUNDS: DocumentBoundsMm = {
  minXMm: 0,
  minYMm: 0,
  maxXMm: 4000,
  maxYMm: 3000,
  widthMm: 4000,
  heightMm: 3000
};
// A 1:1 page rect: fitBoundsToRect then hands back scalePtPerMm 1, so drawn
// points can be compared straight against mm.
const RECT = { xPt: 0, yPt: 0, widthPt: 4000, heightPt: 3000 };

const workRect: PlanRect = {
  centerXMm: 2000,
  centerYMm: 1500,
  widthMm: 400,
  depthMm: 400,
  angleDeg: 0
};

function floorEntry(): PlanSceneFloorObject {
  return {
    object: {
      id: "fobj-1",
      kind: "artwork",
      artworkId: "art-1",
      xMm: workRect.centerXMm,
      yMm: workRect.centerYMm,
      widthMm: workRect.widthMm,
      depthMm: workRect.depthMm,
      heightMm: 375,
      rotationDeg: 0
    } as ArtworkFloorObject,
    rect: workRect
  };
}

// A support is its OWN plan entry now (schema v8), and the plan scene emits it
// before the works standing on it.
function supportEntry(
  rect: PlanRect,
  hasBonnet: boolean
): PlanSceneFloorObject {
  return {
    object: {
      id: "support-1",
      kind: "support",
      supportKind: "plinth",
      xMm: rect.centerXMm,
      yMm: rect.centerYMm,
      widthMm: rect.widthMm,
      depthMm: rect.depthMm,
      rotationDeg: rect.angleDeg,
      heightMm: 1100,
      wallYMm: 0,
      ...(hasBonnet ? { bonnetHeightMm: 975 } : {})
    } as SupportFloorObject,
    rect,
    supportKind: "plinth",
    hasBonnet
  };
}

function sceneWith(support?: { rect: PlanRect; hasBonnet: boolean }): PlanScene {
  return {
    rooms: [],
    partitions: [],
    openingConnections: [],
    wallObjects: [],
    floorObjects: support
      ? [supportEntry(support.rect, support.hasBonnet), floorEntry()]
      : [floorEntry()]
  };
}

async function freshPage(): Promise<PDFPage> {
  const doc = await PDFDocument.create();
  return doc.addPage([4000, 3000]);
}

// The page-space path the identity-scaled transform produces for a given rect —
// derived through the same corner helper the drawer uses, so this pins WHICH
// rect was drawn without pinning the path-string format.
function expectedPath(rect: PlanRect): string {
  return polygonPath(
    planRectCorners(rect).map(({ xMm, yMm }) => ({
      x: xMm,
      y: BOUNDS.maxYMm - yMm
    }))
  );
}

describe("drawPlanScene — floor supports", () => {
  it("draws the support's own footprint from its scene entry, beneath the work", async () => {
    const page = await freshPage();
    const pathSpy = vi.spyOn(page, "drawSvgPath");
    // Deliberately NOT the work's footprint: a wider plinth is exactly what a
    // re-derived "same as the cabinet" rect would get wrong.
    const supportRect: PlanRect = { ...workRect, widthMm: 900, depthMm: 700 };

    drawPlanScene(
      page,
      sceneWith({ rect: supportRect, hasBonnet: false }),
      BOUNDS,
      RECT,
      "cm",
      false
    );

    const paths = pathSpy.mock.calls.map((call) => call[0]);
    const supportIndex = paths.indexOf(expectedPath(supportRect));
    const workIndex = paths.indexOf(expectedPath(workRect));
    expect(supportIndex).toBeGreaterThanOrEqual(0);
    expect(workIndex).toBeGreaterThanOrEqual(0);
    // Paint order: the work's outline overdraws the seam, print and screen
    // alike.
    expect(supportIndex).toBeLessThan(workIndex);

    // Lighter border than the object standing on it — the support carries the
    // thing being read, it isn't the thing being read.
    const supportOptions = pathSpy.mock.calls[supportIndex]![1]!;
    const workOptions = pathSpy.mock.calls[workIndex]![1]!;
    expect(supportOptions.borderWidth!).toBeLessThan(workOptions.borderWidth!);
  });

  it("adds a dashed bonnet at the SAME footprint, and only when there is one", async () => {
    const supportRect: PlanRect = { ...workRect, widthMm: 900, depthMm: 700 };

    const plainPage = await freshPage();
    const plainSpy = vi.spyOn(plainPage, "drawSvgPath");
    drawPlanScene(
      plainPage,
      sceneWith({ rect: supportRect, hasBonnet: false }),
      BOUNDS,
      RECT,
      "cm",
      false
    );
    const plainDashed = plainSpy.mock.calls.filter(
      (call) => call[1]?.borderDashArray && call[0] === expectedPath(supportRect)
    );
    expect(plainDashed).toHaveLength(0);

    const bonnetPage = await freshPage();
    const bonnetSpy = vi.spyOn(bonnetPage, "drawSvgPath");
    drawPlanScene(
      bonnetPage,
      sceneWith({ rect: supportRect, hasBonnet: true }),
      BOUNDS,
      RECT,
      "cm",
      false
    );
    const dashed = bonnetSpy.mock.calls.filter(
      (call) => call[1]?.borderDashArray && call[0] === expectedPath(supportRect)
    );
    // Bonnet footprint = support footprint (USER DECISION 2026-09-17), so it is
    // the same path — the dash is the whole of what distinguishes it.
    expect(dashed).toHaveLength(1);
  });

  it("draws nothing extra for a work standing on the bare floor", async () => {
    const page = await freshPage();
    const pathSpy = vi.spyOn(page, "drawSvgPath");

    drawPlanScene(page, sceneWith(), BOUNDS, RECT, "cm", false);

    // One footprint plus the generic artwork inset mark — exactly what an
    // unsupported floor artwork printed before supports existed.
    expect(pathSpy.mock.calls.filter((call) => call[0] === expectedPath(workRect))).toHaveLength(
      1
    );
  });
});
