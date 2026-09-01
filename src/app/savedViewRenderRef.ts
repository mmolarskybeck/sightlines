// The App-owned handle slot for the lazily-mounted SavedViewRenderHost. The
// host attaches its render handle in an effect after its three.js chunk loads
// and Suspense resolves, so consumers that start work the moment an export
// begins (handleExportPdf) can reach their first 3D page before the handle
// exists. `whenReady` closes that gap: it resolves when the handle attaches,
// aborts with the export's signal, and times out to the writer's per-view
// placeholder path rather than hanging the document.
//
// Imports only the handle *type* from SavedViewRenderHost, so this module adds
// nothing to the eager chunk graph.

import type { SavedViewRenderHandle } from "./components/three/SavedViewRenderHost";

// How long a PDF export will wait for the host to attach its handle before
// giving up on real 3D pages. Generous because the wait covers a cold
// three-chunk fetch on a slow connection; expiry degrades to the writer's
// placeholder page, never a lost document.
export const SAVED_VIEW_HOST_READY_TIMEOUT_MS = 15_000;

export type SavedViewRenderRef = {
  current: SavedViewRenderHandle | null;
  whenReady: (signal?: AbortSignal) => Promise<SavedViewRenderHandle>;
};

function abortError(): DOMException {
  return new DOMException("The export was cancelled.", "AbortError");
}

// `onChange` mirrors every write (the host attaching/detaching) out to React
// state so effect-driven consumers (useSavedViewThumbnails) re-run; the ref
// itself stays readable synchronously.
export function createSavedViewRenderRef(
  onChange: (handle: SavedViewRenderHandle | null) => void,
  timeoutMs: number = SAVED_VIEW_HOST_READY_TIMEOUT_MS
): SavedViewRenderRef {
  let value: SavedViewRenderHandle | null = null;
  const waiters = new Set<(handle: SavedViewRenderHandle) => void>();
  return {
    get current() {
      return value;
    },
    set current(next: SavedViewRenderHandle | null) {
      value = next;
      onChange(next);
      if (next) {
        const pending = [...waiters];
        waiters.clear();
        for (const notify of pending) notify(next);
      }
    },
    whenReady(signal?: AbortSignal): Promise<SavedViewRenderHandle> {
      if (value) return Promise.resolve(value);
      if (signal?.aborted) return Promise.reject(abortError());
      return new Promise<SavedViewRenderHandle>((resolve, reject) => {
        const settle = (run: () => void) => {
          waiters.delete(notify);
          signal?.removeEventListener("abort", onAbort);
          clearTimeout(timer);
          run();
        };
        const notify = (handle: SavedViewRenderHandle) =>
          settle(() => resolve(handle));
        const onAbort = () => settle(() => reject(abortError()));
        const timer = setTimeout(
          () =>
            settle(() =>
              reject(
                new Error(
                  "The 3D renderer was not ready in time to render Saved views."
                )
              )
            ),
          timeoutMs
        );
        waiters.add(notify);
        signal?.addEventListener("abort", onAbort);
      });
    }
  };
}
