import { useRef } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ImageSquareIcon } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import type { Artwork, DisplayUnit, ProjectSummary } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

export type SortDirection = "ascending" | "descending";

export type ArtworkTableRow = {
  id: string;
  // null = checklist entry whose library record is missing.
  artwork: Artwork | null;
  // checklist scope
  rowNumber?: number;
  isPlaced?: boolean;
  location?: string;
};

export type ArtworkTableProps = {
  scope: "library" | "checklist";
  // Already filtered + sorted: the VISIBLE order.
  rows: ArtworkTableRow[];
  thumbnails: Map<string, string>;
  unit: DisplayUnit;
  checked: Set<string>;
  onCheckedChange: (next: Set<string>) => void;
  // direction absent => rendered as ascending, no toggle semantics.
  sort: { key: string; direction?: SortDirection };
  onSort: (key: string) => void;
  selectedArtworkId?: string | null;
  onEditArtwork?: (artworkId: string) => void;
  // library scope only
  checklistIds?: Set<string>;
  projectMembershipsByArtworkId?: Map<string, ProjectSummary[]> | Record<string, ProjectSummary[]>;
  onOpenProject?: (projectId: string) => void;
  onAdd?: (artworkId: string) => void;
};

export function ArtworkTable({
  scope,
  rows,
  thumbnails,
  unit,
  checked,
  onCheckedChange,
  sort,
  onSort,
  selectedArtworkId,
  onEditArtwork,
  checklistIds,
  projectMembershipsByArtworkId,
  onOpenProject,
  onAdd
}: ArtworkTableProps) {
  const anchorRef = useRef<number | null>(null);
  const isChecklist = scope === "checklist";
  const membershipsFor = (id: string) =>
    projectMembershipsByArtworkId instanceof Map
      ? projectMembershipsByArtworkId.get(id)
      : projectMembershipsByArtworkId?.[id];
  const hasProjects = Boolean(projectMembershipsByArtworkId);
  const direction: SortDirection = sort.direction ?? "ascending";
  const allVisibleChecked = rows.length > 0 && rows.every((row) => checked.has(row.id));
  const someVisibleChecked = rows.some((row) => checked.has(row.id));

  const toggleAllVisible = () => {
    // Start from the full set so hidden checked ids survive.
    const next = new Set(checked);
    if (allVisibleChecked) rows.forEach((row) => next.delete(row.id));
    else rows.forEach((row) => next.add(row.id));
    onCheckedChange(next);
  };

  const toggleRow = (index: number, shift: boolean) => {
    const next = new Set(checked);
    const anchor = anchorRef.current;
    if (shift && anchor !== null) {
      const target = !checked.has(rows[index].id);
      const from = Math.min(anchor, index);
      const to = Math.max(anchor, index);
      for (let i = from; i <= to; i += 1) {
        const row = rows[i];
        if (!row) continue;
        if (target) next.add(row.id);
        else next.delete(row.id);
      }
    } else {
      const id = rows[index].id;
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    anchorRef.current = index;
    onCheckedChange(next);
  };

  const header = (key: string, label: string) => (
    <SortableHeader active={sort.key === key} direction={direction} label={label} onClick={() => onSort(key)} />
  );

  return (
    <div className="artwork-library-table-scroll">
      <table className="artwork-library-table" data-scope={scope}>
        <thead>
          <tr>
            <th className="artwork-table-select" scope="col">
              <Checkbox
                aria-label="Select all shown artworks"
                checked={allVisibleChecked ? true : someVisibleChecked ? "indeterminate" : false}
                onCheckedChange={toggleAllVisible}
              />
            </th>
            {isChecklist ? header("project", "#") : null}
            {header("title", "Artwork")}
            {header("artist", "Artist")}
            {isChecklist ? <th scope="col">Date</th> : header("date", "Date")}
            <th scope="col">Dimensions</th>
            {isChecklist ? (
              <>
                {header("status", "Status")}
                <th scope="col">Location</th>
              </>
            ) : (
              <>
                {hasProjects ? <th scope="col">Used in</th> : null}
                <th scope="col">This project</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const artwork = row.artwork;
            const isChecked = checked.has(row.id);
            const thumbnail = artwork?.assetId ? thumbnails.get(artwork.assetId) : undefined;
            const title = artwork ? artwork.title?.trim() || "Untitled" : "Missing from library";
            return (
              <tr
                data-active={row.id === selectedArtworkId ? "" : undefined}
                data-selected={isChecked ? "" : undefined}
                key={row.id}
              >
                <td className="artwork-table-select">
                  <Checkbox
                    aria-label={`Select ${title}`}
                    checked={isChecked}
                    onClick={(event) => toggleRow(index, event.shiftKey)}
                  />
                </td>
                {isChecklist ? <td className="artwork-table-number">{row.rowNumber}</td> : null}
                <th scope="row">
                  <button
                    className="artwork-table-identity artwork-table-edit"
                    type="button"
                    onClick={(event) =>
                      // Selection mode: while anything is checked, the title
                      // toggles its check instead of opening the work.
                      checked.size > 0 ? toggleRow(index, event.shiftKey) : onEditArtwork?.(row.id)
                    }
                  >
                    <span className="artwork-table-thumbnail">
                      {thumbnail ? <img alt="" src={thumbnail} /> : <ImageSquareIcon aria-hidden="true" size={18} />}
                    </span>
                    <span>{title}</span>
                  </button>
                </th>
                <td>{artwork?.artist?.trim() || <span className="artwork-table-muted">Unknown</span>}</td>
                <td>{artwork?.date || <span className="artwork-table-muted">—</span>}</td>
                <td className="artwork-table-dimensions">{artwork ? formatDimensions(artwork, unit) : "—"}</td>
                {isChecklist ? (
                  <>
                    <td>{row.isPlaced ? "Placed" : "Unplaced"}</td>
                    <td>{row.location ? row.location : <span className="artwork-table-muted">—</span>}</td>
                  </>
                ) : (
                  <>
                    {hasProjects ? (
                      <td>
                        <ProjectMembershipMenu projects={membershipsFor(row.id) ?? []} onOpenProject={onOpenProject} />
                      </td>
                    ) : null}
                    <td>
                      {checklistIds?.has(row.id) ? (
                        <span className="artwork-membership">
                          <CheckIcon aria-hidden="true" size={13} /> In checklist
                        </span>
                      ) : (
                        <Button
                          aria-label={`Add ${title} to current checklist`}
                          size="sm"
                          variant="outline"
                          onClick={() => onAdd?.(row.id)}
                        >
                          <PlusIcon aria-hidden="true" size={14} /> Add
                        </Button>
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({ active, direction, label, onClick }: { active: boolean; direction: SortDirection; label: string; onClick: () => void }) {
  return <th aria-sort={active ? direction : "none"} scope="col"><button className="artwork-table-sort" type="button" onClick={onClick}>{label}<span aria-hidden="true">{active ? (direction === "ascending" ? "↑" : "↓") : "↕"}</span></button></th>;
}

function ProjectMembershipMenu({ projects, onOpenProject }: { projects: ProjectSummary[]; onOpenProject?: (projectId: string) => void }) {
  if (projects.length === 0) return <span className="artwork-table-muted">Unused</span>;
  if (projects.length === 1) {
    const [only] = projects;
    const title = only.title?.trim() || "Untitled project";
    return <Button aria-label={`Open ${title}`} className="artwork-membership-project" size="sm" variant="ghost" onClick={() => onOpenProject?.(only.id)}><span className="artwork-membership-project-label">{title}</span></Button>;
  }
  return <DropdownMenu><DropdownMenuTrigger asChild><Button aria-label={`Used in ${projects.length} projects`} className="artwork-membership-project" size="sm" variant="ghost"><span className="artwork-membership-project-label">{projects.length} projects</span><CaretDownIcon aria-hidden="true" size={12} /></Button></DropdownMenuTrigger><DropdownMenuContent align="start">{projects.map((project) => <DropdownMenuItem key={project.id} onSelect={() => onOpenProject?.(project.id)}>{project.title}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
}

export function formatDimensions(artwork: Artwork, unit: DisplayUnit) {
  const { widthMm, heightMm } = artwork.dimensions;
  if (widthMm === undefined || heightMm === undefined) return "—";
  return `${formatLength(widthMm, { unit })} × ${formatLength(heightMm, { unit })}`;
}
