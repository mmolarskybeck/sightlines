import { describe, expect, it } from "vitest";
import { getArtworkScaleState, isArtworkRecordComplete } from "./artworkScale";
import type { Dimensions } from "./project";

function dims(overrides: Partial<Dimensions>): Dimensions {
  return { status: "known", ...overrides };
}

describe("getArtworkScaleState", () => {
  it.each<[string, Partial<Dimensions>, ReturnType<typeof getArtworkScaleState>]>([
    ["width and height, known", { widthMm: 600, heightMm: 400, status: "known" }, "true"],
    ["width and height, approximate", { widthMm: 600, heightMm: 400, status: "approximate" }, "estimated"],
    ["width and height, unknown status", { widthMm: 600, heightMm: 400, status: "unknown" }, "estimated"],
    ["width only, known status", { widthMm: 600, heightMm: undefined, status: "known" }, "missing"],
    ["width only, approximate status", { widthMm: 600, heightMm: undefined, status: "approximate" }, "missing"],
    ["width only, unknown status", { widthMm: 600, heightMm: undefined, status: "unknown" }, "missing"],
    ["height only, known status", { widthMm: undefined, heightMm: 400, status: "known" }, "missing"],
    ["height only, approximate status", { widthMm: undefined, heightMm: 400, status: "approximate" }, "missing"],
    ["height only, unknown status", { widthMm: undefined, heightMm: 400, status: "unknown" }, "missing"],
    ["neither dimension, known status", { widthMm: undefined, heightMm: undefined, status: "known" }, "missing"],
    ["neither dimension, approximate status", { widthMm: undefined, heightMm: undefined, status: "approximate" }, "missing"],
    ["neither dimension, unknown status", { widthMm: undefined, heightMm: undefined, status: "unknown" }, "missing"]
  ])("%s -> %s", (_label, dimensionOverrides, expected) => {
    expect(getArtworkScaleState({ dimensions: dims(dimensionOverrides) })).toBe(expected);
  });

  it("ignores depthMm entirely — a real depth does not rescue a missing width", () => {
    const dimensions = dims({ widthMm: undefined, heightMm: 400, depthMm: 50, status: "known" });
    expect(getArtworkScaleState({ dimensions })).toBe("missing");
  });

  it("ignores depthMm entirely — a real depth does not demote a true scale", () => {
    const dimensions = dims({ widthMm: 600, heightMm: 400, depthMm: 50, status: "known" });
    expect(getArtworkScaleState({ dimensions })).toBe("true");
  });
});

describe("isArtworkRecordComplete", () => {
  const knownDims = dims({ widthMm: 600, heightMm: 400, status: "known" });
  const estimatedDims = dims({ widthMm: 600, heightMm: 400, status: "approximate" });
  const missingDims = dims({ widthMm: undefined, heightMm: 400, status: "known" });

  it.each<[string, string | undefined, Dimensions, boolean]>([
    ["title present, scale true", "Untitled No. 4", knownDims, true],
    ["title present, scale estimated", "Untitled No. 4", estimatedDims, true],
    ["title present, scale missing", "Untitled No. 4", missingDims, false],
    ["title absent, scale true", undefined, knownDims, false],
    ["title absent, scale estimated", undefined, estimatedDims, false],
    ["title absent, scale missing", undefined, missingDims, false],
    ["whitespace-only title, scale true", "   ", knownDims, false],
    ["whitespace-only title, scale estimated", "   ", estimatedDims, false],
    ["whitespace-only title, scale missing", "   ", missingDims, false]
  ])("%s -> %s", (_label, title, dimensions, expected) => {
    expect(isArtworkRecordComplete({ title, dimensions })).toBe(expected);
  });
});
