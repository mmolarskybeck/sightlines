// Covers the checklist DROP path in plan view. Both directions used to be
// impossible and unexplained: a depth-bearing ("floor" form) work could not be
// dropped on a wall, and a flat ("wall" form) work dropped on open floor painted
// a red ghost and committed nothing. The USER DECISION is that intent wins —
// where the work is released is what it becomes — so the two things worth
// pinning are the COMMIT branch (which store action fires) and the GHOST
// GEOMETRY, which must follow the resolved anchor rather than the library form:
// a deep work previews its real protrusion once a wall captures it, and a framed
// wall work previews its image width and floor footprint once it stands on open
// floor.
import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { getFloorWalls } from "../../domain/geometry/planObjects";
import type { Artwork } from "../../domain/project";
import { createSampleProject } from "../../domain/sample/sampleProject";
import { ARTWORK_DRAG_MIME } from "../components/library/artworkDragSession";
import { usePlanArtworkDrop } from "./usePlanArtworkDrop";

// Depth-bearing, no explicit placementForm → effectivePlacementForm derives
// "floor" from the depth alone. This is the record the old floor-only policy
// stopped from ever reaching a wall.
const DEEP_FLOOR_WORK: Artwork = {
  id: "art-deep",
  schemaVersion: 1,
  title: "Relief",
  dimensions: { widthMm: 600, heightMm: 900, depthMm: 400, status: "known" },
  metadata: {}
};

// Flat and framed → "wall" form, and a 50mm frame on each edge, so its outer
// width (700) is distinguishable from its image width (600).
const FLAT_WALL_WORK: Artwork = {
  id: "art-flat",
  schemaVersion: 1,
  title: "Drawing",
  dimensions: { widthMm: 600, heightMm: 900, status: "known" },
  frame: { widthMm: 50, finish: "black" },
  metadata: {}
};

const project = createSampleProject();
const walls = getFloorWalls(project.floor);
// The sample room's north wall runs along y = 0 from x = 0.
const NORTH_WALL = walls.find((wall) => wall.id === "wall-north")!;
// Just off the north wall (inside the capture radius below) and, for the floor
// case, the middle of the room — metres from every wall.
const NEAR_WALL_MM = { xMm: 4000, yMm: 10 };
const OPEN_FLOOR_MM = { xMm: 4000, yMm: 2500 };

function setup(artwork: Artwork) {
  const onPlaceArtwork = vi.fn();
  const onPlaceArtworkOnFloor = vi.fn();
  const hook = renderHook(() =>
    usePlanArtworkDrop({
      artworksById: new Map([[artwork.id, artwork]]),
      draggingArtworkId: artwork.id,
      containerRef: createRef<HTMLDivElement>(),
      // The pointer coordinates ARE floor mm in this harness — the client→SVG
      // conversion is PlanView's, not this hook's.
      toSvgMm: (clientX, clientY) => ({ xMm: clientX, yMm: clientY }),
      project,
      floorWallsForTool: walls,
      snappingWallObjects: [],
      floorObjectRoomIds: new Map(),
      captureDistanceMm: 50,
      gridSnapTargets: [],
      snapToGrid: false,
      snapThresholdMm: 20,
      onPlaceArtwork,
      onPlaceArtworkOnFloor
    })
  );
  return { hook, onPlaceArtwork, onPlaceArtworkOnFloor };
}

// A minimal drag event: jsdom has no DataTransfer, and the handlers only read
// `types` / `getData` and write `dropEffect`.
function dragEvent(artworkId: string, pointMm: { xMm: number; yMm: number }) {
  return {
    clientX: pointMm.xMm,
    clientY: pointMm.yMm,
    metaKey: false,
    ctrlKey: false,
    preventDefault: () => {},
    currentTarget: { contains: () => false },
    relatedTarget: null,
    dataTransfer: {
      types: [ARTWORK_DRAG_MIME],
      dropEffect: "",
      getData: (type: string) => (type === ARTWORK_DRAG_MIME ? artworkId : "")
    }
  } as unknown as Parameters<
    ReturnType<typeof usePlanArtworkDrop>["handleArtworkDragOver"]
  >[0];
}

describe("plan checklist drop — the drop point decides the surface", () => {
  it("hangs a deep FLOOR-form work dropped at a wall, previewing its real protrusion", () => {
    const { hook, onPlaceArtwork, onPlaceArtworkOnFloor } = setup(DEEP_FLOOR_WORK);

    act(() => {
      hook.result.current.handleArtworkDragOver(dragEvent(DEEP_FLOOR_WORK.id, NEAR_WALL_MM));
    });

    const ghost = hook.result.current.dropGhost!;
    expect(ghost.placement).toMatchObject({ anchor: "wall", wallId: NORTH_WALL.id });
    // The ghost follows the RESOLVED anchor: a deep work hanging protrudes its
    // own 400mm, not the thin nominal band a flat work keeps.
    expect(ghost.planRect.depthMm).toBe(400);

    act(() => {
      hook.result.current.handleArtworkDrop(dragEvent(DEEP_FLOOR_WORK.id, NEAR_WALL_MM));
    });

    expect(onPlaceArtworkOnFloor).not.toHaveBeenCalled();
    expect(onPlaceArtwork).toHaveBeenCalledTimes(1);
    const [artworkId, wallId, xMm, yMm] = onPlaceArtwork.mock.calls[0]!;
    expect(artworkId).toBe(DEEP_FLOOR_WORK.id);
    expect(wallId).toBe(NORTH_WALL.id);
    expect(xMm).toBeCloseTo(4000, 3);
    // Plan view chooses no height of its own: the wall's centerline.
    expect(yMm).toBe(project.defaultCenterlineHeightMm);
  });

  it("stands a framed WALL-form work dropped on open floor, previewing its floor footprint", () => {
    const { hook, onPlaceArtwork, onPlaceArtworkOnFloor } = setup(FLAT_WALL_WORK);

    act(() => {
      hook.result.current.handleArtworkDragOver(dragEvent(FLAT_WALL_WORK.id, OPEN_FLOOR_MM));
    });

    const ghost = hook.result.current.dropGhost!;
    // No red danger ghost any more — it resolves a real floor center.
    expect(ghost.placement).toEqual({ anchor: "floor", xMm: 4000, yMm: 2500 });
    // Floor geometry is framing-agnostic (Phase 6b): the image width, not the
    // 700mm outer width the wall stage would have used, and the floor-depth
    // fallback (depth → width) for the depth axis.
    expect(ghost.planRect.widthMm).toBe(600);
    expect(ghost.planRect.depthMm).toBe(600);

    act(() => {
      hook.result.current.handleArtworkDrop(dragEvent(FLAT_WALL_WORK.id, OPEN_FLOOR_MM));
    });

    expect(onPlaceArtwork).not.toHaveBeenCalled();
    expect(onPlaceArtworkOnFloor).toHaveBeenCalledWith(FLAT_WALL_WORK.id, 4000, 2500);
  });

  it("still widens a framed wall work to its outer width once a wall captures it", () => {
    const { hook } = setup(FLAT_WALL_WORK);

    act(() => {
      hook.result.current.handleArtworkDragOver(dragEvent(FLAT_WALL_WORK.id, NEAR_WALL_MM));
    });

    const ghost = hook.result.current.dropGhost!;
    expect(ghost.placement).toMatchObject({ anchor: "wall" });
    expect(ghost.planRect.widthMm).toBe(700);
  });
});
