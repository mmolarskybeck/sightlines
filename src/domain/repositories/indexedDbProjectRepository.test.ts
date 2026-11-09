import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankProject } from "../newProject";

async function freshRepositoryModule() {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  return import("./indexedDbProjectRepository");
}

describe("IndexedDbProjectRepository create", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("atomically lets only one tab create a project id", async () => {
    const { IndexedDbProjectRepository } = await freshRepositoryModule();
    const firstRepository = new IndexedDbProjectRepository();
    const secondRepository = new IndexedDbProjectRepository();
    const base = { ...createBlankProject("Base"), id: "shared-project-id" };

    const outcomes = await Promise.all([
      firstRepository.create({ ...base, title: "Created in the first tab" }),
      secondRepository.create({ ...base, title: "Created in the second tab" })
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect((await firstRepository.load(base.id)).title).toBe(
      outcomes[0] ? "Created in the first tab" : "Created in the second tab"
    );
  });
});

// loadWithReport is the everyday open's way of hearing what the load boundary
// had to change. The read itself is the same read `load` does.
describe("IndexedDbProjectRepository loadWithReport", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands back the same document from loadWithReport and load", async () => {
    const { IndexedDbProjectRepository } = await freshRepositoryModule();
    const repository = new IndexedDbProjectRepository();
    await repository.save({ ...createBlankProject("Plain"), id: "plain-project-id" });

    const report = await repository.loadWithReport("plain-project-id");
    const loaded = await repository.load("plain-project-id");

    expect(report.stored).toEqual(report.project);
    expect(loaded).toEqual(report.project);
  });
});
