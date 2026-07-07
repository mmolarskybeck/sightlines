import { describe, expect, it } from "vitest";
import { clamp } from "./scalar";

describe("clamp", () => {
  it("returns the value unchanged when it falls within the range", () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(0, 0, 100)).toBe(0);
    expect(clamp(100, 0, 100)).toBe(100);
  });

  it("returns the min boundary when the value is below range", () => {
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(-1000, -500, 500)).toBe(-500);
  });

  it("returns the max boundary when the value is above range", () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(1000, -500, 500)).toBe(500);
  });

  it("handles the case where min equals max", () => {
    expect(clamp(0, 50, 50)).toBe(50);
    expect(clamp(100, 50, 50)).toBe(50);
    expect(clamp(50, 50, 50)).toBe(50);
  });
});
