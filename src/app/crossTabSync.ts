// Cross-tab notification for a local-first app whose tabs each hold their own
// full in-memory copy of the open project.
//
// Every tab writes the WHOLE project document on every edit, so without any
// cross-tab awareness a second tab's first edit silently overwrites everything
// the first tab saved. This module is the notification half of the fix: a tab
// that saves says so, and other tabs holding the same project quietly reload
// from IndexedDB (the reload itself lives in the store — see startCrossTabSync).
//
// This is deliberately NOT multiplayer. There are no locks, no conflict
// resolution and no shared editing session; two tabs editing at the same instant
// still resolve last-write-wins. What it buys is that a tab left open in the
// background stops being a loaded gun.
//
// BroadcastChannel does not deliver a message back to the context that posted
// it, so nothing here needs a sender id or self-filtering.

export const CROSS_TAB_CHANNEL_NAME = "sightlines-sync";

export type CrossTabMessage =
  | {
      kind: "project-saved";
      projectId: string;
      // The saved document's own updatedAt, so a receiver can tell "newer than
      // mine" from "the copy I already have" without a storage read. ISO-8601
      // UTC (Date#toISOString), which is why plain string comparison orders it.
      updatedAt: string;
    }
  // The artwork library is device-level rather than per-project, so there is
  // nothing to compare — a receiver just re-lists it.
  | { kind: "artworks-saved" };

// The slice of BroadcastChannel this module uses, named separately so tests can
// hand in a plain object and never touch the real channel bus. (A test realm is
// shared: two "real" channels opened in one process would hear each other.)
export type CrossTabChannel = {
  postMessage(message: CrossTabMessage): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<CrossTabMessage>) => void
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<CrossTabMessage>) => void
  ): void;
  close(): void;
};

export type CrossTabSync = {
  announceProjectSaved: (projectId: string, updatedAt: string) => void;
  announceArtworksSaved: () => void;
  /** Returns an unsubscribe function; safe to call more than once. */
  subscribe: (handler: (message: CrossTabMessage) => void) => () => void;
  close: () => void;
};

// Returns null wherever BroadcastChannel does not exist (SSR, older WebViews,
// a worker without it). A null channel makes the whole module inert rather than
// throwing: the app keeps working exactly as it did before this feature, which
// is the correct degradation for a convenience that only ever REFRESHES.
export type CrossTabChannelFactory = () => CrossTabChannel | null;

const defaultChannelFactory: CrossTabChannelFactory = () => {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(CROSS_TAB_CHANNEL_NAME) as unknown as CrossTabChannel;
};

// Messages come from another tab, which may be running a different build of the
// app (a user reloads one tab after a deploy and not the other). Treat anything
// that does not match a shape we know as noise and drop it, rather than letting
// it reach the store as a half-typed object.
export function isCrossTabMessage(value: unknown): value is CrossTabMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<CrossTabMessage> & { kind?: unknown };
  if (message.kind === "artworks-saved") return true;
  if (message.kind !== "project-saved") return false;
  const saved = message as Partial<Extract<CrossTabMessage, { kind: "project-saved" }>>;
  return typeof saved.projectId === "string" && typeof saved.updatedAt === "string";
}

export function createCrossTabSync(
  createChannel: CrossTabChannelFactory = defaultChannelFactory
): CrossTabSync {
  // Created eagerly but only when this function is called — the store resolves
  // its sync lazily, so a store that never saves and never boots (most unit
  // tests) opens no channel at all.
  const channel = createChannel();
  const handlers = new Set<(message: CrossTabMessage) => void>();
  let closed = false;

  // One channel listener fans out to every subscriber. A handler that throws
  // must not take the others down with it — a passive refresh is never
  // important enough to break the tab that receives it.
  const onMessage = (event: MessageEvent<CrossTabMessage>) => {
    if (!isCrossTabMessage(event.data)) return;
    for (const handler of [...handlers]) {
      try {
        handler(event.data);
      } catch (error) {
        console.warn("Cross-tab sync handler failed", error);
      }
    }
  };

  channel?.addEventListener("message", onMessage);

  function post(message: CrossTabMessage): void {
    if (!channel || closed) return;
    try {
      channel.postMessage(message);
    } catch (error) {
      // A closed or detached channel (bfcache, tab teardown mid-save) throws.
      // The save itself already succeeded; failing to tell the other tabs is
      // not a reason to surface anything.
      console.warn("Cross-tab sync could not post a message", error);
    }
  }

  return {
    announceProjectSaved(projectId, updatedAt) {
      post({ kind: "project-saved", projectId, updatedAt });
    },
    announceArtworksSaved() {
      post({ kind: "artworks-saved" });
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      handlers.clear();
      channel?.removeEventListener("message", onMessage);
      channel?.close();
    }
  };
}

// An explicitly dead sync, for callers that want the seam filled without a
// channel behind it — tests that must not hear other tests' stores, and any
// future context where cross-tab refresh would be wrong.
export function createInertCrossTabSync(): CrossTabSync {
  return createCrossTabSync(() => null);
}
