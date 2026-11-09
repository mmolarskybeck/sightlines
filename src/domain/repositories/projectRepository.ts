import type { Project, ProjectSummary } from "../project";

// What a load produced. There is no load-boundary repair any more (supports
// became ordinary floor objects in schema v8, so nothing is re-fitted on the
// way in) — the report survives because the open path still needs to know what
// storage holds as distinct from what it is about to render.
export type ProjectLoadReport = {
  project: Project;
  // The document as storage holds it. The SAME reference as `project` today;
  // kept separate so a future load-boundary rewrite has somewhere to land
  // without changing every caller again.
  stored: Project;
};

export interface ProjectRepository {
  load(id: string): Promise<Project>;
  // `load` plus the load report. Same document, same failures (including
  // ProjectValidationError) — a sibling rather than a change to `load`, so the
  // many callers that only want the project keep the simpler signature.
  loadWithReport(id: string): Promise<ProjectLoadReport>;
  // Insert without replacing an existing record. The storage implementation
  // must make the existence check and insert one atomic operation so two tabs
  // cannot both decide the id is free and then overwrite one another.
  create(project: Project): Promise<boolean>;
  save(project: Project): Promise<void>;
  list(): Promise<ProjectSummary[]>;
  delete(id: string): Promise<void>;
}
