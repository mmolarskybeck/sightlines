import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import type { SavedView } from "../../../domain/project";
import {
  SavedViewRenderHost,
  type SavedViewRenderHandle
} from "./SavedViewRenderHost";

// These paths never mount the offscreen Canvas: with no valid request enqueued
// the host renders null, so they run cleanly in jsdom. A valid-pose render
// (which spins up react-three-fiber/WebGL) is left to the driver-level check.

afterEach(cleanup);

function degenerateView(): SavedView {
  return {
    id: "v1",
    ordinal: 1,
    title: "Degenerate",
    roomId: "r1",
    // Camera and target coincide — numerically invalid (§8.4).
    pose: {
      position: { x: 1, y: 1, z: 1 },
      target: { x: 1, y: 1, z: 1 }
    },
    createdAt: "2026-07-16T00:00:00.000Z"
  };
}

describe("SavedViewRenderHost", () => {
  it("exposes a render handle through the actions ref", () => {
    const actionsRef: { current: SavedViewRenderHandle | null } = {
      current: null
    };
    render(
      <SavedViewRenderHost
        project={createSampleProject()}
        artworksById={new Map()}
        getBlob={async () => new Blob()}
        actionsRef={actionsRef}
      />
    );
    expect(actionsRef.current).not.toBeNull();
    expect(typeof actionsRef.current!.renderSavedView).toBe("function");
  });

  it("rejects a numerically invalid pose without rendering", async () => {
    const actionsRef: { current: SavedViewRenderHandle | null } = {
      current: null
    };
    render(
      <SavedViewRenderHost
        project={createSampleProject()}
        artworksById={new Map()}
        getBlob={async () => new Blob()}
        actionsRef={actionsRef}
      />
    );
    await expect(
      actionsRef.current!.renderSavedView(degenerateView(), {
        widthPx: 100,
        heightPx: 100
      })
    ).rejects.toThrow(/invalid camera pose/);
  });

  it("rejects pending requests once unmounted", async () => {
    const actionsRef: { current: SavedViewRenderHandle | null } = {
      current: null
    };
    const view = actionsRef;
    const { unmount } = render(
      <SavedViewRenderHost
        project={createSampleProject()}
        artworksById={new Map()}
        getBlob={async () => new Blob()}
        actionsRef={view}
      />
    );
    const handle = actionsRef.current!;
    unmount();
    await expect(
      handle.renderSavedView(
        { ...degenerateView(), id: "v2" },
        { widthPx: 10, heightPx: 10 }
      )
    ).rejects.toThrow(/not available/);
  });
});
