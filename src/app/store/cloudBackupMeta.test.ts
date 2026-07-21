import { beforeEach, describe, expect, it } from "vitest";
import {
  CLOUD_BACKUP_META_KEY_PREFIX,
  deleteCloudBackupMeta,
  readCloudBackupMeta,
  writeCloudBackupMeta
} from "./cloudBackupMeta";

describe("cloudBackupMeta", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips a meta record", () => {
    writeCloudBackupMeta("p1", {
      lastCloudBackupAt: "2026-07-19T00:00:00Z",
      backedUpFingerprint: "abc"
    });
    expect(readCloudBackupMeta("p1")).toEqual({
      lastCloudBackupAt: "2026-07-19T00:00:00Z",
      backedUpFingerprint: "abc"
    });
  });

  it("returns empty meta when nothing stored", () => {
    expect(readCloudBackupMeta("missing")).toEqual({
      lastCloudBackupAt: null,
      backedUpFingerprint: null
    });
  });

  it("tolerates corrupt JSON and non-object values", () => {
    window.localStorage.setItem(`${CLOUD_BACKUP_META_KEY_PREFIX}p1`, "{not json");
    expect(readCloudBackupMeta("p1")).toEqual({
      lastCloudBackupAt: null,
      backedUpFingerprint: null
    });
    window.localStorage.setItem(`${CLOUD_BACKUP_META_KEY_PREFIX}p2`, "[1,2,3]");
    expect(readCloudBackupMeta("p2")).toEqual({
      lastCloudBackupAt: null,
      backedUpFingerprint: null
    });
  });

  it("drops fields of the wrong type", () => {
    window.localStorage.setItem(
      `${CLOUD_BACKUP_META_KEY_PREFIX}p3`,
      JSON.stringify({ lastCloudBackupAt: 42, backedUpFingerprint: "keep" })
    );
    expect(readCloudBackupMeta("p3")).toEqual({
      lastCloudBackupAt: null,
      backedUpFingerprint: "keep"
    });
  });

  it("keys meta per project", () => {
    writeCloudBackupMeta("a", { lastCloudBackupAt: "t", backedUpFingerprint: "fa" });
    writeCloudBackupMeta("b", { lastCloudBackupAt: "t", backedUpFingerprint: "fb" });
    expect(readCloudBackupMeta("a").backedUpFingerprint).toBe("fa");
    expect(readCloudBackupMeta("b").backedUpFingerprint).toBe("fb");
  });

  it("deletes a stored meta record", () => {
    writeCloudBackupMeta("p1", {
      lastCloudBackupAt: "2026-07-19T00:00:00Z",
      backedUpFingerprint: "abc"
    });
    deleteCloudBackupMeta("p1");
    expect(readCloudBackupMeta("p1")).toEqual({
      lastCloudBackupAt: null,
      backedUpFingerprint: null
    });
  });

  it("tolerates deleting a missing key", () => {
    expect(() => deleteCloudBackupMeta("missing")).not.toThrow();
    expect(readCloudBackupMeta("missing")).toEqual({
      lastCloudBackupAt: null,
      backedUpFingerprint: null
    });
  });
});
