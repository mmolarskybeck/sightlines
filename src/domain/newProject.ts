import { CURRENT_SCHEMA_VERSION, type Project } from "./project";
import { feetToMm, inchesToMm } from "./units/length";

// A brand-new project starts with an empty floor, not a pre-populated
// sample room — per docs/plan.md §1.5, defining room layout and building
// the checklist are two equally valid starting points, and neither should
// be forced on the other.
export function createBlankProject(title: string): Project {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title,
    unit: "ft",
    defaultWallHeightMm: feetToMm(12),
    defaultCenterlineHeightMm: inchesToMm(57),
    checklistArtworkIds: [],
    wallObjects: [],
    floorObjects: [],
    createdAt: now,
    updatedAt: now,
    floor: {
      rooms: []
    }
  };
}
