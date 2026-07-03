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
export function useStoragePersistence(): StoragePersistenceState {
  const [state, setState] = useState<StoragePersistenceState>("pending");

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
  }, []);

  return state;
}
