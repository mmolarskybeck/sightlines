import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, SavedView } from "../../domain/project";
import { isDegeneratePose } from "../../domain/savedViews";
import { IndexedDbSavedViewThumbnailRepository } from "../../domain/repositories/indexedDbSavedViewThumbnailRepository";
import type { SavedViewThumbnailRepository } from "../../domain/repositories/savedViewThumbnailRepository";
import type { SavedViewRenderHandle } from "../components/three/SavedViewRenderHost";

// One canonical render size (saved-views spec §3.4): 4× the dialog's 74×46
// cell, ~16:10. Consumers downscale; nothing upscales. One size keeps the cache
// single-entry-per-view and the queue arithmetic dumb.
export const SAVED_VIEW_THUMBNAIL_SIZE = { widthPx: 296, heightPx: 184 };

// While a consumer is visible and the project is being edited, stale thumbnails
// re-render no more often than once per this much edit quiet (§3.4). The
// save-time seed bypasses this.
const REGEN_DEBOUNCE_MS = 2000;

// The default (production) repository. Constructing it is inert — it only opens
// IndexedDB when a method runs — so tests inject a fake and the real one never
// touches storage under them.
const defaultRepository: SavedViewThumbnailRepository =
  new IndexedDbSavedViewThumbnailRepository();

type QueueItem = {
  view: SavedView;
  projectId: string | null;
  generation: number;
  // Seeds always render (they exist so a just-saved view has a preview before
  // the dialog opens); regen items are only enqueued while a consumer is
  // visible and are dropped when the last consumer goes away.
  kind: "seed" | "regen";
};

export type UseSavedViewThumbnails = {
  // viewId → object URL of the freshest available thumbnail (a stale one still
  // shows while its replacement renders).
  urls: Readonly<Record<string, string>>;
  // Drives the render host's mount: true while any thumbnail is queued or
  // rendering. Idle projects with no consumer keep this false, so the three.js
  // chunk never loads for them.
  hasPendingWork: boolean;
  // Queue a just-saved view's first render immediately, bypassing the visible-
  // consumer and debounce gates (§3.4 "Seed at save").
  seed: (view: SavedView) => void;
};

// Owns the Saved-view thumbnail cache for one project (saved-views spec §3.5):
// cache reads, staleness, regeneration requests through the render host, and
// object-URL create/revoke — mirroring useAssetImageUrls's lifecycle
// discipline. Returns the `thumbnailUrls` record ExportPdfDialog already
// accepts.
export function useSavedViewThumbnails(options: {
  project: Project | null;
  // The offscreen render host's handle. Null until the host mounts; the host
  // mounts because `hasPendingWork` turns true, so the processing loop simply
  // waits for it to appear (renderHandle is a dependency, not a poll).
  renderHandle: SavedViewRenderHandle | null;
  // Is a thumbnail consumer (the Export dialog today, the pane in Phase B)
  // visible? Gates regeneration; the seed ignores it.
  active: boolean;
  repository?: SavedViewThumbnailRepository;
}): UseSavedViewThumbnails {
  const { project, renderHandle, active } = options;
  const repository = options.repository ?? defaultRepository;

  const projectId = project?.id ?? null;
  const projectUpdatedAt = project?.updatedAt ?? null;
  const savedViews = useMemo(() => project?.savedViews ?? [], [project]);
  // A stable dependency for effects that care about the set of views, not their
  // array identity (a fresh equivalent array must not restart the debounce).
  const savedViewIdsKey = savedViews.map((view) => view.id).join(",");

  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const [hasPendingWork, setHasPendingWork] = useState(false);
  // Bumped whenever the queue changes; the processing effect keys off it.
  const [tick, setTick] = useState(0);

  // Latest project, read without making every edit re-run the render loop.
  const projectRef = useRef(project);
  projectRef.current = project;
  const activeRef = useRef(active);
  activeRef.current = active;
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const processingItemRef = useRef<QueueItem | null>(null);
  // One hold keeps the offscreen render stage mounted across the sequential
  // queue. It is acquired only when the first queued item is about to render,
  // not merely when work is enqueued or the host mounts.
  const batchReleaseRef = useRef<(() => void) | null>(null);
  // Stored projectUpdatedAt per view, from the last read or render. A view is
  // stale when this differs from the project's current updatedAt.
  const freshnessRef = useRef<Map<string, string>>(new Map());
  // Views we've already read from (or accounted for in) the current project, so
  // reads don't repeat.
  const readRef = useRef<Set<string>>(new Set());
  // Cache reads that completed without a usable record. Keep this knowledge
  // while the pane is closed so the next open can render promptly instead of
  // treating a known miss like a stale thumbnail and waiting for the debounce.
  const missingRef = useRef<Set<string>>(new Set());
  // The updatedAt at which a render last failed, so a fail-open placeholder is
  // not retried in a tight loop until the project changes again.
  const failedRef = useRef<Map<string, string>>(new Map());
  const prevProjectIdRef = useRef<string | null>(null);
  const projectGenerationRef = useRef(0);
  const unmountedRef = useRef(false);

  const bumpTick = useCallback(() => setTick((value) => value + 1), []);

  const releaseRenderBatch = useCallback(() => {
    const release = batchReleaseRef.current;
    if (!release) return;
    batchReleaseRef.current = null;
    release();
  }, []);

  // Replace (or set) a view's object URL, revoking any it displaces.
  const publishUrl = useCallback((viewId: string, url: string) => {
    setUrls((current) => {
      const next = new Map(current);
      const previous = next.get(viewId);
      if (previous && previous !== url) URL.revokeObjectURL(previous);
      next.set(viewId, url);
      return next;
    });
  }, []);

  const dropUrl = useCallback((viewId: string) => {
    setUrls((current) => {
      const previous = current.get(viewId);
      if (!previous) return current;
      URL.revokeObjectURL(previous);
      const next = new Map(current);
      next.delete(viewId);
      return next;
    });
  }, []);

  const enqueue = useCallback(
    (view: SavedView, kind: QueueItem["kind"]) => {
      if (unmountedRef.current) return;
      // Never queue an invalid pose — it gets no thumbnail (§3.4).
      if (isDegeneratePose(view.pose)) return;
      // De-dupe against anything already queued (including the item in flight,
      // which stays at index 0 until it settles).
      if (queueRef.current.some((item) => item.view.id === view.id)) return;
      queueRef.current.push({
        view,
        kind,
        projectId: projectRef.current?.id ?? null,
        generation: projectGenerationRef.current
      });
      setHasPendingWork(true);
      bumpTick();
    },
    [bumpTick]
  );

  const seed = useCallback(
    (view: SavedView) => enqueue(view, "seed"),
    [enqueue]
  );

  // --- Cache reads, removals, and project switches -------------------------
  // Displays cached thumbnails (fresh or stale) as soon as the project opens,
  // and reconciles the cache when views are deleted or the project switches.
  useEffect(() => {
    let cancelled = false;

    // Project switch: revoke everything and reset, but do NOT delete the other
    // project's persisted entries — only same-project view removals delete.
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      projectGenerationRef.current += 1;
      releaseRenderBatch();
      queueRef.current = [];
      processingRef.current = false;
      processingItemRef.current = null;
      freshnessRef.current.clear();
      readRef.current.clear();
      missingRef.current.clear();
      failedRef.current.clear();
      setUrls((current) => {
        for (const url of current.values()) URL.revokeObjectURL(url);
        return current.size === 0 ? current : new Map();
      });
      setHasPendingWork(false);
    }

    if (!projectId) {
      return () => {
        cancelled = true;
      };
    }

    const generation = projectGenerationRef.current;

    const wanted = new Set(savedViews.map((view) => view.id));

    // A view removed from the current project (explicit delete, or undo of its
    // save) loses its cache entry by every path.
    for (const viewId of Array.from(readRef.current)) {
      if (wanted.has(viewId)) continue;
      readRef.current.delete(viewId);
      freshnessRef.current.delete(viewId);
      missingRef.current.delete(viewId);
      failedRef.current.delete(viewId);
      queueRef.current = queueRef.current.filter(
        (item) => item.view.id !== viewId
      );
      dropUrl(viewId);
      void repository.deleteByView(projectId, viewId).catch(() => {
        // A derived-cache delete failing is harmless: the orphan is invisible
        // and a project delete would sweep it later.
      });
    }

    // Read each not-yet-read view's cache and display it if present.
    for (const view of savedViews) {
      if (readRef.current.has(view.id)) continue;
      readRef.current.add(view.id);
      void repository
        .get(projectId, view.id)
        .then((record) => {
          if (
            cancelled ||
            unmountedRef.current ||
            projectGenerationRef.current !== generation ||
            projectRef.current?.id !== projectId
          ) {
            return;
          }
          if (!record) {
            // A seed may have completed while this older read was in flight.
            // Never turn that fresh result back into a known cache miss.
            if (
              freshnessRef.current.get(view.id) !==
              projectRef.current?.updatedAt
            ) {
              missingRef.current.add(view.id);
              // Closed panes record the miss without causing a render. Opening
              // later wakes the scheduler through its `active` dependency.
              if (activeRef.current) bumpTick();
            }
            return;
          }
          missingRef.current.delete(view.id);
          freshnessRef.current.set(view.id, record.projectUpdatedAt);
          publishUrl(view.id, URL.createObjectURL(record.blob));
          // Wake the stale scheduler after hydration. It deliberately skips
          // views whose cache read has not completed yet. Fresh hydration is
          // display-only and needs no extra queue-state update.
          if (
            activeRef.current &&
            record.projectUpdatedAt !== projectRef.current?.updatedAt
          ) {
            bumpTick();
          }
        })
        .catch(() => {
          // A missing/unreadable entry just leaves the placeholder until the
          // active consumer gets one frame to paint.
          if (
            !cancelled &&
            !unmountedRef.current &&
            projectGenerationRef.current === generation &&
            projectRef.current?.id === projectId
          ) {
            if (
              freshnessRef.current.get(view.id) !==
              projectRef.current?.updatedAt
            ) {
              missingRef.current.add(view.id);
              if (activeRef.current) bumpTick();
            }
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    savedViewIdsKey,
    repository,
    dropUrl,
    publishUrl,
    releaseRenderBatch,
    bumpTick
  ]);

  // A confirmed cache miss is different from a stale cached image: after the
  // consumer paints its placeholder, start missing work promptly. The missing
  // set persists while inactive, so opening the pane later takes this path too.
  useEffect(() => {
    if (!projectId || !projectUpdatedAt || !active) return;
    const timer = setTimeout(() => {
      for (const view of savedViews) {
        if (!missingRef.current.has(view.id)) continue;
        if (isDegeneratePose(view.pose)) continue;
        if (freshnessRef.current.get(view.id) === projectUpdatedAt) continue;
        if (failedRef.current.get(view.id) === projectUpdatedAt) continue;
        enqueue(view, "regen");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [
    projectId,
    projectUpdatedAt,
    active,
    savedViewIdsKey,
    savedViews,
    tick,
    enqueue
  ]);

  // --- Debounced regeneration while a consumer is visible ------------------
  useEffect(() => {
    if (!projectId || !projectUpdatedAt || !active) return;
    const timer = setTimeout(() => {
      for (const view of savedViews) {
        if (isDegeneratePose(view.pose)) continue;
        const cachedStamp = freshnessRef.current.get(view.id);
        // Missing entries have their prompt path above; undefined here means
        // the asynchronous cache read is still unresolved. Never render ahead
        // of it and then discover that a fresh thumbnail already existed.
        if (cachedStamp === undefined) continue;
        // Fresh already? Nothing to do.
        if (cachedStamp === projectUpdatedAt) continue;
        // Already failed at this exact project state — don't retry in a loop.
        if (failedRef.current.get(view.id) === projectUpdatedAt) continue;
        enqueue(view, "regen");
      }
    }, REGEN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    projectId,
    projectUpdatedAt,
    active,
    savedViewIdsKey,
    savedViews,
    tick,
    enqueue
  ]);

  // When the last consumer goes away, drop not-yet-started regen work (seeds
  // survive — a just-saved preview must still render). In-flight work finishes.
  useEffect(() => {
    if (active) return;
    const processingItem = processingItemRef.current;
    const kept = queueRef.current.filter(
      (item) => item.kind === "seed" || item === processingItem
    );
    if (kept.length !== queueRef.current.length) {
      queueRef.current = kept;
      if (kept.length === 0 && !processingItem) {
        setHasPendingWork(false);
        releaseRenderBatch();
      }
      bumpTick();
    }
  }, [active, bumpTick, releaseRenderBatch]);

  // --- Processing loop: one render at a time -------------------------------
  useEffect(() => {
    if (processingRef.current) return;
    const next = queueRef.current[0];
    if (!next) {
      if (hasPendingWork) setHasPendingWork(false);
      return;
    }
    // Wait for the host to mount. hasPendingWork is already true, so App is
    // mounting it; when its handle attaches, renderHandle changes and this
    // effect re-runs.
    if (!renderHandle) return;

    processingRef.current = true;
    if (!batchReleaseRef.current) {
      batchReleaseRef.current = renderHandle.beginRenderBatch();
    }
    const item = next;
    const { view } = item;
    processingItemRef.current = item;
    const projectIdAtStart = item.projectId;
    const generationAtStart = item.generation;
    const ownsCurrentWork = () =>
      !unmountedRef.current &&
      processingItemRef.current === item &&
      projectGenerationRef.current === generationAtStart &&
      projectRef.current?.id === projectIdAtStart;
    // Stamp with the project state at completion time; the host renders its
    // current project prop, which reflects the same live project.
    renderHandle
      .renderSavedView(view, SAVED_VIEW_THUMBNAIL_SIZE, { tier: "thumbnail" })
      .then((blob) => {
        if (!ownsCurrentWork()) return;
        const pid = projectRef.current?.id;
        const stamp = projectRef.current?.updatedAt ?? "";
        if (pid) {
          void repository.put(pid, view.id, { blob, projectUpdatedAt: stamp }).catch(
            () => {
              // Persist failure is non-fatal — the in-memory URL still
              // displays; next open simply re-renders.
            }
          );
        }
        freshnessRef.current.set(view.id, stamp);
        missingRef.current.delete(view.id);
        failedRef.current.delete(view.id);
        publishUrl(view.id, URL.createObjectURL(blob));
      })
      .catch((error) => {
        // Fail open (§3.4): log, keep the placeholder, and mark this project
        // state failed so it isn't retried until the next edit.
        if (!ownsCurrentWork()) return;
        console.error("Saved-view thumbnail render failed:", error);
        failedRef.current.set(
          view.id,
          projectRef.current?.updatedAt ?? ""
        );
      })
      .finally(() => {
        if (processingItemRef.current !== item) return;
        processingRef.current = false;
        processingItemRef.current = null;
        // Remove the item we just processed and advance.
        queueRef.current = queueRef.current.filter(
          (queuedItem) => queuedItem !== item
        );
        if (queueRef.current.length === 0) releaseRenderBatch();
        if (!unmountedRef.current) bumpTick();
      });
  }, [
    tick,
    renderHandle,
    hasPendingWork,
    repository,
    publishUrl,
    bumpTick,
    releaseRenderBatch
  ]);

  // Project changes and unmounts are cleanup/backstops. A normal queue drain
  // releases the hold in the render's finally above, so pane visibility does
  // not control the batch lifetime.
  useEffect(() => {
    return () => releaseRenderBatch();
  }, [projectId, releaseRenderBatch]);

  // Reset the unmounted flag in the body (not just cleanup) so StrictMode's
  // dev-only mount → cleanup → remount cycle doesn't leave it stuck true and
  // silently drop every subsequent render.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Revoke every remaining object URL on unmount. Read through a ref so the
  // cleanup sees the latest map without re-subscribing.
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  useEffect(
    () => () => {
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    },
    []
  );

  const record = useMemo(() => Object.fromEntries(urls), [urls]);

  return { urls: record, hasPendingWork, seed };
}
