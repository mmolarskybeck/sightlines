import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import type { SavedView } from "../../../domain/project";
import {
  SavedViewRenderHost,
  type SavedViewRenderHandle
} from "./SavedViewRenderHost";

const { snapshotRequests } = vi.hoisted(() => ({
  snapshotRequests: [] as Array<{ tier?: string }>
}));

vi.mock("./SnapshotStage", () => ({
  SnapshotStage: ({
    request,
    onSettled
  }: {
    request: null | {
      tier?: string;
      resolve: (blob: Blob) => void;
    };
    onSettled: () => void;
  }) => {
    useEffect(() => {
      if (!request) return;
      snapshotRequests.push(request);
      request.resolve(new Blob(["snapshot"], { type: "image/png" }));
      onSettled();
    }, [request, onSettled]);
    return null;
  }
}));

// SnapshotStage is mocked so queue plumbing can be tested in jsdom without
// standing up react-three-fiber/WebGL. Actual context reuse remains a
// browser-level check.

afterEach(() => {
  cleanup();
  snapshotRequests.length = 0;
});

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
    expect(typeof actionsRef.current!.beginRenderBatch).toBe("function");
  });

  it("returns an idempotent release from beginRenderBatch", () => {
    // The real payoff of the batch hold (stage stays mounted across the queue's
    // empty gaps) needs a live WebGL context, so it's a driver-level check. Here
    // we cover the jsdom-testable half of the state machine: acquiring a hold
    // hands back a release, and the exporter's finally can call it more than
    // once (abort races, double-cleanup) without throwing or over-releasing.
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
    const release = actionsRef.current!.beginRenderBatch();
    expect(typeof release).toBe("function");
    expect(() => {
      release();
      release();
    }).not.toThrow();
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

  it("routes an explicit asset tier through the render queue", async () => {
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

    await actionsRef.current!.renderSavedView(
      {
        ...degenerateView(),
        pose: {
          position: { x: 0, y: 1.6, z: 5 },
          target: { x: 0, y: 1.6, z: 0 }
        }
      },
      { widthPx: 296, heightPx: 184 },
      { tier: "thumbnail" }
    );

    expect(snapshotRequests).toHaveLength(1);
    expect(snapshotRequests[0]?.tier).toBe("thumbnail");
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
