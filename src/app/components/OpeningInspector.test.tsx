import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OpeningWallObject } from "../../domain/project";
import { OpeningInspector, type OpeningConnectionCandidate } from "./OpeningInspector";

const door: OpeningWallObject = {
  id: "door-a",
  kind: "door",
  blocksPlacement: true,
  wallId: "wall-a",
  xMm: 1000,
  yMm: 1000,
  widthMm: 900,
  heightMm: 2000
};

const candidate: OpeningConnectionCandidate = {
  id: "door-b",
  label: "Gallery 2 — West wall",
  alignment: {
    status: "aligned",
    clearA: { xMinMm: 550, xMaxMm: 1450 },
    clearB: { xMinMm: 1550, xMaxMm: 2450 }
  }
};

function props(opening: OpeningWallObject = door) {
  return {
    opening,
    unit: "m" as const,
    connectionCandidates: [candidate],
    onCommitPosition: vi.fn(),
    onCommitSize: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onDelete: vi.fn()
  };
}

describe("OpeningInspector connections", () => {
  it("keeps the connection select controlled as an opening becomes paired", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rendered = render(<OpeningInspector {...props()} />);

    expect(screen.getByRole("combobox", { name: "Connect door to" })).toBeTruthy();

    rendered.rerender(
      <OpeningInspector
        {...props({ ...door, connectsToObjectId: "door-b" })}
      />
    );

    expect(screen.getByRole("status").textContent).toBe("Aligned");
    expect(
      consoleError.mock.calls.some((call) => String(call[0]).includes("uncontrolled"))
    ).toBe(false);
    consoleError.mockRestore();
  });
});
