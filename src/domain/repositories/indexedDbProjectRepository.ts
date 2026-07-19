import { migrateProject, parseProject } from "../schema/projectSchema";
import type { Project, ProjectSummary } from "../project";
import type { ProjectRepository } from "./projectRepository";
import { openDatabase, PROJECT_STORE, requestToPromise, transactionDone } from "./database";

// A loaded record exists but fails to parse or migrate to the current schema —
// a malformed document or a migration that can't run. Distinct from operational
// IDB failures (a transient read error, a closed connection), which propagate
// unchanged. Recovery is offered ONLY for this typed failure: a transient read
// error must not substitute a snapshot for a document that is actually fine.
export class ProjectValidationError extends Error {
  constructor(
    message: string,
    readonly projectId: string,
    override readonly cause?: unknown
  ) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

export class IndexedDbProjectRepository implements ProjectRepository {
  async load(id: string): Promise<Project> {
    const db = await openDatabase();
    // Operational IDB errors here (read failure, closed connection) propagate
    // as-is — they are not a corruption signal.
    const value = await requestToPromise<unknown>(
      db.transaction(PROJECT_STORE, "readonly").objectStore(PROJECT_STORE).get(id)
    );

    if (!value) {
      throw new Error(`Project not found: ${id}`);
    }

    // Parse/migration failures are the corruption signal — wrap them so callers
    // can offer recovery without catching every possible load error.
    try {
      return migrateProject(value);
    } catch (error) {
      throw new ProjectValidationError(
        error instanceof Error ? error.message : "the project could not be read.",
        id,
        error
      );
    }
  }

  async save(project: Project): Promise<void> {
    // Never persist a document that fails the current schema — invalid state
    // written here would poison every future load.
    parseProject(project);

    const db = await openDatabase();
    const tx = db.transaction(PROJECT_STORE, "readwrite");
    tx.objectStore(PROJECT_STORE).put(project);
    await transactionDone(tx);
  }

  async list(): Promise<ProjectSummary[]> {
    const db = await openDatabase();
    const values = await requestToPromise<unknown[]>(
      db.transaction(PROJECT_STORE, "readonly")
        .objectStore(PROJECT_STORE)
        .getAll()
    );

    // Summaries read raw fields rather than fully validating every document:
    // a corrupt record still shows up in the list (and fails loudly on load)
    // instead of silently taking the whole list down with it.
    return values
      .flatMap((value) => {
        const summary = toProjectSummary(value);

        if (!summary) {
          console.warn("Skipping unreadable project record in list()", value);
          return [];
        }

        return [summary];
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(id: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(PROJECT_STORE, "readwrite");
    tx.objectStore(PROJECT_STORE).delete(id);
    await transactionDone(tx);
  }
}

function toProjectSummary(value: unknown): ProjectSummary | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;

  const floor = typeof record.floor === "object" && record.floor !== null
    ? (record.floor as Record<string, unknown>)
    : null;
  const rooms = floor && Array.isArray(floor.rooms) ? floor.rooms : [];
  const checklistArtworkIds = Array.isArray(record.checklistArtworkIds)
    ? record.checklistArtworkIds
    : [];

  return {
    id: record.id,
    title: typeof record.title === "string" ? record.title : "Untitled",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    roomCount: rooms.length,
    artworkCount: checklistArtworkIds.length
  };
}
