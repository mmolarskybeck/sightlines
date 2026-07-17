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

  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  // Stored projectUpdatedAt per view, from the last read or render. A view is
  // stale when this differs from the project's current updatedAt.
  const freshnessRef = useRef<Map<string, string>>(new Map());
  // Views we've already read from (or accounted for in) the current project, so
  // reads don't repeat.
  const readRef = useRef<Set<string>>(new Set());
  // The updatedAt at which a render last failed, so a fail-open placeholder is
  // not retried in a tight loop until the project changes again.
  const failedRef = useRef<Map<string, string>>(new Map());
  const prevProjectIdRef = useRef<string | null>(null);
  const unmountedRef = useRef(false);

  const bumpTick = useCallback(() => setTick((value) => value + 1), []);

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
      queueRef.current.push({ view, kind });
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
    if (!projectId) return;
    let cancelled = false;

    // Project switch: revoke everything and reset, but do NOT delete the other
    // project's persisted entries — only same-project view removals delete.
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      queueRef.current = [];
      processingRef.current = false;
      freshnessRef.current.clear();
      readRef.current.clear();
      failedRef.current.clear();
      setUrls((current) => {
        for (const url of current.values()) URL.revokeObjectURL(url);
        return current.size === 0 ? current : new Map();
      });
      setHasPendingWork(false);
    }

    const wanted = new Set(savedViews.map((view) => view.id));

    // A view removed from the current project (explicit delete, or undo of its
    // save) loses its cache entry by every path.
    for (const viewId of Array.from(readRef.current)) {
      if (wanted.has(viewId)) continue;
      readRef.current.delete(viewId);
      freshnessRef.current.delete(viewId);
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
          if (cancelled || unmountedRef.current || !record) return;
          freshnessRef.current.set(view.id, record.projectUpdatedAt);
          publishUrl(view.id, URL.createObjectURL(record.blob));
        })
        .catch(() => {
          // A missing/unreadable entry just leaves the placeholder.
        });
    }

    return () => {
      cancelled = true;
    };
  }, [projectId, savedViewIdsKey, savedViews, repository, dropUrl, publishUrl]);

  // --- Debounced regeneration while a consumer is visible ------------------
  useEffect(() => {
    if (!projectId || !projectUpdatedAt || !active) return;
    const timer = setTimeout(() => {
      for (const view of savedViews) {
        if (isDegeneratePose(view.pose)) continue;
        // Fresh already? Nothing to do.
        if (freshnessRef.current.get(view.id) === projectUpdatedAt) continue;
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
    enqueue
  ]);

  // When the last consumer goes away, drop not-yet-started regen work (seeds
  // survive — a just-saved preview must still render). In-flight work finishes.
  useEffect(() => {
    if (active) return;
    const kept = queueRef.current.filter(
      (item, index) => item.kind === "seed" || (index === 0 && processingRef.current)
    );
    if (kept.length !== queueRef.current.length) {
      queueRef.current = kept;
      if (kept.length === 0 && !processingRef.current) setHasPendingWork(false);
      bumpTick();
    }
  }, [active, bumpTick]);

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
    const { view } = next;
    // Stamp with the project state at completion time; the host renders its
    // current project prop, which reflects the same live project.
    renderHandle
      .renderSavedView(view, SAVED_VIEW_THUMBNAIL_SIZE)
      .then((blob) => {
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
        if (unmountedRef.current) return;
        freshnessRef.current.set(view.id, stamp);
        failedRef.current.delete(view.id);
        publishUrl(view.id, URL.createObjectURL(blob));
      })
      .catch((error) => {
        // Fail open (§3.4): log, keep the placeholder, and mark this project
        // state failed so it isn't retried until the next edit.
        console.error("Saved-view thumbnail render failed:", error);
        failedRef.current.set(
          view.id,
          projectRef.current?.updatedAt ?? ""
        );
      })
      .finally(() => {
        processingRef.current = false;
        // Remove the item we just processed and advance.
        queueRef.current = queueRef.current.filter(
          (item) => item.view.id !== view.id
        );
        if (!unmountedRef.current) bumpTick();
      });
  }, [tick, renderHandle, hasPendingWork, repository, publishUrl, bumpTick]);

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
