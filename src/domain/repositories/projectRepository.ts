import type { Project, ProjectSummary } from "../project";

// What a load had to change on the way in. Today that is only the floor-support
// normaliser (geometry/supportGlyphs.ts, run at the load boundary by
// migrateProjectWithReport): a pedestal narrower than the work standing on it,
// an offset that had detached it, a stale bonnet height. The document is
// normalised either way — the count exists so an ordinary open can SAY so
// instead of silently redrawing someone's pedestal.
export type ProjectLoadReport = {
  project: Project;
  supportRepairCount: number;
  // The document as storage holds it, before the support repair; the SAME
  // reference as `project` when nothing was repaired. The open path snapshots
  // this one and persists `project` when the two differ, so a repair is written
  // back once instead of being re-done (and re-announced) on every open.
  stored: Project;
};

export interface ProjectRepository {
  load(id: string): Promise<Project>;
  // `load` plus what the load normaliser had to repair. Same document, same
  // failures (including ProjectValidationError) — a sibling rather than a
  // change to `load`, so the many callers that have nothing to say about a
  // repair keep the simpler signature.
  loadWithReport(id: string): Promise<ProjectLoadReport>;
  // Insert without replacing an existing record. The storage implementation
  // must make the existence check and insert one atomic operation so two tabs
  // cannot both decide the id is free and then overwrite one another.
  create(project: Project): Promise<boolean>;
  save(project: Project): Promise<void>;
  list(): Promise<ProjectSummary[]>;
  delete(id: string): Promise<void>;
}
