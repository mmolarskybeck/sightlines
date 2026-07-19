// Persistence contract for silent recovery snapshots of the project document.
// A snapshot is a defensive copy taken on open and periodically while editing;
// it lives OUTSIDE project persistence, undo history, and `.sightlines`
// packages. It shares the IndexedDB origin, so it protects against a malformed
// record or a bad migration — not eviction — and is surfaced only when a
// project fails to load ("restore a previous copy?").

import type { Project } from "../project";
import { newId } from "../id";

// Retention: keep the newest N distinct-fingerprint snapshots per project.
export const SNAPSHOTS_PER_PROJECT = 5;

// Minimum spacing between interval snapshots of one project, so a steady stream
// of saves can't flush meaningful history.
export const SNAPSHOT_MIN_INTERVAL_MS = 10 * 60_000;

// The stored document plus the metadata a recovery search needs without
// parsing the whole project.
export type ProjectSnapshotRecord = {
  projectId: string;
  createdAt: string;
  projectTitle: string;
  fingerprint: string;
  project: Project;
};

// Newest-first metadata, without the (potentially large) project payload.
export type ProjectSnapshotSummary = {
  key: string;
  createdAt: string;
  projectTitle: string;
  fingerprint: string;
};

// One place defines the composite-key convention. `${projectId}:${createdAtISO}`
// makes a project's snapshots a contiguous, chronologically-sorted range (the
// ':' separator sorts below every id character and ids are fixed-length, so no
// project id is a prefix of another — see deleteByProject). The trailing id
// keeps keys unique when two snapshots land in the same millisecond.
export function projectSnapshotKey(projectId: string, createdAtISO: string): string {
  return `${projectId}:${createdAtISO}:${newId()}`;
}

export interface ProjectSnapshotRepository {
  // Records a snapshot, skipping (no-op) when the newest existing snapshot for
  // the project already has this fingerprint, then prunes to SNAPSHOTS_PER_PROJECT
  // — all in one readwrite transaction.
  add(record: ProjectSnapshotRecord): Promise<void>;
  // Newest-first metadata for one project.
  listByProject(projectId: string): Promise<ProjectSnapshotSummary[]>;
  get(key: string): Promise<ProjectSnapshotRecord | undefined>;
  // A project's snapshots die with the project (export-spec §6.3).
  deleteByProject(projectId: string): Promise<void>;
}
