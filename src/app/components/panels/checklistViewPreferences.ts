import type { Artwork, ChecklistSort, ChecklistViewPreferences } from "../../../domain/project";
import { compareChecklistText } from "../../../domain/checklistExport/sort";

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

export type ChecklistRowData = {
  artworkId: string;
  artwork: Artwork | null;
  isPlaced: boolean;
  projectIndex: number;
  // The wall a placed artwork lives on, resolved to a human name — null when
  // unplaced, or when the placement points at a wall that no longer exists.
  wallName: string | null;
  // Every placement (wall or floor) referencing this artwork — in practice
  // there's at most one, but the menu's "Remove from wall" removes all of
  // them so a row never ends up half-unplaced.
  placementIds: string[];
};

export type ChecklistArtistGroup = {
  key: string;
  label: string;
  rows: ChecklistRowData[];
};

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

export function sortChecklistRows(
  rows: ChecklistRowData[],
  sort: ChecklistSort
): ChecklistRowData[] {
  return [...rows].sort((a, b) => {
    switch (sort) {
      case "title":
        return compareChecklistText(a.artwork?.title, b.artwork?.title) || byProjectOrder(a, b);
      case "artist":
        return (
          compareChecklistText(a.artwork?.artist, b.artwork?.artist) ||
          compareChecklistText(a.artwork?.title, b.artwork?.title) ||
          byProjectOrder(a, b)
        );
      case "status":
        return Number(a.isPlaced) - Number(b.isPlaced) || byProjectOrder(a, b);
      case "project":
      default:
        return byProjectOrder(a, b);
    }
  });
}

export function checklistRowMatchesQuery(row: ChecklistRowData, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  if (!row.artwork) return false;

  const artwork = row.artwork;
  const searchableText = [
    artwork.title,
    artwork.artist,
    artwork.date,
    artwork.accessionNumber,
    artwork.locationOrLender,
    ...Object.values(artwork.metadata)
  ]
    .filter((value) => value !== undefined)
    .map(String)
    .join("\n")
    .toLocaleLowerCase();

  return terms.every((term) => searchableText.includes(term));
}

export function groupChecklistRowsByArtist(
  rows: ChecklistRowData[]
): ChecklistArtistGroup[] {
  const groups = new Map<string, ChecklistArtistGroup>();
  for (const row of rows) {
    const identity = artistGroupIdentity(row);
    const existing = groups.get(identity.key);
    if (existing) existing.rows.push(row);
    else groups.set(identity.key, { ...identity, rows: [row] });
  }
  return [...groups.values()];
}

export function artistGroupIdentity(row: ChecklistRowData): { key: string; label: string } {
  const artist = row.artwork?.artist?.trim();
  if (!artist) return { key: "missing-artist", label: "Artist not recorded" };
  return { key: `artist:${artist.toLocaleLowerCase()}`, label: artist };
}

function byProjectOrder(a: ChecklistRowData, b: ChecklistRowData) {
  return a.projectIndex - b.projectIndex;
}
