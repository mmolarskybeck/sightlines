import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, WallObject } from "../../domain/project";
import { createSampleProject } from "../../domain/sample/sampleProject";
import type { ArrangeSession } from "../store";
import { useArrangeNudgeShortcuts } from "./useArrangeNudgeShortcuts";

const artworkPlacement: WallObject = {
  id: "placement-art-1",
  kind: "artwork",
  artworkId: "art-1",
  wallId: "wall-north",
  xMm: 100,
  yMm: 200,
  widthMm: 300,
  heightMm: 400
};

const doorPlacement: WallObject = {
  id: "placement-door-1",
  kind: "door",
  blocksPlacement: true,
  wallId: "wall-north",
  xMm: 600,
  yMm: 1200,
  widthMm: 900,
  heightMm: 2100
};

function projectWith(wallObjects: WallObject[]): Project {
  return { ...createSampleProject(), wallObjects };
}

function renderNudgeHarness({
  project = projectWith([artworkPlacement]),
  selectedObjectIds = [artworkPlacement.id],
  moveArtworkPlacement = vi.fn(async () => {}),
  arrangeSession = null,
  commitArrangeSession = vi.fn()
}: {
  project?: Project;
  selectedObjectIds?: string[];
  moveArtworkPlacement?: (wallObjectId: string, xMm: number, yMm: number, allowOverlap?: boolean) => Promise<void>;
  arrangeSession?: ArrangeSession | null;
  commitArrangeSession?: (allowOverlap?: boolean) => void;
} = {}) {
  const targetKeyDown = vi.fn((event: KeyboardEvent) => event.stopPropagation());

  function Harness() {
    useArrangeNudgeShortcuts({
      project,
      viewMode: "elevation",
      selectedObjectIds,
      draggingArtworkId: null,
      arrangeSession,
      allowOverlappingPlacement: false,
      snapToGrid: false,
      gridPrecisionFloorMm: null,
      beginArrangeSession: vi.fn(),
      setArrangeSessionPreview: vi.fn(),
      commitArrangeSession,
      moveArtworkPlacement,
      moveOpening: vi.fn(async () => {})
    });

    return (
      <>
        <button
          type="button"
          data-testid="topbar-button"
          onKeyDown={(event) => targetKeyDown(event.nativeEvent)}
        >
          Topbar button
        </button>
        <div
          role="separator"
          tabIndex={0}
          data-testid="splitter"
          onKeyDown={(event) => targetKeyDown(event.nativeEvent)}
        />
        <div data-owns-arrow-keys>
          <button
            type="button"
            data-testid="arrow-key-owner"
            onKeyDown={(event) => targetKeyDown(event.nativeEvent)}
          >
            Wall switcher
          </button>
        </div>
      </>
    );
  }

  return {
    moveArtworkPlacement,
    commitArrangeSession,
    targetKeyDown,
    ...render(<Harness />)
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useArrangeNudgeShortcuts focus handling", () => {
  it("nudges before a focused topbar control can trap arrow-key propagation", () => {
    const { getByTestId, moveArtworkPlacement, targetKeyDown } = renderNudgeHarness();
    const button = getByTestId("topbar-button");
    button.focus();

    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true
    });
    act(() => {
      button.dispatchEvent(event);
    });

    expect(moveArtworkPlacement).toHaveBeenCalledWith(
      artworkPlacement.id,
      artworkPlacement.xMm + 12.7,
      artworkPlacement.yMm,
      false
    );
    expect(event.defaultPrevented).toBe(true);
    expect(targetKeyDown).not.toHaveBeenCalled();
  });

  it("leaves arrow keys alone when a focused splitter owns them", () => {
    const { getByTestId, moveArtworkPlacement, targetKeyDown } = renderNudgeHarness();
    const splitter = getByTestId("splitter");
    splitter.focus();

    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true
    });
    act(() => {
      splitter.dispatchEvent(event);
    });

    expect(moveArtworkPlacement).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(targetKeyDown).toHaveBeenCalled();
  });

  it.each(["ArrowLeft", "ArrowRight"])(
    "leaves %s to a focused widget that declares arrow-key ownership",
    (key) => {
      const { getByTestId, moveArtworkPlacement, targetKeyDown } = renderNudgeHarness();
      const owner = getByTestId("arrow-key-owner");
      owner.focus();

      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true
      });
      act(() => {
        owner.dispatchEvent(event);
      });

      expect(moveArtworkPlacement).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(targetKeyDown).toHaveBeenCalled();
    }
  );

  it("leaves Enter to a focused widget that declares arrow-key ownership", () => {
    const arrangeSession: ArrangeSession = {
      wallId: "wall-north",
      memberIds: [artworkPlacement.id],
      originalById: {
        [artworkPlacement.id]: { xMm: artworkPlacement.xMm, yMm: artworkPlacement.yMm }
      },
      previewById: {
        [artworkPlacement.id]: { xMm: artworkPlacement.xMm, yMm: artworkPlacement.yMm }
      },
      mode: "inset",
      insetAnchor: "both",
      insetBoundary: {
        left: { type: "wall", edgeMm: 0 },
        right: { type: "wall", edgeMm: 3000 }
      },
      evenZone: "wall",
      openZoneBoundsMm: { startMm: 0, endMm: 3000 }
    };
    const { getByTestId, commitArrangeSession, targetKeyDown } = renderNudgeHarness({
      arrangeSession
    });
    const owner = getByTestId("arrow-key-owner");
    owner.focus();

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true
    });
    act(() => {
      owner.dispatchEvent(event);
    });

    expect(commitArrangeSession).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(targetKeyDown).toHaveBeenCalled();
  });

  it("does not claim arrows when the selection has no nudge action", () => {
    const { getByTestId, moveArtworkPlacement, targetKeyDown } = renderNudgeHarness({
      project: projectWith([artworkPlacement, doorPlacement]),
      selectedObjectIds: [artworkPlacement.id, doorPlacement.id]
    });
    const button = getByTestId("topbar-button");

    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true
    });
    act(() => {
      button.dispatchEvent(event);
    });

    expect(moveArtworkPlacement).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(targetKeyDown).toHaveBeenCalled();
  });
});
