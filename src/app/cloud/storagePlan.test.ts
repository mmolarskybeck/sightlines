import { describe, expect, it } from "vitest";
import type { StorageFile, StorageInventory, StorageProjectGroup } from "./provider";
import { confirmTrimAgainstFresh, planBackupTrim, storageGroupTotals } from "./storagePlan";

function f(path: string, day: number, size = 10, rev: string | null = "r"): StorageFile {
  return {
    path,
    name: path.split("/").pop()!,
    sizeBytes: size,
    serverModifiedIso: `2026-01-${String(day).padStart(2, "0")}T00:00:00Z`,
    rev
  };
}

function group(overrides: Partial<StorageProjectGroup>): StorageProjectGroup {
  return { key: "k", projectId: null, idPrefix: "", title: null, head: null, backupFolders: [], shares: [], ...overrides };
}

function inventory(groups: StorageProjectGroup[]): StorageInventory {
  return { groups, otherFiles: [], usage: null, listedAtIso: "now" };
}

const folderA = {
  path: "/backups/A",
  folderName: "A",
  backups: [f("/backups/A/4.sightlines", 4), f("/backups/A/3.sightlines", 3), f("/backups/A/2.sightlines", 2), f("/backups/A/1.sightlines", 1)]
};
const folderB = {
  path: "/backups/B",
  folderName: "B",
  backups: [f("/backups/B/3.sightlines", 3, 7), f("/backups/B/2.sightlines", 2, 7), f("/backups/B/1.sightlines", 1, 7)]
};

describe("planBackupTrim", () => {
  const inv = inventory([
    group({ backupFolders: [folderA, folderB], head: f("/projects/x/current.sightlines", 5, 99), shares: [f("/shares/S/s.sightlines", 1, 50)] })
  ]);

  it("keeps newest N per folder and excludes heads and shares", () => {
    const plan = planBackupTrim(inv, 2);
    expect(plan.folders).toHaveLength(2);
    expect(plan.folders[0].remove.map((x) => x.name)).toEqual(["2.sightlines", "1.sightlines"]);
    expect(plan.folders[1].remove.map((x) => x.name)).toEqual(["1.sightlines"]);
    expect(plan.removeCount).toBe(3);
    expect(plan.reclaimableBytes).toBe(10 + 10 + 7);
  });

  it("omits folders with nothing to remove and rejects invalid keep", () => {
    expect(planBackupTrim(inv, 5).folders).toHaveLength(0);
    expect(() => planBackupTrim(inv, 0)).toThrow(RangeError);
  });
});

describe("confirmTrimAgainstFresh", () => {
  const previewed = planBackupTrim(inventory([group({ backupFolders: [folderA] })]), 2);

  it("keeps files present and unchanged in the fresh plan, case-insensitively", () => {
    const fresh = planBackupTrim(
      inventory([group({ backupFolders: [{ ...folderA, backups: folderA.backups.map((b) => ({ ...b, path: b.path.toUpperCase() })) }] })]),
      2
    );
    expect(confirmTrimAgainstFresh(previewed, fresh)).toHaveLength(2);
  });

  it("drops a changed rev and a no-longer-selected file", () => {
    const changed = folderA.backups.map((b) => (b.name === "2.sightlines" ? { ...b, rev: "other" } : b));
    const fresh = planBackupTrim(inventory([group({ backupFolders: [{ ...folderA, backups: changed }] })]), 3);
    // keep 3 -> only 1.sightlines is selected; 2.sightlines is no longer selected either way
    expect(confirmTrimAgainstFresh(previewed, fresh).map((x) => x.name)).toEqual(["1.sightlines"]);
    const fresh2 = planBackupTrim(inventory([group({ backupFolders: [{ ...folderA, backups: changed }] })]), 2);
    expect(confirmTrimAgainstFresh(previewed, fresh2).map((x) => x.name)).toEqual(["1.sightlines"]);
  });
});

describe("storageGroupTotals", () => {
  it("sums head, backups, and shares", () => {
    const totals = storageGroupTotals(
      group({ head: f("/h", 1, 100), backupFolders: [folderA, folderB], shares: [f("/s", 1, 5), f("/s2", 1, 5)] })
    );
    expect(totals).toEqual({
      headBytes: 100,
      backupCount: 7,
      backupBytes: 40 + 21,
      shareCount: 2,
      shareBytes: 10,
      totalBytes: 100 + 61 + 10
    });
  });
});
