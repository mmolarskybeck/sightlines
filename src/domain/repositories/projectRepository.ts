import type { Project, ProjectSummary } from "../project";

export interface ProjectRepository {
  load(id: string): Promise<Project>;
  save(project: Project): Promise<void>;
  list(): Promise<ProjectSummary[]>;
  delete(id: string): Promise<void>;
}
