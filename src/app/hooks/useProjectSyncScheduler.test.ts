import { describe, expect, it } from "vitest";
import {
  CLOUD_SYNC_MIN_INTERVAL_MS,
  CLOUD_SYNC_SETTLE_MS,
  shouldSyncNow,
  type ShouldSyncNowInput
} from "./useProjectSyncScheduler";

// A linked, settled, dirty, idle project past its interval — the one case that
// SHOULD evaluate the state machine. Each test perturbs one field.
const READY: ShouldSyncNowInput = {
  connected: true,
  linked: true,
  paused: false,
  dirty: true,
  busy: false,
  msSinceLastChange: 25_000,
  msSinceLastSync: 90_000,
  settleMs: 20_000,
  minIntervalMs: 60_000
};

describe("shouldSyncNow", () => {
  it("syncs when connected, linked, dirty, idle, settled, and past the interval", () => {
    expect(shouldSyncNow(READY)).toBe(true);
  });

  it("does not sync when disconnected", () => {
    expect(shouldSyncNow({ ...READY, connected: false })).toBe(false);
  });

  it("does not sync a project that isn't linked to a head", () => {
    expect(shouldSyncNow({ ...READY, linked: false })).toBe(false);
  });

  // "Not now" on a conflict must survive every background cycle; only the
  // explicit review gesture resumes it.
  it("does not sync a paused project", () => {
    expect(shouldSyncNow({ ...READY, paused: true })).toBe(false);
  });

  // Remote-only changes arrive via focus/visibility/project-open, not by polling
  // Dropbox every few seconds for a project nobody is touching.
  it("does not sync when this device has no changes", () => {
    expect(shouldSyncNow({ ...READY, dirty: false })).toBe(false);
  });

  it("does not sync while a check or transfer is already running", () => {
    expect(shouldSyncNow({ ...READY, busy: true })).toBe(false);
  });

  it("waits for the idle settle window", () => {
    expect(shouldSyncNow({ ...READY, msSinceLastChange: 5_000 })).toBe(false);
    expect(shouldSyncNow({ ...READY, msSinceLastChange: 20_000 })).toBe(true);
  });

  it("respects the minimum interval between head writes", () => {
    expect(shouldSyncNow({ ...READY, msSinceLastSync: 30_000 })).toBe(false);
    expect(shouldSyncNow({ ...READY, msSinceLastSync: 60_000 })).toBe(true);
  });

  it("syncs the first time even though nothing has synced yet (Infinity)", () => {
    expect(
      shouldSyncNow({ ...READY, msSinceLastSync: Number.POSITIVE_INFINITY })
    ).toBe(true);
  });

  // Sync's gates are much tighter than auto-backup's: the head is one file that
  // gets replaced, not a retention slot that gets burned.
  it("defaults to a 20s settle and a 60s interval", () => {
    expect(CLOUD_SYNC_SETTLE_MS).toBe(20_000);
    expect(CLOUD_SYNC_MIN_INTERVAL_MS).toBe(60_000);
  });
});
