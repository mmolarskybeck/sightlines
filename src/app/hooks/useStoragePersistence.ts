import { useEffect, useState } from "react";

export type StoragePersistenceState = "unsupported" | "granted" | "denied" | "pending";

// Requests durable browser storage for local-first project data. Unsupported
// or failing Storage APIs must never block app boot.
export function useStoragePersistence(): {
  state: StoragePersistenceState;
  retry: () => void;
} {
  const [state, setState] = useState<StoragePersistenceState>("pending");
  // Incremented by retry() to rerun the request effect.
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
        // Exposed APIs can still throw in private browsing or by policy.
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

// Keep pending copy neutral to avoid flashing a warning before the check resolves.
export function getStorageNoteCopy(state: StoragePersistenceState): string {
  if (state === "granted") {
    return "Saved locally in this browser with durable storage. The browser won't clear it under storage pressure. Export a backup for long-term safekeeping.";
  }

  if (state === "denied" || state === "unsupported") {
    return "Saved locally in this browser, which may clear it under storage pressure. Export a backup regularly for long-term safekeeping.";
  }

  return "Saved locally in this browser. Export a backup for long-term safekeeping.";
}
