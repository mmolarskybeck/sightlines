import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRectangularRoomPlacement } from "../../domain/geometry/createRoom";
import { openWallInProject } from "../../domain/geometry/wallCascade";
import { CURRENT_SCHEMA_VERSION, type Project } from "../../domain/project";
import type { Selection } from "../store/selectionSlice";
import { NO_SELECTION } from "../store/selectionSlice";
import {
  useDeleteAndEscapeShortcuts,
  type UseDeleteAndEscapeShortcutsParams
} from "./useDeleteAndEscapeShortcuts";
import type { DialogName, DialogsHandle } from "./useDialogs";

afterEach(cleanup);

const WALL_NORTH = "room-a-wall-north";

function makeProject(): Project {
  return {
    id: "project",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Open walls",
    unit: "m",
    defaultWallHeightMm: 2500,
    defaultCenterlineHeightMm: 1450,
    floor: {
      rooms: [
        createRectangularRoomPlacement({
          roomId: "room-a",
          name: "Room A",
          widthMm: 4000,
          depthMm: 3000,
          heightMm: 2500,
          offsetXMm: 0,
          offsetYMm: 0
        })
      ]
    },
    checklistArtworkIds: [],
    wallObjects: [],
    floorObjects: [],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z"
  };
}

// A stand-in registry: only which dialogs are already open matters here, so the
// state is fixed per render and the mutators are spies.
function makeDialogs(openNames: DialogName[] = []) {
  const isOpen = (name: DialogName) => openNames.includes(name);
  return {
    isOpen,
    open: vi.fn(),
    close: vi.fn(),
    payload: () => null,
    setOpen: () => () => {},
    anyOpen: openNames.length > 0
  } satisfies DialogsHandle;
}

function renderHarness(
  overrides: Partial<UseDeleteAndEscapeShortcutsParams> & { openDialogs?: DialogName[] } = {}
) {
  cleanup();
  const { openDialogs, ...paramOverrides } = overrides;
  const dialogs = makeDialogs(openDialogs);
  const spies = {
    dialogs,
    deleteFreestandingWall: vi.fn().mockResolvedValue(undefined),
    deleteRoom: vi.fn().mockResolvedValue(undefined),
    removeSelectedPlacements: vi.fn().mockResolvedValue(undefined),
    clearObjectSelection: vi.fn(),
    cancelArrangeSession: vi.fn()
  };

  const params: UseDeleteAndEscapeShortcutsParams = {
    project: makeProject(),
    selection: NO_SELECTION,
    selectedObjectIds: [],
    selectedFreestandingWallId: null,
    reshapeRoomId: null,
    draggingArtworkId: null,
    arrangeSession: null,
    ...spies,
    ...paramOverrides
  };

  function Harness() {
    useDeleteAndEscapeShortcuts(params);
    return null;
  }
  render(<Harness />);
  return spies;
}

const pickWall = (wallId = WALL_NORTH): Selection => ({ kind: "wall", wallId });

describe("Delete on a wall", () => {
  it("confirms for a deliberately picked wall", () => {
    const spies = renderHarness({ selection: pickWall() });

    fireEvent.keyDown(window, { key: "Delete" });

    expect(spies.dialogs.open).toHaveBeenCalledWith("openWall", { wallId: WALL_NORTH });
  });

  // THE safety test. getSelectedWall falls back to walls[0], so the inspector
  // always displays a wall — on a fresh project, with nothing clicked. If this
  // ever regresses, Delete destroys a wall the user never chose. Do not delete
  // this test casually.
  it("does NOTHING for bare wall context, with no pick", () => {
    const spies = renderHarness({ selection: NO_SELECTION });

    fireEvent.keyDown(window, { key: "Delete" });

    expect(spies.dialogs.open).not.toHaveBeenCalled();
  });

  it("is inert on an already-open wall — Restore is a button, not a key", () => {
    const opened = openWallInProject(makeProject(), WALL_NORTH);
    if (opened.status !== "ready") throw new Error("fixture should open");
    const spies = renderHarness({ project: opened.project, selection: pickWall() });

    fireEvent.keyDown(window, { key: "Delete" });

    expect(spies.dialogs.open).not.toHaveBeenCalled();
  });

  it("is inert for a stale wall id", () => {
    const spies = renderHarness({ selection: pickWall("gone") });

    fireEvent.keyDown(window, { key: "Delete" });

    expect(spies.dialogs.open).not.toHaveBeenCalled();
  });

  it("lets a placed selection win — the objects branch comes first", () => {
    const spies = renderHarness({
      selection: pickWall(),
      selectedObjectIds: ["obj-1"]
    });

    fireEvent.keyDown(window, { key: "Delete" });

    expect(spies.removeSelectedPlacements).toHaveBeenCalledTimes(1);
    expect(spies.dialogs.open).not.toHaveBeenCalled();
  });

  it("stands down while edit-shape is armed — vertex removal owns the key", () => {
    const spies = renderHarness({ selection: pickWall(), reshapeRoomId: "room-a" });

    fireEvent.keyDown(window, { key: "Delete" });

    expect(spies.dialogs.open).not.toHaveBeenCalled();
  });

  it("stands down while either confirm dialog is open", () => {
    const withOwnDialog = renderHarness({
      selection: pickWall(),
      openDialogs: ["openWall"]
    });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(withOwnDialog.dialogs.open).not.toHaveBeenCalled();

    const withRoomDialog = renderHarness({
      selection: pickWall(),
      openDialogs: ["deleteRoom"]
    });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(withRoomDialog.dialogs.open).not.toHaveBeenCalled();
  });

  // Help owns the keyboard outright: Escape closes it and nothing else, and
  // Delete never reaches the branches below.
  it("stands down while Help is open, closing it on Escape", () => {
    const spies = renderHarness({ selection: pickWall(), openDialogs: ["help"] });

    fireEvent.keyDown(window, { key: "Delete" });
    expect(spies.dialogs.open).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(spies.dialogs.close).toHaveBeenCalledWith("help");
    expect(spies.clearObjectSelection).not.toHaveBeenCalled();
  });

  it("stands down for a focused editable target", () => {
    const spies = renderHarness({ selection: pickWall() });
    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: "Backspace" });

    expect(spies.dialogs.open).not.toHaveBeenCalled();
    input.remove();
  });

  it("Escape clears the pick instead of opening anything", () => {
    const spies = renderHarness({ selection: pickWall() });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(spies.clearObjectSelection).toHaveBeenCalledTimes(1);
    expect(spies.dialogs.open).not.toHaveBeenCalled();
  });
});
