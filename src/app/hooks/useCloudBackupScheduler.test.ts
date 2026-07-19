import { describe, expect, it } from "vitest";
import {
  shouldBackupNow,
  type ShouldBackupNowInput
} from "./useCloudBackupScheduler";

// A settled, dirty, connected, idle project past its interval — the one case
// that SHOULD upload. Each test perturbs one field.
const READY: ShouldBackupNowInput = {
  connected: true,
  dirty: true,
  uploading: false,
  msSinceLastSave: 200_000,
  msSinceLastUpload: 800_000,
  settleMs: 180_000,
  minIntervalMs: 720_000
};

describe("shouldBackupNow", () => {
  it("uploads when connected, dirty, idle, settled, and past the interval", () => {
    expect(shouldBackupNow(READY)).toBe(true);
  });

  it("does not upload when disconnected", () => {
    expect(shouldBackupNow({ ...READY, connected: false })).toBe(false);
  });

  it("does not upload when there are no un-backed-up changes", () => {
    expect(shouldBackupNow({ ...READY, dirty: false })).toBe(false);
  });

  it("does not upload while an upload is already running", () => {
    expect(shouldBackupNow({ ...READY, uploading: true })).toBe(false);
  });

  it("waits for the idle settle window", () => {
    expect(shouldBackupNow({ ...READY, msSinceLastSave: 10_000 })).toBe(false);
    expect(shouldBackupNow({ ...READY, msSinceLastSave: 180_000 })).toBe(true);
  });

  it("respects the minimum interval between uploads", () => {
    expect(shouldBackupNow({ ...READY, msSinceLastUpload: 60_000 })).toBe(false);
    expect(shouldBackupNow({ ...READY, msSinceLastUpload: 720_000 })).toBe(true);
  });

  it("uploads the first time even though there is no prior upload (Infinity)", () => {
    expect(
      shouldBackupNow({ ...READY, msSinceLastUpload: Number.POSITIVE_INFINITY })
    ).toBe(true);
  });
});
