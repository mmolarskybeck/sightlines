import type { Project, ProjectSummary } from "../project";

export interface ProjectRepository {
  load(id: string): Promise<Project>;
  // Insert without replacing an existing record. The storage implementation
  // must make the existence check and insert one atomic operation so two tabs
  // cannot both decide the id is free and then overwrite one another.
  create(project: Project): Promise<boolean>;
  save(project: Project): Promise<void>;
  list(): Promise<ProjectSummary[]>;
  delete(id: string): Promise<void>;
}
