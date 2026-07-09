import { useRef } from "react";

/**
 * A hook providing a ref-based mechanism to suppress the next select/click event.
 * Used when a pointer release triggers a trailing click that must not collapse
 * a multi-selection (group drags, marquee selection, etc.). The suppression flag
 * is cleared on a timeout to handle releases where no click follows (pointer left
 * mid-drag).
 */
export function useSelectSuppression() {
  const suppressNextSelectRef = useRef(false);

  function suppressNextSelect() {
    suppressNextSelectRef.current = true;
    window.setTimeout(() => {
      suppressNextSelectRef.current = false;
    }, 0);
  }

  function consumeSelectSuppression(): boolean {
    const suppressed = suppressNextSelectRef.current;
    suppressNextSelectRef.current = false;
    return suppressed;
  }

  return {
    suppressNextSelect,
    consumeSelectSuppression,
    suppressNextSelectRef
  };
}
