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

  // A 600×400 work on a 300×300 pedestal with overhang off: the load
  // normaliser has to grow the pedestal to contain the work.
  function withUndersizedPedestal(id: string) {
    const base = createBlankProject("Supported");
    return {
      ...base,
      id,
      floorObjects: [
        {
          id: "fo-1",
          kind: "artwork" as const,
          artworkId: "art-1",
          xMm: 1000,
          yMm: 1000,
          widthMm: 600,
          depthMm: 400,
          heightMm: 900,
          rotationDeg: 0,
          wallYMm: 1450,
          support: {
            kind: "pedestal" as const,
            widthMm: 300,
            depthMm: 300,
            heightMm: 1100
          }
        }
      ]
    };
  }

  it("counts a support the load normaliser had to re-fit, and hands back the repaired document", async () => {
    const { IndexedDbProjectRepository } = await freshRepositoryModule();
    const repository = new IndexedDbProjectRepository();
    await repository.save(withUndersizedPedestal("supported-project-id"));

    const { project, supportRepairCount } =
      await repository.loadWithReport("supported-project-id");

    expect(supportRepairCount).toBe(1);
    const object = project.floorObjects[0];
    expect(object.kind === "artwork" ? object.support : undefined).toMatchObject({
      widthMm: 600,
      depthMm: 400
    });
  });

  it("reports nothing for a document with no repairs, and `load` is the same read without the count", async () => {
    const { IndexedDbProjectRepository } = await freshRepositoryModule();
    const repository = new IndexedDbProjectRepository();
    await repository.save({ ...createBlankProject("Plain"), id: "plain-project-id" });

    const report = await repository.loadWithReport("plain-project-id");
    const loaded = await repository.load("plain-project-id");

    expect(report.supportRepairCount).toBe(0);
    expect(loaded).toEqual(report.project);
  });
});
