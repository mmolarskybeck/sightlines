import { migrateProject } from "../schema/projectSchema";
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

    return values
      .map((value) => migrateProject(value))
      .map((project) => ({
        id: project.id,
        title: project.title,
        updatedAt: project.updatedAt
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(id: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(PROJECT_STORE, "readwrite");
    tx.objectStore(PROJECT_STORE).delete(id);
    await transactionDone(tx);
  }
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
