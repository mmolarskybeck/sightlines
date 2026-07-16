import { useEffect, useRef } from "react";

// Escape disarms an armed create/placement mode. The generic tool ghost, the
// duplicate-partition ghost, and the partition- and rectangle-draw tools all
// shared this exact plumbing: while the mode is armed, Escape runs `disarm`.
// `active` is any truthy-when-armed value (a boolean flag or the armed id).
// The callback is read through a ref so the window listener re-subscribes only
// when the armed state itself flips, not on every render — matching the
// original effects, which keyed solely on the armed value.
export function useDisarmOnEscape(active: unknown, disarm: () => void) {
  const disarmRef = useRef(disarm);
  disarmRef.current = disarm;

  const armed = Boolean(active);
  useEffect(() => {
    if (!armed) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") disarmRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armed]);
}
