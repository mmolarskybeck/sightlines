import { useEffect, useState } from "react";

export type StoragePersistenceState = "unsupported" | "granted" | "denied" | "pending";

// Browsers may evict "best-effort" storage under disk pressure — for a
// local-first tool where IndexedDB is the only copy of someone's project,
// that's a silent data-loss path (docs/plan.md MVP 1A). Requesting durable
// storage removes eviction-under-pressure as a failure mode wherever the
// Storage API supports it; the calling UI falls back to nudging manual
// export where it doesn't. `persisted`/`persist` are absent on Safari and
// older browsers, so every call here is guarded — a missing or misbehaving
// API must never block app boot.
export function useStoragePersistence(): {
  state: StoragePersistenceState;
  retry: () => void;
} {
  const [state, setState] = useState<StoragePersistenceState>("pending");
  // Bumped by retry() to re-run the request effect — meaningfully useful
  // only when state is "denied" (the browser may grant on a later ask, e.g.
  // after the user interacts with the page), but harmless to re-run from
  // any state.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function requestPersistence() {
      const storage = navigator.storage;
      if (!storage?.persisted || !storage.persist) {
        if (!cancelled) setState("unsupported");
        return;
      }

      try {
        const alreadyPersisted = await storage.persisted();
        if (alreadyPersisted) {
          if (!cancelled) setState("granted");
          return;
        }

        const granted = await storage.persist();
        if (!cancelled) setState(granted ? "granted" : "denied");
      } catch {
        // The API existing doesn't guarantee it works everywhere it's
        // exposed (private browsing, permission policy, etc.) — treat any
        // thrown failure the same as the API not being there at all,
        // rather than risk a state the UI can't reconcile.
        if (!cancelled) setState("unsupported");
      }
    }

    void requestPersistence();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { state, retry: () => setAttempt((current) => current + 1) };
}

// "granted" covers both an already-durable store and a fresh grant this
// session; either way the browser has committed not to evict it under
// storage pressure, so the note can say so instead of just nudging toward
// a backup. "pending" (the check hasn't resolved yet) keeps the original
// neutral copy rather than flashing a stronger warning that may immediately
// flip to reassurance.
export function getStorageNoteCopy(state: StoragePersistenceState): string {
  if (state === "granted") {
    return "Saved locally in this browser with durable storage. The browser won't clear it under storage pressure. Export a backup for long-term safekeeping.";
  }

  if (state === "denied" || state === "unsupported") {
    return "Saved locally in this browser, which may clear it under storage pressure. Export a backup regularly for long-term safekeeping.";
  }

  return "Saved locally in this browser. Export a backup for long-term safekeeping.";
}
