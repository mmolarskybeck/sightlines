import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeArtworkDragSession,
  emitArtworkTouchDrag,
  isArtworkTouchDragActive,
  peekArtworkDragSession,
  subscribeArtworkTouchDrag,
  type ArtworkTouchDragEvent
} from "./artworkDragSession";

afterEach(() => {
  // Terminate any in-flight touch drag so a leaked "move" can't bleed into the
  // next test's active flag / session.
  if (isArtworkTouchDragActive()) {
    emitArtworkTouchDrag({ type: "cancel", artworkId: "cleanup" });
  }
  consumeArtworkDragSession();
  vi.useRealTimers();
});

describe("artwork touch drag coordinator", () => {
  it("delivers emitted events to every subscriber", () => {
    const a: ArtworkTouchDragEvent[] = [];
    const b: ArtworkTouchDragEvent[] = [];
    subscribeArtworkTouchDrag((event) => a.push(event));
    subscribeArtworkTouchDrag((event) => b.push(event));

    const move: ArtworkTouchDragEvent = {
      type: "move",
      artworkId: "art-1",
      clientX: 10,
      clientY: 20
    };
    emitArtworkTouchDrag(move);

    expect(a).toEqual([move]);
    expect(b).toEqual([move]);
  });

  it("stops delivering after unsubscribe", () => {
    const received: ArtworkTouchDragEvent[] = [];
    const unsubscribe = subscribeArtworkTouchDrag((event) => received.push(event));

    emitArtworkTouchDrag({ type: "move", artworkId: "art-1", clientX: 0, clientY: 0 });
    unsubscribe();
    emitArtworkTouchDrag({ type: "drop", artworkId: "art-1", clientX: 0, clientY: 0 });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("move");
  });

  it("tracks the active flag across the drag lifecycle", () => {
    expect(isArtworkTouchDragActive()).toBe(false);

    emitArtworkTouchDrag({ type: "move", artworkId: "art-1", clientX: 0, clientY: 0 });
    expect(isArtworkTouchDragActive()).toBe(true);

    emitArtworkTouchDrag({ type: "move", artworkId: "art-1", clientX: 5, clientY: 5 });
    expect(isArtworkTouchDragActive()).toBe(true);

    emitArtworkTouchDrag({ type: "drop", artworkId: "art-1", clientX: 5, clientY: 5 });
    expect(isArtworkTouchDragActive()).toBe(false);
  });

  it("clears the active flag on cancel too", () => {
    emitArtworkTouchDrag({ type: "move", artworkId: "art-1", clientX: 0, clientY: 0 });
    expect(isArtworkTouchDragActive()).toBe(true);

    emitArtworkTouchDrag({ type: "cancel", artworkId: "art-1" });
    expect(isArtworkTouchDragActive()).toBe(false);
  });

  it("keeps the HTML5 peek session coherent through a touch drag", () => {
    expect(peekArtworkDragSession()).toBeNull();

    // First move begins the session so any code still reading peek sees the id.
    emitArtworkTouchDrag({ type: "move", artworkId: "art-9", clientX: 0, clientY: 0 });
    expect(peekArtworkDragSession()).toBe("art-9");

    // Drop consumes it immediately (no 500ms linger — pointerup fires the drop
    // synchronously, unlike WebKit's deferred HTML5 drop).
    emitArtworkTouchDrag({ type: "drop", artworkId: "art-9", clientX: 0, clientY: 0 });
    expect(peekArtworkDragSession()).toBeNull();
  });

  it("consumes the peek session on cancel", () => {
    emitArtworkTouchDrag({ type: "move", artworkId: "art-9", clientX: 0, clientY: 0 });
    expect(peekArtworkDragSession()).toBe("art-9");

    emitArtworkTouchDrag({ type: "cancel", artworkId: "art-9" });
    expect(peekArtworkDragSession()).toBeNull();
  });
});
