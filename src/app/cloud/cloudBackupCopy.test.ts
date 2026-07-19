import { describe, expect, it } from "vitest";
import {
  formatBackupRelativeTime,
  getCloudBackupPopoverLine
} from "./cloudBackupCopy";

const NOW = Date.parse("2026-07-19T12:00:00Z");

describe("formatBackupRelativeTime", () => {
  it("reads just now / minutes / hours / days", () => {
    expect(formatBackupRelativeTime("2026-07-19T11:59:40Z", NOW)).toBe("just now");
    expect(formatBackupRelativeTime("2026-07-19T11:58:00Z", NOW)).toBe("2 m ago");
    expect(formatBackupRelativeTime("2026-07-19T09:00:00Z", NOW)).toBe("3 h ago");
    expect(formatBackupRelativeTime("2026-07-14T12:00:00Z", NOW)).toBe("5 d ago");
  });

  it("degrades to 'recently' for an unparseable timestamp", () => {
    expect(formatBackupRelativeTime("not-a-date", NOW)).toBe("recently");
  });
});

describe("getCloudBackupPopoverLine", () => {
  const base = {
    configured: true,
    status: "connected" as const,
    lastCloudBackupAt: "2026-07-19T11:58:00Z",
    pending: false,
    now: NOW
  };

  it("returns null when unconfigured", () => {
    expect(getCloudBackupPopoverLine({ ...base, configured: false })).toBeNull();
  });

  it("names the reauth and disconnected states", () => {
    expect(
      getCloudBackupPopoverLine({ ...base, status: "reauthorization-required" })
    ).toContain("Reconnect Dropbox");
    expect(getCloudBackupPopoverLine({ ...base, status: "disconnected" })).toContain(
      "connect in Storage settings"
    );
  });

  it("prefers the pending line over the last-backup time", () => {
    expect(getCloudBackupPopoverLine({ ...base, pending: true })).toBe(
      "Changes waiting to back up."
    );
  });

  it("shows the relative last-backup time when connected and settled", () => {
    expect(getCloudBackupPopoverLine(base)).toBe("Backed up to Dropbox 2 m ago.");
  });

  it("handles connected-but-never-backed-up", () => {
    expect(
      getCloudBackupPopoverLine({ ...base, lastCloudBackupAt: null })
    ).toContain("waiting for the first backup");
  });
});
