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
