import type { Project } from "../domain/project";

// Test-only helper: serializes a project the same way a real export would,
// used by store.test.ts to exercise JSON-migration round-trips. Not
// reachable from production code, so it lives here rather than in the store.
export function exportProjectJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}
