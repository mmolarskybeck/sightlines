import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CROSS_TAB_CHANNEL_NAME,
  createCrossTabSync,
  createInertCrossTabSync,
  isCrossTabMessage,
  type CrossTabChannel,
  type CrossTabMessage
} from "./crossTabSync";

// A BroadcastChannel stand-in. `emit` plays the part of another tab posting:
// the real channel never delivers to its own poster, and neither does this.
class FakeChannel implements CrossTabChannel {
  posted: CrossTabMessage[] = [];
  closed = false;
  private listeners = new Set<(event: MessageEvent<CrossTabMessage>) => void>();

  postMessage(message: CrossTabMessage): void {
    if (this.closed) throw new Error("channel is closed");
    this.posted.push(message);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<CrossTabMessage>) => void
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<CrossTabMessage>) => void
  ): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  emit(data: unknown): void {
    for (const listener of [...this.listeners]) {
      listener({ data } as MessageEvent<CrossTabMessage>);
    }
  }
}

describe("crossTabSync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts what this tab saved", () => {
    const channel = new FakeChannel();
    const sync = createCrossTabSync(() => channel);

    sync.announceProjectSaved("project-1", "2026-08-10T12:00:00.000Z");
    sync.announceArtworksSaved();

    expect(channel.posted).toEqual([
      { kind: "project-saved", projectId: "project-1", updatedAt: "2026-08-10T12:00:00.000Z" },
      { kind: "artworks-saved" }
    ]);
  });

  it("delivers another tab's messages to every subscriber until it unsubscribes", () => {
    const channel = new FakeChannel();
    const sync = createCrossTabSync(() => channel);
    const first: CrossTabMessage[] = [];
    const second: CrossTabMessage[] = [];

    const unsubscribe = sync.subscribe((message) => first.push(message));
    sync.subscribe((message) => second.push(message));

    channel.emit({ kind: "artworks-saved" });
    unsubscribe();
    channel.emit({ kind: "artworks-saved" });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
  });

  it("drops messages it does not recognize", () => {
    const channel = new FakeChannel();
    const sync = createCrossTabSync(() => channel);
    const received: CrossTabMessage[] = [];
    sync.subscribe((message) => received.push(message));

    // A tab running a different build of the app, or anything else on the bus.
    channel.emit(null);
    channel.emit("project-saved");
    channel.emit({ kind: "something-else" });
    channel.emit({ kind: "project-saved", projectId: "p1" });
    channel.emit({ kind: "project-saved", projectId: 7, updatedAt: "2026-08-10T12:00:00.000Z" });

    expect(received).toEqual([]);
  });

  it("keeps delivering to the other subscribers when one throws", () => {
    const channel = new FakeChannel();
    const sync = createCrossTabSync(() => channel);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const received: CrossTabMessage[] = [];

    sync.subscribe(() => {
      throw new Error("handler boom");
    });
    sync.subscribe((message) => received.push(message));

    channel.emit({ kind: "artworks-saved" });

    expect(received).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it("closes the channel and stops listening", () => {
    const channel = new FakeChannel();
    const sync = createCrossTabSync(() => channel);
    sync.subscribe(() => {});

    sync.close();

    expect(channel.closed).toBe(true);
    expect(channel.listenerCount).toBe(0);
    // Posting after close must not throw at the caller — a save that finishes
    // during tab teardown still succeeded.
    expect(() => sync.announceArtworksSaved()).not.toThrow();
    expect(channel.posted).toEqual([]);
  });

  it("survives a channel that throws while posting", () => {
    const channel = new FakeChannel();
    const sync = createCrossTabSync(() => channel);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A detached channel (bfcache, teardown) throws on postMessage.
    channel.close();

    expect(() => sync.announceProjectSaved("p1", "2026-08-10T12:00:00.000Z")).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it("is inert without a channel", () => {
    const sync = createInertCrossTabSync();
    const received: CrossTabMessage[] = [];
    const unsubscribe = sync.subscribe((message) => received.push(message));

    expect(() => sync.announceProjectSaved("p1", "2026-08-10T12:00:00.000Z")).not.toThrow();
    expect(() => sync.announceArtworksSaved()).not.toThrow();
    expect(() => unsubscribe()).not.toThrow();
    expect(() => sync.close()).not.toThrow();
    expect(received).toEqual([]);
  });

  it("is inert where BroadcastChannel does not exist", () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error — modelling a runtime without BroadcastChannel.
    delete globalThis.BroadcastChannel;
    try {
      const sync = createCrossTabSync();
      expect(() => sync.announceArtworksSaved()).not.toThrow();
      expect(() => sync.close()).not.toThrow();
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });

  it("names one channel for the whole app", () => {
    expect(CROSS_TAB_CHANNEL_NAME).toBe("sightlines-sync");
  });

  it("recognizes the messages it sends", () => {
    expect(isCrossTabMessage({ kind: "artworks-saved" })).toBe(true);
    expect(
      isCrossTabMessage({
        kind: "project-saved",
        projectId: "p1",
        updatedAt: "2026-08-10T12:00:00.000Z"
      })
    ).toBe(true);
    expect(isCrossTabMessage({ kind: "project-saved", updatedAt: "x" })).toBe(false);
  });
});
