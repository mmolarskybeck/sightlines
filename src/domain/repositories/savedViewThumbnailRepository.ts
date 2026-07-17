// Persistence contract for the Saved-view thumbnail cache (saved-views spec
// §3.2). A thumbnail is a derived cache OUTSIDE the project: it renders the
// current exhibition from a Saved view's stored pose and never enters project
// JSON, undo history, or `.sightlines` packages. Entries are keyed per
// (project, view) and stamped with the project's `updatedAt` at render time so
// freshness is a plain equality check (§3.3).

// The rendered PNG plus the project `updatedAt` it was rendered against.
export type SavedViewThumbnailRecord = {
  blob: Blob;
  projectUpdatedAt: string;
};

// One place defines the composite-key convention rather than each caller
// string-templating it. The ':' separator sorts below every id character, and
// project/view ids are fixed-length, so a project's keys form a contiguous
// range with no risk of one project id being a prefix of another (see
// deleteByProject).
export function savedViewThumbnailKey(projectId: string, viewId: string): string {
  return `${projectId}:${viewId}`;
}

export interface SavedViewThumbnailRepository {
  get(
    projectId: string,
    viewId: string
  ): Promise<SavedViewThumbnailRecord | undefined>;
  put(
    projectId: string,
    viewId: string,
    record: SavedViewThumbnailRecord
  ): Promise<void>;
  // A view's entry dies with the view, by any path (§3.2): explicit delete,
  // undo of a save. Undoing the deletion recreates it lazily.
  deleteByView(projectId: string, viewId: string): Promise<void>;
  // A project's entries die with the project, alongside its workspace records
  // (export-spec §6.3).
  deleteByProject(projectId: string): Promise<void>;
}
