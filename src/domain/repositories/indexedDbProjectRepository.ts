import { migrateProjectWithReport, parseProject } from "../schema/projectSchema";
import type { Project, ProjectSummary } from "../project";
import type { ProjectLoadReport, ProjectRepository } from "./projectRepository";
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
    return (await this.loadWithReport(id)).project;
  }

  // The same read as `load`, keeping the load report instead of dropping it, so
  // an ordinary open can announce a support repair the way a snapshot restore
  // and a JSON import already do.
  async loadWithReport(id: string): Promise<ProjectLoadReport> {
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
      const { project, supportRepairCount, stored } = migrateProjectWithReport(value);
      return { project, supportRepairCount, stored };
    } catch (error) {
      throw new ProjectValidationError(
        error instanceof Error ? error.message : "the project could not be read.",
        id,
        error
      );
    }
  }

  async create(project: Project): Promise<boolean> {
    // `add`, unlike `put`, fails when the inline project id already exists. That
    // makes the link-import backstop atomic across tabs instead of a list-then-
    // save check with a race in between.
    parseProject(project);

    const db = await openDatabase();
    const tx = db.transaction(PROJECT_STORE, "readwrite");
    const done = transactionDone(tx);
    try {
      await requestToPromise(tx.objectStore(PROJECT_STORE).add(project));
      await done;
      return true;
    } catch (error) {
      // Consume the transaction's abort rejection when the request itself was
      // the failure we observed above.
      await done.catch(() => undefined);
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "ConstraintError"
      ) {
        return false;
      }
      throw error;
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
