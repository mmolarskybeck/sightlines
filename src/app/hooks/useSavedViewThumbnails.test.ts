import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../domain/sample/sampleProject";
import type { Project, SavedView } from "../../domain/project";
import type {
  SavedViewThumbnailRecord,
  SavedViewThumbnailRepository
} from "../../domain/repositories/savedViewThumbnailRepository";
import type { SavedViewRenderHandle } from "../components/three/SavedViewRenderHost";
import {
  SAVED_VIEW_THUMBNAIL_SIZE,
  useSavedViewThumbnails
} from "./useSavedViewThumbnails";

// jsdom has no Blob URL registry, so stub both halves and assert against the
// stub (same approach as useAssetImageUrls.test.ts).
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let nextUrlId: number;

beforeEach(() => {
  nextUrlId = 0;
  createObjectURL = vi.fn(() => `blob:mock-${nextUrlId++}`);
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
    writable: true
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
    writable: true
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function validView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    id: "v1",
    ordinal: 1,
    title: "Saved view 1",
    roomId: undefined,
    pose: {
      position: { x: 0, y: 1.6, z: 5 },
      target: { x: 0, y: 1.6, z: 0 }
    },
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides
  };
}

function projectWith(savedViews: SavedView[], updatedAt: string): Project {
  return { ...createSampleProject(), savedViews, updatedAt };
}

function fakeRepository(seed: Record<string, SavedViewThumbnailRecord> = {}) {
  const store = new Map<string, SavedViewThumbnailRecord>(
    Object.entries(seed)
  );
  const repository: SavedViewThumbnailRepository = {
    get: vi.fn(async (projectId, viewId) => store.get(`${projectId}:${viewId}`)),
    put: vi.fn(async (projectId, viewId, record) => {
      store.set(`${projectId}:${viewId}`, record);
    }),
    deleteByView: vi.fn(async (projectId, viewId) => {
      store.delete(`${projectId}:${viewId}`);
    }),
    deleteByProject: vi.fn(async (projectId) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(`${projectId}:`)) store.delete(key);
      }
    })
  };
  return { repository, store };
}

function handleReturning(blob = new Blob(["png"], { type: "image/png" })) {
  return {
    renderSavedView: vi.fn(async () => blob)
  } satisfies SavedViewRenderHandle;
}

describe("useSavedViewThumbnails", () => {
  it("displays a cached thumbnail on mount without rendering", async () => {
    const view = validView();
    const project = projectWith([view], "2026-07-16T00:00:00.000Z");
    const { repository } = fakeRepository({
      [`${project.id}:v1`]: {
        blob: new Blob(["cached"]),
        projectUpdatedAt: project.updatedAt
      }
    });
    const handle = handleReturning();

    const { result } = renderHook(() =>
      useSavedViewThumbnails({
        project,
        renderHandle: handle,
        active: false,
        repository
      })
    );

    await waitFor(() => expect(result.current.urls.v1).toBeDefined());
    // Fresh cache + no consumer visible: nothing renders.
    expect(handle.renderSavedView).not.toHaveBeenCalled();
    expect(result.current.hasPendingWork).toBe(false);
  });

  it("seeds a just-saved view's first render immediately, ignoring the consumer gate", async () => {
    const project = projectWith([], "2026-07-16T00:00:00.000Z");
    const { repository, store } = fakeRepository();
    const handle = handleReturning();

    const { result, rerender } = renderHook(
      ({ p }: { p: Project }) =>
        useSavedViewThumbnails({
          project: p,
          renderHandle: handle,
          active: false,
          repository
        }),
      { initialProps: { p: project } }
    );

    const view = validView();
    // The store adds it to savedViews; App calls seed with the returned view.
    const withView = projectWith([view], "2026-07-16T00:01:00.000Z");
    rerender({ p: withView });
    act(() => result.current.seed(view));

    await waitFor(() => expect(result.current.urls.v1).toBeDefined());
    expect(handle.renderSavedView).toHaveBeenCalledWith(
      view,
      SAVED_VIEW_THUMBNAIL_SIZE
    );
    // Persisted with the current project stamp.
    expect(store.get(`${withView.id}:v1`)?.projectUpdatedAt).toBe(
      withView.updatedAt
    );
    await waitFor(() => expect(result.current.hasPendingWork).toBe(false));
  });

  it("never renders a degenerate pose", async () => {
    const project = projectWith([], "t0");
    const { repository } = fakeRepository();
    const handle = handleReturning();

    const { result } = renderHook(() =>
      useSavedViewThumbnails({
        project,
        renderHandle: handle,
        active: true,
        repository
      })
    );

    const degenerate = validView({
      id: "vd",
      pose: {
        position: { x: 1, y: 1, z: 1 },
        target: { x: 1, y: 1, z: 1 }
      }
    });
    act(() => result.current.seed(degenerate));

    // Give the loop a chance to (not) run.
    await act(async () => {
      await Promise.resolve();
    });
    expect(handle.renderSavedView).not.toHaveBeenCalled();
    expect(result.current.urls.vd).toBeUndefined();
  });

  it("fails open: a render error keeps the placeholder and logs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = validView();
    const project = projectWith([view], "t0");
    const { repository, store } = fakeRepository();
    const handle: SavedViewRenderHandle = {
      renderSavedView: vi.fn(async () => {
        throw new Error("webgl unavailable");
      })
    };

    const { result } = renderHook(() =>
      useSavedViewThumbnails({
        project,
        renderHandle: handle,
        active: false,
        repository
      })
    );

    act(() => result.current.seed(view));

    await waitFor(() => expect(handle.renderSavedView).toHaveBeenCalled());
    await waitFor(() => expect(result.current.hasPendingWork).toBe(false));
    expect(result.current.urls.v1).toBeUndefined();
    expect(store.size).toBe(0);
    expect(consoleError).toHaveBeenCalled();
  });

  it("deletes a view's cache entry and revokes its URL when the view is removed", async () => {
    const view = validView();
    const project = projectWith([view], "t0");
    const { repository } = fakeRepository({
      [`${project.id}:v1`]: {
        blob: new Blob(["cached"]),
        projectUpdatedAt: "t0"
      }
    });
    const handle = handleReturning();

    const { result, rerender } = renderHook(
      ({ p }: { p: Project }) =>
        useSavedViewThumbnails({
          project: p,
          renderHandle: handle,
          active: false,
          repository
        }),
      { initialProps: { p: project } }
    );

    await waitFor(() => expect(result.current.urls.v1).toBeDefined());
    const url = result.current.urls.v1;

    // Delete the view (as applyEdit would: it leaves savedViews).
    rerender({ p: projectWith([], "t1") });

    await waitFor(() => expect(result.current.urls.v1).toBeUndefined());
    expect(repository.deleteByView).toHaveBeenCalledWith(project.id, "v1");
    expect(revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it("regenerates a stale thumbnail after the debounce while a consumer is visible", async () => {
    vi.useFakeTimers();
    const view = validView();
    // Cache stamped at an older project state than the current one.
    const project = projectWith([view], "t-new");
    const { repository, store } = fakeRepository({
      [`${project.id}:v1`]: {
        blob: new Blob(["stale"]),
        projectUpdatedAt: "t-old"
      }
    });
    const handle = handleReturning(new Blob(["fresh"]));

    const { result } = renderHook(() =>
      useSavedViewThumbnails({
        project,
        renderHandle: handle,
        active: true,
        repository
      })
    );

    // Well before the debounce, nothing has re-rendered yet.
    await vi.advanceTimersByTimeAsync(1000);
    expect(handle.renderSavedView).not.toHaveBeenCalled();

    // After ~2s of edit quiet, the stale view re-renders once and is restamped.
    await vi.advanceTimersByTimeAsync(1000);
    expect(handle.renderSavedView).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(store.get(`${project.id}:v1`)?.projectUpdatedAt).toBe("t-new")
    );
    expect(result.current.urls.v1).toBeDefined();
  });

  it("does not regenerate a stale thumbnail while no consumer is visible", async () => {
    vi.useFakeTimers();
    const view = validView();
    const project = projectWith([view], "t-new");
    const { repository } = fakeRepository({
      [`${project.id}:v1`]: {
        blob: new Blob(["stale"]),
        projectUpdatedAt: "t-old"
      }
    });
    const handle = handleReturning();

    renderHook(() =>
      useSavedViewThumbnails({
        project,
        renderHandle: handle,
        active: false,
        repository
      })
    );

    await vi.advanceTimersByTimeAsync(5000);
    expect(handle.renderSavedView).not.toHaveBeenCalled();
  });

  it("revokes every cached object URL on unmount", async () => {
    const view = validView();
    const project = projectWith([view], "t0");
    const { repository } = fakeRepository({
      [`${project.id}:v1`]: {
        blob: new Blob(["cached"]),
        projectUpdatedAt: "t0"
      }
    });
    const handle = handleReturning();

    const { result, unmount } = renderHook(() =>
      useSavedViewThumbnails({
        project,
        renderHandle: handle,
        active: false,
        repository
      })
    );

    await waitFor(() => expect(result.current.urls.v1).toBeDefined());
    const url = result.current.urls.v1;

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith(url);
  });
});
