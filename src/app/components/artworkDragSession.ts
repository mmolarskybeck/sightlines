// A module-scope record of the in-flight checklist artwork drag, existing
// because iPadOS Safari can deliver `drop` after React state (draggingArtworkId)
// has already been cleared — WebKit's dragend/drop/re-render ordering isn't
// guaranteed to match desktop browsers, so a plain useState fallback can be
// gone by the time the drop handler reads it. This session outlives that
// timing by holding the id a little past dragend.

let activeArtworkId: string | null = null;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

export function beginArtworkDragSession(artworkId: string): void {
  if (clearTimer !== undefined) {
    clearTimeout(clearTimer);
    clearTimer = undefined;
  }
  activeArtworkId = artworkId;
}

export function endArtworkDragSession(): void {
  if (clearTimer !== undefined) {
    clearTimeout(clearTimer);
  }
  // Don't clear immediately: a drop that lands after dragend (iPadOS) still
  // needs to see the id, so linger briefly before giving up on this session.
  clearTimer = setTimeout(() => {
    activeArtworkId = null;
    clearTimer = undefined;
  }, 500);
}

export function peekArtworkDragSession(): string | null {
  return activeArtworkId;
}

export function consumeArtworkDragSession(): void {
  if (clearTimer !== undefined) {
    clearTimeout(clearTimer);
    clearTimer = undefined;
  }
  activeArtworkId = null;
}

// --- Touch/pen drag coordinator ---------------------------------------------
//
// iPhone Safari has no HTML5 drag-and-drop and iPadOS won't reliably fire the
// `drop` event, so touch/pen drags run on a parallel pointer-event path (the
// approach dnd-kit-style libraries take). ChecklistPanel arms a long-press,
// emits pointer coordinates here, and the drop-target views subscribe. This
// coordinator carries the coordinates; it deliberately holds no DOM.
//
// The existing HTML5 session above is untouched — but every emit keeps
// peekArtworkDragSession() coherent (begin on first move, consume on
// drop/cancel) so any code still consulting that session sees the touch drag
// too.

export type ArtworkTouchDragEvent =
  | { type: "move"; artworkId: string; clientX: number; clientY: number }
  | { type: "drop"; artworkId: string; clientX: number; clientY: number }
  | { type: "cancel"; artworkId: string };

const touchDragListeners = new Set<(event: ArtworkTouchDragEvent) => void>();
let touchDragActive = false;

export function subscribeArtworkTouchDrag(
  listener: (event: ArtworkTouchDragEvent) => void
): () => void {
  touchDragListeners.add(listener);
  return () => {
    touchDragListeners.delete(listener);
  };
}

export function emitArtworkTouchDrag(event: ArtworkTouchDragEvent): void {
  // Keep the flag and the HTML5 session coherent before fanning out, so a
  // listener that consults isArtworkTouchDragActive()/peek during its callback
  // reads the settled state.
  if (event.type === "move") {
    if (!touchDragActive) beginArtworkDragSession(event.artworkId);
    touchDragActive = true;
  } else {
    // drop or cancel — the drag is over.
    touchDragActive = false;
    consumeArtworkDragSession();
  }

  for (const listener of touchDragListeners) {
    listener(event);
  }
}

// True between the first "move" and the terminating "drop"/"cancel".
export function isArtworkTouchDragActive(): boolean {
  return touchDragActive;
}
