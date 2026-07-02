import { migrateProject, parseProject } from "../schema/projectSchema";
import type { Project, ProjectSummary } from "../project";
import type { ProjectRepository } from "./projectRepository";

const DB_NAME = "sightlines";
const DB_VERSION = 1;
const PROJECT_STORE = "projects";

export class IndexedDbProjectRepository implements ProjectRepository {
  async load(id: string): Promise<Project> {
    const db = await openDatabase();
    const value = await requestToPromise<unknown>(
      db.transaction(PROJECT_STORE, "readonly").objectStore(PROJECT_STORE).get(id)
    );

    if (!value) {
      throw new Error(`Project not found: ${id}`);
    }

    return migrateProject(value);
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

  return {
    id: record.id,
    title: typeof record.title === "string" ? record.title : "Untitled",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : ""
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}
