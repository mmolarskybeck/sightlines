import { describe, expect, it } from "vitest";
import type { DropboxFileEntry } from "./dropboxAuth";
import {
  buildStorageInventory,
  isDeletableStoragePath,
  parseSpaceUsage,
  parseStorageSettings,
  serializeStorageSettings
} from "./dropboxInventory";

const ID_A = "1234abcd-0000-4000-8000-000000000000";
const ID_B = "1234abcd-1111-4000-8000-000000000000";

function file(path: string, size = 10, modified = "2026-01-01T00:00:00Z", rev = "r"): DropboxFileEntry {
  return {
    ".tag": "file",
    name: path.split("/").pop()!,
    path_display: path,
    path_lower: path.toLowerCase(),
    size,
    server_modified: modified,
    rev
  };
}

const build = (entries: DropboxFileEntry[]) => buildStorageInventory(entries, null, "now");

describe("buildStorageInventory", () => {
  it("makes a head-only project one group", () => {
    const inv = build([file(`/projects/${ID_A}/current.sightlines`)]);
    expect(inv.groups).toHaveLength(1);
    expect(inv.groups[0]).toMatchObject({ key: ID_A, projectId: ID_A, idPrefix: "1234abcd", title: null });
    expect(inv.groups[0].head).not.toBeNull();
  });

  it("joins a titled backup folder to its head group, newest first", () => {
    const inv = build([
      file(`/projects/${ID_A}/current.sightlines`),
      file("/backups/Show A — 1234abcd/a.sightlines", 1, "2026-01-01T00:00:00Z"),
      file("/backups/Show A — 1234abcd/b.sightlines", 1, "2026-03-01T00:00:00Z"),
      file("/backups/Show A — 1234abcd/c.sightlines", 1, "2026-02-01T00:00:00Z")
    ]);
    expect(inv.groups).toHaveLength(1);
    const g = inv.groups[0];
    expect(g.title).toBe("Show A");
    expect(g.backupFolders).toHaveLength(1);
    expect(g.backupFolders[0].backups.map((f) => f.name)).toEqual(["b.sightlines", "c.sightlines", "a.sightlines"]);
  });

  it("joins share folders and lets the backup title win", () => {
    const inv = build([
      file(`/projects/${ID_A}/current.sightlines`),
      file("/shares/Other Name — 1234abcd/s.sightlines"),
      file("/backups/Show A — 1234abcd/a.sightlines")
    ]);
    expect(inv.groups).toHaveLength(1);
    expect(inv.groups[0].title).toBe("Show A");
    expect(inv.groups[0].shares).toHaveLength(1);
  });

  it("does not guess between two heads sharing a prefix", () => {
    const inv = build([
      file(`/projects/${ID_A}/current.sightlines`),
      file(`/projects/${ID_B}/current.sightlines`),
      file("/backups/Show A — 1234abcd/a.sightlines")
    ]);
    expect(inv.groups.map((g) => g.key).sort()).toEqual([ID_A, ID_B, "prefix:1234abcd"].sort());
    const orphan = inv.groups.find((g) => g.key === "prefix:1234abcd")!;
    expect(orphan.projectId).toBeNull();
    expect(orphan.backupFolders).toHaveLength(1);
  });

  it("joins a bare-uuid folder to the head and may hold two folders", () => {
    const inv = build([
      file(`/projects/${ID_A}/current.sightlines`),
      file(`/backups/${ID_A}/old.sightlines`),
      file("/backups/Show A — 1234abcd/new.sightlines")
    ]);
    expect(inv.groups).toHaveLength(1);
    expect(inv.groups[0].backupFolders).toHaveLength(2);
  });

  it("keys unparseable folders by name", () => {
    const inv = build([file("/backups/Random/a.sightlines")]);
    expect(inv.groups[0]).toMatchObject({ key: "folder:backups:random", title: "Random" });
  });

  it("excludes settings and routes unknown shapes to otherFiles", () => {
    const inv = build([
      file("/settings/storage.json"),
      file("/blobs/abc"),
      file("/projects/not-a-uuid/current.sightlines"),
      file("/backups/x.sightlines")
    ]);
    expect(inv.groups).toHaveLength(0);
    expect(inv.otherFiles.map((f) => f.path).sort()).toEqual(
      ["/backups/x.sightlines", "/blobs/abc", "/projects/not-a-uuid/current.sightlines"].sort()
    );
  });

  it("skips folders and orders groups by total bytes", () => {
    const inv = build([
      { ".tag": "folder", name: "backups", path_lower: "/backups" },
      file("/backups/Small — aaaaaaaa/a.sightlines", 5),
      file("/backups/Big — bbbbbbbb/a.sightlines", 500)
    ]);
    expect(inv.groups.map((g) => g.title)).toEqual(["Big", "Small"]);
  });
});

describe("parseSpaceUsage", () => {
  it("reads individual and team allocations", () => {
    expect(parseSpaceUsage({ used: 5, allocation: { ".tag": "individual", allocated: 100 } })).toEqual({ usedBytes: 5, allocatedBytes: 100 });
    expect(parseSpaceUsage({ used: 5, allocation: { ".tag": "team", allocated: 200 } })).toEqual({ usedBytes: 5, allocatedBytes: 200 });
  });
  it("tolerates a missing allocation and rejects garbage", () => {
    expect(parseSpaceUsage({ used: 5 })).toEqual({ usedBytes: 5, allocatedBytes: null });
    expect(parseSpaceUsage("nope")).toBeNull();
    expect(parseSpaceUsage({ used: "5" })).toBeNull();
    expect(parseSpaceUsage(null)).toBeNull();
  });
});

describe("isDeletableStoragePath", () => {
  it("accepts backup and share snapshots", () => {
    expect(isDeletableStoragePath("/backups/Show/a.sightlines")).toBe(true);
    expect(isDeletableStoragePath("/Shares/Show/A.SIGHTLINES")).toBe(true);
  });
  it("rejects everything else", () => {
    for (const p of [
      `/projects/${ID_A}/current.sightlines`,
      "/backups/a/b/c.sightlines",
      "/backups/../a.sightlines",
      "/shares/a/../x.sightlines",
      "/backups/./a.sightlines",
      "/settings/storage.json",
      "/backups/a/b.txt"
    ]) {
      expect(isDeletableStoragePath(p)).toBe(false);
    }
  });
});

describe("storage settings", () => {
  it("round-trips", () => {
    const text = serializeStorageSettings({ backupsPerProject: 3 }, "2026-01-01T00:00:00Z");
    expect(parseStorageSettings(text)).toEqual({ backupsPerProject: 3 });
  });
  it("rejects bad versions, values, and JSON", () => {
    expect(parseStorageSettings(JSON.stringify({ version: 2, backupsPerProject: 3 }))).toBeNull();
    for (const v of [0, 6, 11, 2.5, "2"]) {
      expect(parseStorageSettings(JSON.stringify({ version: 1, backupsPerProject: v }))).toBeNull();
    }
    expect(parseStorageSettings("{nope")).toBeNull();
    expect(parseStorageSettings("null")).toBeNull();
  });
});
