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
  const releaseBatch = vi.fn();
  return {
    renderSavedView: vi.fn(async (_view: SavedView, _size: typeof SAVED_VIEW_THUMBNAIL_SIZE) => blob),
    beginRenderBatch: vi.fn(() => releaseBatch),
    releaseBatch
  } satisfies SavedViewRenderHandle & { releaseBatch: ReturnType<typeof vi.fn> };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
    expect(handle.beginRenderBatch).not.toHaveBeenCalled();
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
      SAVED_VIEW_THUMBNAIL_SIZE,
      { tier: "thumbnail" }
    );
    // Persisted with the current project stamp.
    expect(store.get(`${withView.id}:v1`)?.projectUpdatedAt).toBe(
      withView.updatedAt
    );
    await waitFor(() => expect(result.current.hasPendingWork).toBe(false));
  });

  it("holds one render batch across multiple queued views and releases on drain", async () => {
    const project = projectWith([], "t0");
    const { repository } = fakeRepository();
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    const view1 = validView({ id: "v1" });
    const view2 = validView({ id: "v2", ordinal: 2 });
    const handle = handleReturning();
    handle.renderSavedView.mockImplementation((view) =>
      view.id === "v1" ? first.promise : second.promise
    );

    const { result } = renderHook(() =>
      useSavedViewThumbnails({
        project,
        renderHandle: handle,
        active: false,
        repository
      })
    );

    act(() => {
      result.current.seed(view1);
      result.current.seed(view2);
    });

    await waitFor(() => expect(handle.renderSavedView).toHaveBeenCalledWith(
      view1,
      SAVED_VIEW_THUMBNAIL_SIZE,
      { tier: "thumbnail" }
    ));
    expect(handle.beginRenderBatch).toHaveBeenCalledTimes(1);
    expect(handle.releaseBatch).not.toHaveBeenCalled();
    expect(handle.renderSavedView).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(new Blob(["first"]));
      await Promise.resolve();
    });
    await waitFor(() => expect(handle.renderSavedView).toHaveBeenCalledWith(
      view2,
      SAVED_VIEW_THUMBNAIL_SIZE,
      { tier: "thumbnail" }
    ));
    expect(handle.beginRenderBatch).toHaveBeenCalledTimes(1);
    expect(handle.releaseBatch).not.toHaveBeenCalled();

    await act(async () => {
      second.resolve(new Blob(["second"]));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.hasPendingWork).toBe(false));
    expect(handle.releaseBatch).toHaveBeenCalledTimes(1);
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
    const releaseBatch = vi.fn();
    const handle: SavedViewRenderHandle & { releaseBatch: ReturnType<typeof vi.fn> } = {
      renderSavedView: vi.fn(async () => {
        throw new Error("webgl unavailable");
      }),
      beginRenderBatch: vi.fn(() => releaseBatch),
      releaseBatch
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
    expect(handle.beginRenderBatch).toHaveBeenCalledTimes(1);
    expect(handle.releaseBatch).toHaveBeenCalledTimes(1);
  });

  it("releases the active batch when the hook unmounts", async () => {
    const project = projectWith([], "t0");
    const { repository } = fakeRepository();
    const pending = deferred<Blob>();
    const handle = handleReturning();
    handle.renderSavedView.mockReturnValue(pending.promise);
    const view = validView();

    const { result, unmount } = renderHook(() =>
      useSavedViewThumbnails({
        project,
        renderHandle: handle,
        active: false,
        repository
      })
    );

    act(() => result.current.seed(view));
    await waitFor(() => expect(handle.beginRenderBatch).toHaveBeenCalledTimes(1));

    unmount();
    expect(handle.releaseBatch).toHaveBeenCalledTimes(1);
    pending.resolve(new Blob(["done"]));
  });

  it("releases the active batch when the project switches", async () => {
    const project = projectWith([], "t0");
    const nextProject = { ...projectWith([], "t1"), id: "project-2" };
    const { repository } = fakeRepository();
    const pending = deferred<Blob>();
    const handle = handleReturning();
    handle.renderSavedView.mockReturnValue(pending.promise);
    const view = validView();

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

    act(() => result.current.seed(view));
    await waitFor(() => expect(handle.beginRenderBatch).toHaveBeenCalledTimes(1));

    rerender({ p: nextProject });
    expect(handle.releaseBatch).toHaveBeenCalledTimes(1);
    pending.resolve(new Blob(["done"]));
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
    const { repository, store } = fakeRepository();
    const cached = deferred<SavedViewThumbnailRecord>();
    vi.mocked(repository.get).mockReturnValue(cached.promise);
    const handle = handleReturning(new Blob(["fresh"]));

    const { result } = renderHook(() =>
      useSavedViewThumbnails({
        project,
        renderHandle: handle,
        active: true,
        repository
      })
    );

    cached.resolve({
      blob: new Blob(["stale"]),
      projectUpdatedAt: "t-old"
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Well before the debounce, a stale-but-present thumbnail does not render.
    await vi.advanceTimersByTimeAsync(1000);
    expect(handle.renderSavedView).not.toHaveBeenCalled();

    // After ~2s of edit quiet, the stale view re-renders once and is restamped.
    await vi.advanceTimersByTimeAsync(1000);
    expect(handle.renderSavedView).toHaveBeenCalledTimes(1);
    expect(handle.renderSavedView).toHaveBeenCalledWith(
      view,
      SAVED_VIEW_THUMBNAIL_SIZE,
      { tier: "thumbnail" }
    );
    await vi.waitFor(() =>
      expect(store.get(`${project.id}:v1`)?.projectUpdatedAt).toBe("t-new")
    );
    expect(result.current.urls.v1).toBeDefined();
  });

  it("queues a missing thumbnail after the cache miss yields one task", async () => {
    vi.useFakeTimers();
    const view = validView();
    const project = projectWith([view], "t-new");
    const { repository } = fakeRepository();
    const cacheMiss = deferred<SavedViewThumbnailRecord | undefined>();
    vi.mocked(repository.get).mockReturnValue(cacheMiss.promise);
    const handle = handleReturning();

    renderHook(() =>
      useSavedViewThumbnails({
        project,
        renderHandle: handle,
        active: true,
        repository
      })
    );

    cacheMiss.resolve(undefined);
    await act(async () => {
      await Promise.resolve();
    });
    expect(handle.renderSavedView).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(handle.renderSavedView).toHaveBeenCalledWith(
      view,
      SAVED_VIEW_THUMBNAIL_SIZE,
      { tier: "thumbnail" }
    );
  });

  it("queues a known cache miss promptly when the pane opens later", async () => {
    vi.useFakeTimers();
    const view = validView();
    const project = projectWith([view], "t-new");
    const { repository } = fakeRepository();
    const handle = handleReturning();

    const { rerender } = renderHook(
      ({ isActive }: { isActive: boolean }) =>
        useSavedViewThumbnails({
          project,
          renderHandle: handle,
          active: isActive,
          repository
        }),
      { initialProps: { isActive: false } }
    );

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(handle.renderSavedView).not.toHaveBeenCalled();

    rerender({ isActive: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(handle.renderSavedView).toHaveBeenCalledWith(
      view,
      SAVED_VIEW_THUMBNAIL_SIZE,
      { tier: "thumbnail" }
    );
  });

  it("waits for a delayed cache read instead of rendering over a fresh record", async () => {
    vi.useFakeTimers();
    const view = validView();
    const project = projectWith([view], "t-current");
    const { repository } = fakeRepository();
    const delayed = deferred<SavedViewThumbnailRecord | undefined>();
    vi.mocked(repository.get).mockReturnValue(delayed.promise);
    const handle = handleReturning();

    renderHook(() =>
      useSavedViewThumbnails({
        project,
        renderHandle: handle,
        active: true,
        repository
      })
    );

    await vi.advanceTimersByTimeAsync(2500);
    expect(handle.renderSavedView).not.toHaveBeenCalled();

    delayed.resolve({
      blob: new Blob(["fresh"]),
      projectUpdatedAt: project.updatedAt
    });
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(handle.renderSavedView).not.toHaveBeenCalled();
  });

  it("drops queued regeneration work on pane close and releases after the in-flight render", async () => {
    vi.useFakeTimers();
    const view1 = validView({ id: "v1" });
    const view2 = validView({ id: "v2", ordinal: 2 });
    const project = projectWith([view1, view2], "t-new");
    const { repository } = fakeRepository();
    const first = deferred<Blob>();
    const handle = handleReturning();
    handle.renderSavedView.mockImplementation((view) =>
      view.id === "v1" ? first.promise : Promise.resolve(new Blob(["second"]))
    );

    const { result, rerender } = renderHook(
      ({ isActive }: { isActive: boolean }) =>
        useSavedViewThumbnails({
          project,
          renderHandle: handle,
          active: isActive,
          repository
        }),
      { initialProps: { isActive: true } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await vi.waitFor(() =>
      expect(handle.renderSavedView).toHaveBeenCalledWith(
        view1,
        SAVED_VIEW_THUMBNAIL_SIZE,
        { tier: "thumbnail" }
      )
    );
    expect(handle.renderSavedView).toHaveBeenCalledTimes(1);

    rerender({ isActive: false });
    expect(result.current.hasPendingWork).toBe(true);

    await act(async () => {
      first.resolve(new Blob(["first"]));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(result.current.hasPendingWork).toBe(false));
    expect(handle.renderSavedView).toHaveBeenCalledTimes(1);
    expect(handle.releaseBatch).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale completion after switching projects with the same view id", async () => {
    const firstProject = projectWith([], "t-first");
    const secondProject = { ...projectWith([], "t-second"), id: "project-2" };
    const firstView = validView({ title: "First project view" });
    const secondView = validView({ title: "Second project view" });
    const { repository, store } = fakeRepository();
    const oldRender = deferred<Blob>();
    const newRender = deferred<Blob>();
    const oldRelease = vi.fn();
    const newRelease = vi.fn();
    const handle: SavedViewRenderHandle = {
      renderSavedView: vi
        .fn()
        .mockImplementationOnce(() => oldRender.promise)
        .mockImplementationOnce(() => newRender.promise),
      beginRenderBatch: vi
        .fn()
        .mockImplementationOnce(() => oldRelease)
        .mockImplementationOnce(() => newRelease)
    };

    const { result, rerender } = renderHook(
      ({ p }: { p: Project }) =>
        useSavedViewThumbnails({
          project: p,
          renderHandle: handle,
          active: false,
          repository
        }),
      { initialProps: { p: firstProject } }
    );

    act(() => result.current.seed(firstView));
    await waitFor(() => expect(handle.beginRenderBatch).toHaveBeenCalledTimes(1));

    rerender({ p: secondProject });
    act(() => result.current.seed(secondView));
    await waitFor(() => expect(handle.beginRenderBatch).toHaveBeenCalledTimes(2));
    expect(handle.renderSavedView).toHaveBeenCalledTimes(2);

    await act(async () => {
      oldRender.resolve(new Blob(["old"]));
      await Promise.resolve();
    });
    expect(store.size).toBe(0);
    expect(result.current.urls.v1).toBeUndefined();
    expect(oldRelease).toHaveBeenCalledTimes(1);
    expect(newRelease).not.toHaveBeenCalled();

    await act(async () => {
      newRender.resolve(new Blob(["new"]));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.hasPendingWork).toBe(false));
    expect(store.get(`${secondProject.id}:v1`)?.projectUpdatedAt).toBe("t-second");
    expect(newRelease).toHaveBeenCalledTimes(1);
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
