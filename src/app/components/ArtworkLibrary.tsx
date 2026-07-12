import { useMemo, useState } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { ImageSquareIcon } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import type { Artwork, DisplayUnit, Project, ProjectSummary } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { Input } from "./ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "./ui/segmented";

type LibraryFilter = "all" | "in-project" | "not-in-project";
type LibrarySort = "title" | "artist" | "date";
type SortDirection = "ascending" | "descending";

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
  onOpenImportWizard,
  pendingDuplicateUploads = [],
  onConfirmDuplicateUploads,
  onDismissDuplicateUploads,
  projectMembershipsByArtworkId,
  onOpenProject,
  onEditArtwork
}: LibraryCommonProps & {
  onAddToChecklist: (artworkIds: string[]) => void | Promise<void>;
  onOpenImportWizard: () => void;
  pendingDuplicateUploads?: { file: File; existingArtworkTitle: string }[];
  onConfirmDuplicateUploads?: () => void | Promise<void>;
  onDismissDuplicateUploads?: () => void;
  projectMembershipsByArtworkId?: Map<string, ProjectSummary[]> | Record<string, ProjectSummary[]>;
  onOpenProject?: (projectId: string) => void;
  onEditArtwork?: (artworkId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<{ key: LibrarySort; direction: SortDirection }>({ key: "title", direction: "ascending" });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const checklistIds = useMemo(() => new Set(project.checklistArtworkIds), [project.checklistArtworkIds]);
  const matches = useArtworkMatches(artworks, query);
  const rows = useMemo(() => sortArtworks(matches.filter((artwork) => filter === "all" || (filter === "in-project" ? checklistIds.has(artwork.id) : !checklistIds.has(artwork.id))), sort.key, sort.direction), [checklistIds, filter, matches, sort]);
  const thumbnails = useAssetImageUrls(artworks.map((artwork) => artwork.assetId), getBlob);
  const unit = artworkDisplayUnit(project.unit);

  return (
    <section aria-labelledby="artwork-library-title" className="artwork-library-view">
      <header className="artwork-library-header">
        <div>
          <h1 id="artwork-library-title">Artwork Library</h1>
          <p>{artworks.length} work{artworks.length === 1 ? "" : "s"} on this device</p>
        </div>
        <Button variant="primary" onClick={onOpenImportWizard}>
          <FileArrowUpIcon aria-hidden="true" size={16} /> Import
        </Button>
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
          {selected.size > 0 ? <div className="artwork-library-selection" role="status"><span>{selected.size} selected</span><Button size="sm" variant="primary" onClick={() => { void onAddToChecklist([...selected]); setSelected(new Set()); }}>Add selected to checklist</Button><Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button></div> : null}
          {rows.length === 0 ? (
            <div className="artwork-library-no-results">
              <p>{query.trim() ? `No artworks match “${query}”.` : filter === "in-project" ? "No library artworks are in this checklist." : "Every library artwork is already in this checklist."}</p>
              {query.trim() ? <Button variant="outline" size="sm" onClick={() => setQuery("")}>Clear search</Button> : <Button variant="outline" size="sm" onClick={() => setFilter("all")}>Show all artworks</Button>}
            </div>
          ) : (
            <ArtworkTable
              artworks={rows}
              checklistIds={checklistIds}
              thumbnails={thumbnails}
              unit={unit}
              selected={selected}
              sort={sort}
              onSort={(key) => setSort((current) => ({ key, direction: current.key === key && current.direction === "ascending" ? "descending" : "ascending" }))}
              onSelectionChange={setSelected}
              projectMembershipsByArtworkId={projectMembershipsByArtworkId}
              onOpenProject={onOpenProject}
              onEditArtwork={onEditArtwork}
              onAdd={(id) => void onAddToChecklist([id])}
            />
          )}
        </>
      )}
    </section>
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
  return <label className="artwork-library-search"><MagnifyingGlassIcon aria-hidden="true" size={16} /><span className="visually-hidden">Search artworks</span><Input autoFocus={autoFocus} placeholder="Search title, artist, date, or accession number" type="search" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ArtworkTable({ artworks, checklistIds, thumbnails, unit, selected, sort, onSort, onSelectionChange, projectMembershipsByArtworkId, onOpenProject, onEditArtwork, onAdd }: { artworks: Artwork[]; checklistIds: Set<string>; thumbnails: Map<string, string>; unit: DisplayUnit; selected: Set<string>; sort: { key: LibrarySort; direction: SortDirection }; onSort: (key: LibrarySort) => void; onSelectionChange: (selected: Set<string>) => void; projectMembershipsByArtworkId?: Map<string, ProjectSummary[]> | Record<string, ProjectSummary[]>; onOpenProject?: (projectId: string) => void; onEditArtwork?: (artworkId: string) => void; onAdd: (id: string) => void }) {
  const membershipsFor = (id: string) => projectMembershipsByArtworkId instanceof Map ? projectMembershipsByArtworkId.get(id) : projectMembershipsByArtworkId?.[id];
  const hasProjects = Boolean(projectMembershipsByArtworkId);
  return <div className="artwork-library-table-scroll"><table className="artwork-library-table"><thead><tr><th className="artwork-table-select" scope="col"><span className="visually-hidden">Select</span></th><SortableHeader active={sort.key === "title"} direction={sort.direction} label="Artwork" onClick={() => onSort("title")} /><SortableHeader active={sort.key === "artist"} direction={sort.direction} label="Artist" onClick={() => onSort("artist")} /><SortableHeader active={sort.key === "date"} direction={sort.direction} label="Date" onClick={() => onSort("date")} /><th scope="col">Dimensions</th>{hasProjects ? <th scope="col">Used in</th> : null}<th scope="col">Current project</th></tr></thead><tbody>{artworks.map((artwork) => {
    const isAdded = checklistIds.has(artwork.id);
    const thumbnail = artwork.assetId ? thumbnails.get(artwork.assetId) : undefined;
    const projects = membershipsFor(artwork.id) ?? [];
    const title = artwork.title?.trim() || "Untitled";
    return <tr data-selected={selected.has(artwork.id) ? "" : undefined} key={artwork.id}><td className="artwork-table-select"><Checkbox aria-label={`Select ${title}`} checked={selected.has(artwork.id)} onCheckedChange={() => { const next = new Set(selected); if (next.has(artwork.id)) next.delete(artwork.id); else next.add(artwork.id); onSelectionChange(next); }} /></td><th scope="row"><button className="artwork-table-identity artwork-table-edit" type="button" onClick={() => onEditArtwork?.(artwork.id)}><span className="artwork-table-thumbnail">{thumbnail ? <img alt="" src={thumbnail} /> : <ImageSquareIcon aria-hidden="true" size={18} />}</span><span>{title}</span></button></th><td>{artwork.artist?.trim() || <span className="artwork-table-muted">Unknown</span>}</td><td>{artwork.date || <span className="artwork-table-muted">—</span>}</td><td>{formatDimensions(artwork, unit)}</td>{hasProjects ? <td><ProjectMembershipMenu projects={projects} onOpenProject={onOpenProject} /></td> : null}<td>{isAdded ? <span className="artwork-membership"><CheckIcon aria-hidden="true" size={13} /> In checklist</span> : <Button aria-label={`Add ${title} to current checklist`} size="sm" variant="outline" onClick={() => onAdd(artwork.id)}><PlusIcon aria-hidden="true" size={14} /> Add</Button>}</td></tr>;
  })}</tbody></table></div>;
}

function SortableHeader({ active, direction, label, onClick }: { active: boolean; direction: SortDirection; label: string; onClick: () => void }) {
  return <th aria-sort={active ? direction : "none"} scope="col"><button className="artwork-table-sort" type="button" onClick={onClick}>{label}<span aria-hidden="true">{active ? (direction === "ascending" ? "↑" : "↓") : "↕"}</span></button></th>;
}

function ProjectMembershipMenu({ projects, onOpenProject }: { projects: ProjectSummary[]; onOpenProject?: (projectId: string) => void }) {
  if (projects.length === 0) return <span className="artwork-table-muted">Unused</span>;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button aria-label={`Used in ${projects.length} project${projects.length === 1 ? "" : "s"}`} size="sm" variant="ghost">{projects.length} project{projects.length === 1 ? "" : "s"}<CaretDownIcon aria-hidden="true" size={12} /></Button></DropdownMenuTrigger><DropdownMenuContent align="start">{projects.map((project) => <DropdownMenuItem key={project.id} onSelect={() => onOpenProject?.(project.id)}>{project.title}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
}

function useArtworkMatches(artworks: Artwork[], query: string) {
  return useMemo(() => { const needle = query.trim().toLocaleLowerCase(); if (!needle) return artworks; return artworks.filter((artwork) => [artwork.title, artwork.artist, artwork.date, artwork.accessionNumber].some((value) => value?.toLocaleLowerCase().includes(needle))); }, [artworks, query]);
}

function sortArtworks(artworks: Artwork[], sort: LibrarySort, direction: SortDirection) { return [...artworks].sort((a, b) => { const value = (artwork: Artwork) => sort === "artist" ? artwork.artist : sort === "date" ? artwork.date : artwork.title; const result = (value(a)?.trim() || "\uffff").localeCompare(value(b)?.trim() || "\uffff", undefined, { sensitivity: "base", numeric: true }); return direction === "ascending" ? result : -result; }); }

function artworkDisplayUnit(projectUnit: DisplayUnit) { return getScopeUnits(unitSystemFromDisplayUnit(projectUnit), "artwork").displayUnit; }
function formatDimensions(artwork: Artwork, unit: DisplayUnit) { const { widthMm, heightMm } = artwork.dimensions; if (widthMm === undefined || heightMm === undefined) return "—"; return `${formatLength(widthMm, { unit })} × ${formatLength(heightMm, { unit })}`; }
