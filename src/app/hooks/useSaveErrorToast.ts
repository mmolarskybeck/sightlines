import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppStore, type SaveError } from "../store";

// Announce a save failure only on the transition INTO error: when there was no
// prior error, or the failing scope changed. A keystroke that keeps hitting the
// same broken save re-runs persist and produces a fresh saveError object each
// time — but the store clears saveError only on a real recovery, so successive
// same-scope failures are the same error episode and must not stack a toast per
// attempt. (Pure so the guard is unit-testable without rendering.)
export function shouldAnnounceSaveError(
  prev: SaveError | null,
  next: SaveError | null
): boolean {
  if (!next) return false;
  if (!prev) return true;
  return prev.scope !== next.scope;
}

// Watches the store's saveError and fires a single error toast with a Retry
// action that re-runs exactly what failed (the scope's own closure). The badge
// (StatusBadge, driven by saveState) is untouched.
export function useSaveErrorToast(): void {
  const saveError = useAppStore((state) => state.saveError);
  const prevRef = useRef<SaveError | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = saveError;
    if (!shouldAnnounceSaveError(prev, saveError) || !saveError) return;

    // Bind the toast's Retry to this specific failure's closure.
    const current = saveError;
    toast.error(current.message, {
      action: {
        label: "Retry",
        onClick: () => {
          void current.retry();
        }
      }
    });
  }, [saveError]);
}
