import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { ImageSquareIcon } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { ACCEPTED_IMAGE_MIME_TYPES } from "../../../domain/assets/imageIntake";
import type { Artwork, DisplayUnit, Project, ProjectSummary } from "../../../domain/project";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../../domain/units/unitSystem";
import { useAssetImageUrls } from "../../hooks/useAssetImageUrls";
import { ArtworkBulkBar } from "./ArtworkBulkBar";
import { ArtworkTable, type ArtworkTableRow, type SortDirection } from "./ArtworkTable";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "../ui/segmented";

type LibraryFilter = "all" | "in-project" | "not-in-project";
type LibrarySort = "title" | "artist" | "date";

type LibraryCommonProps = {
  artworks: Artwork[];
  project: Project;
  getBlob: (key: string) => Promise<Blob>;
};

export function ArtworkLibraryView({
  artworks,
  project,
  getBlob,
  onAddToChecklist,
  onDeleteArtworks,
  onAddFiles,
  onOpenImportWizard,
  pendingDuplicateUploads = [],
  onConfirmDuplicateUploads,
  onDismissDuplicateUploads,
  projectMembershipsByArtworkId,
  onOpenProject,
  onEditArtwork,
  onRevealInspector,
  onDuplicateArtworks,
  checked: checkedProp,
  onCheckedChange
}: LibraryCommonProps & {
  onAddToChecklist: (artworkIds: string[]) => void | Promise<void>;
  onDeleteArtworks?: (artworkIds: string[]) => void | Promise<void>;
  onAddFiles?: (files: File[]) => void | Promise<void>;
  onOpenImportWizard: () => void;
  pendingDuplicateUploads?: { file: File; existingArtworkTitle: string }[];
  onConfirmDuplicateUploads?: () => void | Promise<void>;
  onDismissDuplicateUploads?: () => void;
  projectMembershipsByArtworkId?: Map<string, ProjectSummary[]> | Record<string, ProjectSummary[]>;
  onOpenProject?: (projectId: string) => void;
  onEditArtwork?: (artworkId: string) => void;
  // Bulk edit (fields + mat & frame) lives in the inspector, which reads the
  // checked set; this only reveals a collapsed inspector.
  onRevealInspector?: () => void;
  onDuplicateArtworks?: (ids: string[]) => void | Promise<unknown>;
  // Controlled checked set (App owns it so the inspector can edit it). Falls
  // back to local state when uncontrolled.
  checked?: Set<string>;
  onCheckedChange?: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<{ key: LibrarySort; direction: SortDirection }>({ key: "title", direction: "ascending" });
  const [localSelected, setLocalSelected] = useState<Set<string>>(() => new Set());
  const selected = checkedProp ?? localSelected;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const setSelected = (update: Set<string> | ((current: Set<string>) => Set<string>)) => {
    const next = typeof update === "function" ? update(selectedRef.current) : update;
    if (next === selectedRef.current) return;
    selectedRef.current = next;
    if (onCheckedChange) onCheckedChange(next);
    else setLocalSelected(next);
  };
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const quickAddInputRef = useRef<HTMLInputElement>(null);
  // Deleted/absent artworks must never linger in the selection (they'd let a
  // stale id ride into a bulk add or delete). Prune whenever the device-level
  // list changes — filtering/sorting is view-only and must not drop a pick.
  useEffect(() => {
    setSelected((current) => {
      const present = new Set(artworks.map((artwork) => artwork.id));
      if ([...current].every((id) => present.has(id))) return current;
      return new Set([...current].filter((id) => present.has(id)));
    });
  }, [artworks]);
  const checklistIds = useMemo(() => new Set(project.checklistArtworkIds), [project.checklistArtworkIds]);
  const matches = useArtworkMatches(artworks, query);
  const rows = useMemo(() => sortArtworks(matches.filter((artwork) => filter === "all" || (filter === "in-project" ? checklistIds.has(artwork.id) : !checklistIds.has(artwork.id))), sort.key, sort.direction), [checklistIds, filter, matches, sort]);
  const tableRows = useMemo<ArtworkTableRow[]>(() => rows.map((artwork) => ({ id: artwork.id, artwork })), [rows]);
  const hiddenCount = [...selected].filter((id) => !rows.some((row) => row.id === id)).length;
  const thumbnails = useAssetImageUrls(artworks.map((artwork) => artwork.assetId), getBlob);
  const unit = artworkDisplayUnit(project.unit);

  return (
    <section
      aria-labelledby="artwork-library-title"
      className="artwork-library-view"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && selected.size > 0 && pendingDeleteIds === null) {
          setSelected(new Set());
        }
      }}
    >
      <header className="artwork-library-header">
        <div>
          <h1 id="artwork-library-title">Artwork Library</h1>
          <p>{artworks.length} work{artworks.length === 1 ? "" : "s"} on this device</p>
        </div>
        <div className="artwork-library-header-actions">
          {onAddFiles ? (
            <>
              {/* Quick path: one image straight into the library, skipping the
                  wizard. Duplicate checks ride the same intake as the wizard's,
                  surfacing in the banner below. */}
              <input
                ref={quickAddInputRef}
                accept={ACCEPTED_IMAGE_MIME_TYPES.join(",")}
                className="visually-hidden"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onAddFiles([file]);
                  // Reset so picking the same file again still fires onChange.
                  event.target.value = "";
                }}
              />
              <Button variant="outline" onClick={() => quickAddInputRef.current?.click()}>
                <PlusIcon aria-hidden="true" size={16} /> Add image
              </Button>
            </>
          ) : null}
          <Button variant="primary" onClick={onOpenImportWizard}>
            <FileArrowUpIcon aria-hidden="true" size={16} /> Import
          </Button>
        </div>
      </header>

      {pendingDuplicateUploads.length > 0 ? (
        <div className="artwork-library-duplicate" role="status">
          <p>
            {pendingDuplicateUploads.length === 1
              ? `This image looks identical to “${pendingDuplicateUploads[0].existingArtworkTitle}” already in the library. Import it anyway?`
              : `${pendingDuplicateUploads.length} images look identical to works already in the library. Import them anyway?`}
          </p>
          <div>
            <Button size="sm" variant="primary" onClick={() => void onConfirmDuplicateUploads?.()}>
              Import anyway
            </Button>
            <Button size="sm" variant="outline" onClick={onDismissDuplicateUploads}>
              Don't import
            </Button>
          </div>
        </div>
      ) : null}

      {artworks.length === 0 ? (
        <div className="artwork-library-empty">
          <ImageSquareIcon aria-hidden="true" size={30} />
          <h2>Build a reusable artwork library</h2>
          <p>Import works once, then add them to any project checklist on this device.</p>
          <Button variant="primary" onClick={onOpenImportWizard}>Import artwork</Button>
        </div>
      ) : (
        <>
          <div className="artwork-library-toolbar">
            <SearchField value={query} onChange={setQuery} />
            <div className="artwork-library-toolbar-secondary">
              <SegmentedToggleGroup
                aria-label="Filter Artwork Library"
                className="artwork-library-filters"
                type="single"
                value={filter}
                onValueChange={(value) => {
                  if (value === "all" || value === "in-project" || value === "not-in-project") {
                    setFilter(value);
                  }
                }}
              >
                <SegmentedToggleGroupItem value="all">All</SegmentedToggleGroupItem>
                <SegmentedToggleGroupItem value="in-project">In checklist</SegmentedToggleGroupItem>
                <SegmentedToggleGroupItem value="not-in-project">Available</SegmentedToggleGroupItem>
              </SegmentedToggleGroup>
              <span className="artwork-library-result-count" aria-live="polite">
                {rows.length} shown
              </span>
            </div>
          </div>
          {selected.size > 0 ? (
            <ArtworkBulkBar
              scope="library"
              variant="full"
              checkedCount={selected.size}
              hiddenCount={hiddenCount}
              onAddToChecklist={() => { void onAddToChecklist([...selected]); setSelected(new Set()); }}
              onEdit={onRevealInspector}
              onDuplicate={() => { void onDuplicateArtworks?.([...selected]); }}
              onDelete={onDeleteArtworks ? () => setPendingDeleteIds([...selected]) : undefined}
              onClear={() => setSelected(new Set())}
            />
          ) : null}
          {rows.length === 0 ? (
            <div className="artwork-library-no-results">
              <p>{query.trim() ? `No artworks match “${query}”.` : filter === "in-project" ? "No library artworks are in this checklist." : "Every library artwork is already in this checklist."}</p>
              {query.trim() ? <Button variant="outline" size="sm" onClick={() => setQuery("")}>Clear search</Button> : <Button variant="outline" size="sm" onClick={() => setFilter("all")}>Show all artworks</Button>}
            </div>
          ) : (
            <ArtworkTable
              scope="library"
              rows={tableRows}
              checklistIds={checklistIds}
              thumbnails={thumbnails}
              unit={unit}
              checked={selected}
              sort={sort}
              onSort={(key) => {
                if (key !== "title" && key !== "artist" && key !== "date") return;
                setSort((current) => ({ key, direction: current.key === key && current.direction === "ascending" ? "descending" : "ascending" }));
              }}
              onCheckedChange={setSelected}
              projectMembershipsByArtworkId={projectMembershipsByArtworkId}
              onOpenProject={onOpenProject}
              onEditArtwork={onEditArtwork}
              onAdd={(id) => void onAddToChecklist([id])}
            />
          )}
        </>
      )}
      <DeleteArtworksDialog
        pendingIds={pendingDeleteIds}
        artworks={artworks}
        projectMembershipsByArtworkId={projectMembershipsByArtworkId}
        onConfirm={(ids) => {
          void onDeleteArtworks?.(ids);
          setSelected(new Set());
          setPendingDeleteIds(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteIds(null);
        }}
      />
    </section>
  );
}

// Confirms a library mass-delete. Modeled on DeleteRoomDialog (showClose={false},
// ghost Cancel + destructive confirm). Deleting a library record is a full
// cascade with no undo, so the copy spells out the project fallout: how many of
// the picked works are in checklists and across how many projects.
function DeleteArtworksDialog({
  pendingIds,
  artworks,
  projectMembershipsByArtworkId,
  onConfirm,
  onOpenChange
}: {
  pendingIds: string[] | null;
  artworks: Artwork[];
  projectMembershipsByArtworkId?: Map<string, ProjectSummary[]> | Record<string, ProjectSummary[]>;
  onConfirm: (artworkIds: string[]) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const membershipsFor = (id: string) =>
    (projectMembershipsByArtworkId instanceof Map
      ? projectMembershipsByArtworkId.get(id)
      : projectMembershipsByArtworkId?.[id]) ?? [];
  const ids = pendingIds ?? [];
  const pending = ids
    .map((id) => artworks.find((artwork) => artwork.id === id))
    .filter((artwork): artwork is Artwork => Boolean(artwork));
  const count = pending.length;
  const firstTitle = pending[0]?.title?.trim() || "Untitled";
  const worksInUse = pending.filter((artwork) => membershipsFor(artwork.id).length > 0).length;
  const projectCount = new Set(
    pending.flatMap((artwork) => membershipsFor(artwork.id).map((summary) => summary.id))
  ).size;

  const title = count === 1
    ? `Delete “${firstTitle}” from the library?`
    : `Delete ${count} works from the library?`;

  // Name the project when there's exactly one — "the checklist in “X”" reads
  // as a concrete consequence where "1 project checklist" reads as a tally.
  const onlyProjectTitle =
    projectCount === 1
      ? pending.flatMap((artwork) => membershipsFor(artwork.id))[0]?.title?.trim() ||
        "Untitled project"
      : null;
  const projectsPhrase = onlyProjectTitle
    ? `the checklist in “${onlyProjectTitle}”`
    : `${projectCount} project checklists`;
  const thoseChecklists = projectCount === 1 ? "that checklist" : "those checklists";
  const description = worksInUse === 0
    ? `Deleting removes ${count === 1 ? "it" : "them"} from this device permanently. This can't be undone.`
    : count === 1
      ? `“${firstTitle}” is on ${projectsPhrase}. Deleting removes it from ${thoseChecklists} and any walls where it's placed. This can't be undone.`
      : `${worksInUse === 1 ? "1 of these works is" : `${worksInUse} of these works are`} on ${projectsPhrase}. Deleting removes them from ${thoseChecklists} and any walls where they're placed. This can't be undone.`;

  return (
    <Dialog open={pendingIds !== null} onOpenChange={onOpenChange}>
      <DialogContent className="dialog-alert" showClose={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(ids)}>
            {count === 1 ? "Delete work" : `Delete ${count} works`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ArtworkLibraryPicker({
  open,
  artworks,
  project,
  getBlob,
  onOpenChange,
  onAddToChecklist
}: LibraryCommonProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToChecklist: (artworkIds: string[]) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const rows = useArtworkMatches(artworks, query);
  const checklistIds = useMemo(() => new Set(project.checklistArtworkIds), [project.checklistArtworkIds]);
  const thumbnails = useAssetImageUrls(artworks.map((artwork) => artwork.assetId), getBlob);

  // Select-all scopes to the visible (search-filtered) rows not already in the
  // checklist; already-added rows are disabled and never join the selection.
  const selectableIds = rows.filter((artwork) => !checklistIds.has(artwork.id)).map((artwork) => artwork.id);
  const allSelectableSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelectableSelected = selectableIds.some((id) => selected.has(id));
  const toggleAllSelectable = () => setSelected((current) => {
    const next = new Set(current);
    for (const id of selectableIds) {
      if (allSelectableSelected) next.delete(id);
      else next.add(id);
    }
    return next;
  });

  const addSelected = async () => {
    if (selected.size === 0) return;
    await onAddToChecklist([...selected]);
    setSelected(new Set());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="artwork-library-picker">
        <DialogHeader>
          <DialogTitle>Add from Artwork Library</DialogTitle>
          <DialogDescription>Select works to include in this project. Library records stay available to other projects.</DialogDescription>
        </DialogHeader>
        <SearchField value={query} onChange={setQuery} autoFocus />
        {selectableIds.length > 0 ? (
          <label className="artwork-picker-selectall">
            <Checkbox
              aria-label="Select all shown artworks"
              checked={allSelectableSelected ? true : someSelectableSelected ? "indeterminate" : false}
              onCheckedChange={toggleAllSelectable}
            />
            <span>Select all{query.trim() ? " matching" : ""} ({selectableIds.length})</span>
          </label>
        ) : null}
        <div className="artwork-picker-list" role="list" aria-label="Artwork Library">
          {rows.length === 0 ? <p className="artwork-picker-empty">{query.trim() ? `No artworks match “${query}”.` : "The Artwork Library is empty."}</p> : rows.map((artwork) => {
            const alreadyAdded = checklistIds.has(artwork.id);
            const checked = selected.has(artwork.id);
            return (
              <label className="artwork-picker-row" data-disabled={alreadyAdded ? "" : undefined} key={artwork.id}>
                <Checkbox
                  aria-label={`Select ${artwork.title?.trim() || "Untitled"}`}
                  checked={checked || alreadyAdded}
                  disabled={alreadyAdded}
                  onCheckedChange={() => setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(artwork.id)) next.delete(artwork.id); else next.add(artwork.id);
                    return next;
                  })}
                />
                <span className="artwork-picker-thumbnail">{artwork.assetId && thumbnails.get(artwork.assetId) ? <img alt="" src={thumbnails.get(artwork.assetId)} /> : <ImageSquareIcon aria-hidden="true" size={17} />}</span>
                <span className="artwork-picker-identity">
                  <strong>{artwork.title?.trim() || "Untitled"}</strong>
                  <span>{artwork.artist?.trim() || "Unknown artist"}{artwork.date ? ` · ${artwork.date}` : ""}</span>
                </span>
                {alreadyAdded ? <span className="artwork-membership"><CheckIcon aria-hidden="true" size={13} /> In checklist</span> : null}
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={selected.size === 0} variant="primary" onClick={() => void addSelected()}>
            Add {selected.size || ""} to checklist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SearchField({ value, onChange, autoFocus = false }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  return <label className="artwork-library-search"><MagnifyingGlassIcon aria-hidden="true" size={16} /><span className="visually-hidden">Search artworks</span><Input autoFocus={autoFocus} placeholder="Search title, artist, date, or object number" type="search" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function useArtworkMatches(artworks: Artwork[], query: string) {
  return useMemo(() => { const needle = query.trim().toLocaleLowerCase(); if (!needle) return artworks; return artworks.filter((artwork) => [artwork.title, artwork.artist, artwork.date, artwork.accessionNumber].some((value) => value?.toLocaleLowerCase().includes(needle))); }, [artworks, query]);
}

function sortArtworks(artworks: Artwork[], sort: LibrarySort, direction: SortDirection) { return [...artworks].sort((a, b) => { const value = (artwork: Artwork) => sort === "artist" ? artwork.artist : sort === "date" ? artwork.date : artwork.title; const result = (value(a)?.trim() || "\uffff").localeCompare(value(b)?.trim() || "\uffff", undefined, { sensitivity: "base", numeric: true }); return direction === "ascending" ? result : -result; }); }

function artworkDisplayUnit(projectUnit: DisplayUnit) { return getScopeUnits(unitSystemFromDisplayUnit(projectUnit), "artwork").displayUnit; }
