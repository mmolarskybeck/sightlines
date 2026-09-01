import type {
  ChecklistSort,
  ChecklistViewPreferences
} from "../../../domain/project";

// The checklist panel's sort/grouping preference. The choice itself lives ON
// THE PROJECT (`project.checklistView`, USER DECISION 2026-08-31) so it rides
// `.sightlines` packages and cloud sync; this module owns what happens when
// the project carries no choice yet.
//
// Filter tabs, search, and collapsed artist groups stay temporary session
// state in the panel: they answer "what am I looking for right now", while
// sort and grouping answer "how do I read this checklist", which belongs to
// the exhibition.

export type { ChecklistSort, ChecklistViewPreferences };

export const CHECKLIST_SORTS: ChecklistSort[] = [
  "project",
  "title",
  "artist",
  "status"
];

// Group-by-artist is the natural reading of a group show: at least two
// artists each contributing more than one work. A solo show, or a survey of
// one-work-per-artist, reads better flat. Blank/unrecorded artists never
// count toward the threshold — "Artist not recorded" twice is not a group.
export function shouldDefaultToArtistGrouping(
  rows: readonly { artwork: { artist?: string } | null }[]
): boolean {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const artist = row.artwork?.artist?.trim();
    if (!artist) continue;
    const key = artist.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let artistsWithMultipleWorks = 0;
  for (const count of counts.values()) {
    if (count >= 2) artistsWithMultipleWorks += 1;
    if (artistsWithMultipleWorks >= 2) return true;
  }
  return false;
}

// The view to use when the project records no explicit choice. Applied live:
// a checklist that becomes a group show mid-session groups itself, until the
// curator's first explicit choice writes `project.checklistView` and
// permanently supersedes this.
export function defaultChecklistView(
  rows: readonly { artwork: { artist?: string } | null }[]
): ChecklistViewPreferences {
  return shouldDefaultToArtistGrouping(rows)
    ? { sort: "artist", groupByArtist: true }
    : { sort: "project", groupByArtist: false };
}
