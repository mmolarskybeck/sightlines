import { useMemo, useState } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ImageSquareIcon } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { buildChecklistExportRows } from "../../../domain/checklistExport/rows";
import type { Artwork, Project } from "../../../domain/project";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../../domain/units/unitSystem";
import { formatCaptionPlacement } from "../../export/checklistPdf/caption";
import { useAssetImageUrls } from "../../hooks/useAssetImageUrls";
import { ArtworkBulkBar } from "../library/ArtworkBulkBar";
import { ArtworkTable, type ArtworkTableRow } from "../library/ArtworkTable";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "../ui/segmented";
import {
  CHECKLIST_SORTS,
  checklistRowMatchesQuery,
  defaultChecklistView,
  sortChecklistRows,
  type ChecklistRowData,
  type ChecklistSort,
  type ChecklistViewPreferences
} from "./checklistViewPreferences";

type StatusFilter = "all" | "placed" | "unplaced";

export function ChecklistEditorView({
  project,
  libraryArtworks,
  getBlob,
  selectedArtworkId,
  checked,
  onCheckedChange,
  onSelectArtwork,
  onChangeChecklistView,
  onBack,
  onRevealInspector,
  onDuplicate,
  onRemove,
  onSelectOnCanvas,
  onNewArtwork,
  onOpenArtworkLibrary
}: {
  project: Project;
  libraryArtworks: Artwork[];
  getBlob: (key: string) => Promise<Blob>;
  selectedArtworkId: string | null;
  checked: Set<string>;
  onCheckedChange: (next: Set<string>) => void;
  onSelectArtwork: (artworkId: string) => void;
  onChangeChecklistView: (view: ChecklistViewPreferences) => Promise<void>;
  onBack: () => void;
  // Bulk editing happens in the inspector; this only reveals it when collapsed.
  onRevealInspector?: () => void;
  onDuplicate: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
  onSelectOnCanvas: (ids: string[]) => void;
  onNewArtwork: () => void;
  onOpenArtworkLibrary: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  const exportRows = useMemo(
    () => buildChecklistExportRows(project, libraryArtworks),
    [project, libraryArtworks]
  );
  const exportRowById = useMemo(
    () => new Map(exportRows.map((row) => [row.artworkId, row])),
    [exportRows]
  );
  const rows = useMemo<ChecklistRowData[]>(() => {
    const placementIdsByArtwork = new Map<string, string[]>();
    for (const object of [...project.wallObjects, ...project.floorObjects]) {
      if (object.kind !== "artwork") continue;
      const list = placementIdsByArtwork.get(object.artworkId) ?? [];
      list.push(object.id);
      placementIdsByArtwork.set(object.artworkId, list);
    }
    return exportRows.map((row) => ({
      artworkId: row.artworkId,
      artwork: row.artwork,
      isPlaced: row.placement !== null,
      projectIndex: row.projectIndex,
      wallName: row.placement?.wallName ?? null,
      placementIds: placementIdsByArtwork.get(row.artworkId) ?? []
    }));
  }, [exportRows, project.wallObjects, project.floorObjects]);

  const currentView = project.checklistView ?? defaultChecklistView(rows);
  const sort = currentView.sort;
  const visible = useMemo(
    () =>
      sortChecklistRows(
        rows.filter(
          (row) =>
            checklistRowMatchesQuery(row, query) &&
            (filter === "all" || (filter === "placed" ? row.isPlaced : !row.isPlaced))
        ),
        sort
      ),
    [rows, query, filter, sort]
  );
  const tableRows = useMemo<ArtworkTableRow[]>(
    () =>
      visible.map((row) => {
        const exportRow = exportRowById.get(row.artworkId);
        return {
          id: row.artworkId,
          artwork: row.artwork,
          rowNumber: row.projectIndex + 1,
          isPlaced: row.isPlaced,
          location: exportRow ? formatCaptionPlacement(exportRow) : ""
        };
      }),
    [visible, exportRowById]
  );
  const thumbnails = useAssetImageUrls(libraryArtworks.map((artwork) => artwork.assetId), getBlob);
  const unit = getScopeUnits(unitSystemFromDisplayUnit(project.unit), "artwork").displayUnit;

  const visibleIds = new Set(visible.map((row) => row.artworkId));
  const checkedIds = [...checked];
  const hiddenCount = checkedIds.filter((id) => !visibleIds.has(id)).length;
  const placedCheckedCount = checkedIds.filter((id) => rows.find((row) => row.artworkId === id)?.isPlaced).length;
  const allVisibleChecked = visible.length > 0 && visible.every((row) => checked.has(row.artworkId));
  const searching = query.trim().length > 0;

  const headerActions = (
    <div className="artwork-library-header-actions">
      <Button variant="outline" onClick={onOpenArtworkLibrary}>Add from library</Button>
      <Button variant="primary" onClick={onNewArtwork}>
        <PlusIcon aria-hidden="true" size={16} /> New work without image
      </Button>
    </div>
  );

  return (
    <section
      aria-labelledby="checklist-editor-title"
      className="artwork-library-view checklist-editor-view"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && checked.size > 0) {
          onCheckedChange(new Set());
        }
      }}
    >
      <header className="artwork-library-header">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon aria-hidden="true" size={14} /> Back
          </Button>
          <h1 id="checklist-editor-title">Checklist</h1>
          <p>{rows.length} work{rows.length === 1 ? "" : "s"} in this project</p>
        </div>
        {headerActions}
      </header>

      {rows.length === 0 ? (
        <div className="artwork-library-empty">
          <ImageSquareIcon aria-hidden="true" size={30} />
          <h2>This checklist is empty.</h2>
          <div className="artwork-library-header-actions">
            <Button variant="outline" onClick={onOpenArtworkLibrary}>Add from library</Button>
            <Button variant="primary" onClick={onNewArtwork}>
              <PlusIcon aria-hidden="true" size={16} /> New work without image
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="artwork-library-toolbar">
            <label className="artwork-library-search">
              <MagnifyingGlassIcon aria-hidden="true" size={16} />
              <span className="visually-hidden">Search artworks</span>
              <Input
                placeholder="Search title, artist, date, or object number"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="artwork-library-toolbar-secondary">
              <SegmentedToggleGroup
                aria-label="Filter checklist"
                className="artwork-library-filters"
                type="single"
                value={filter}
                onValueChange={(value) => {
                  if (value === "all" || value === "placed" || value === "unplaced") setFilter(value);
                }}
              >
                <SegmentedToggleGroupItem value="all">All</SegmentedToggleGroupItem>
                <SegmentedToggleGroupItem value="placed">Placed</SegmentedToggleGroupItem>
                <SegmentedToggleGroupItem value="unplaced">Unplaced</SegmentedToggleGroupItem>
              </SegmentedToggleGroup>
              <span className="artwork-library-result-count" aria-live="polite">
                {visible.length} shown
              </span>
            </div>
          </div>
          {checked.size > 0 ? (
            <ArtworkBulkBar
              scope="checklist"
              variant="full"
              checkedCount={checked.size}
              hiddenCount={hiddenCount}
              placedCheckedCount={placedCheckedCount}
              allVisibleChecked={allVisibleChecked}
              onSelectAll={() => onCheckedChange(new Set([...checked, ...visibleIds]))}
              onEdit={onRevealInspector}
              onDuplicate={() => onDuplicate([...checked])}
              onSelectOnCanvas={() => onSelectOnCanvas([...checked])}
              onRemove={() => onRemove([...checked])}
              onClear={() => onCheckedChange(new Set())}
            />
          ) : null}
          {visible.length === 0 ? (
            <div className="artwork-library-no-results">
              <p>
                {searching
                  ? `No works match “${query}”.`
                  : filter === "placed"
                    ? "Nothing placed yet."
                    : "Everything is placed."}
              </p>
              {searching ? (
                <Button variant="outline" size="sm" onClick={() => setQuery("")}>Clear search</Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setFilter("all")}>Show all works</Button>
              )}
            </div>
          ) : (
            <ArtworkTable
              scope="checklist"
              rows={tableRows}
              thumbnails={thumbnails}
              unit={unit}
              checked={checked}
              onCheckedChange={onCheckedChange}
              sort={{ key: sort }}
              onSort={(key) => {
                if (!(CHECKLIST_SORTS as string[]).includes(key)) return;
                void onChangeChecklistView({
                  sort: key as ChecklistSort,
                  groupByArtist: key === "artist" ? currentView.groupByArtist : false
                });
              }}
              selectedArtworkId={selectedArtworkId}
              onEditArtwork={onSelectArtwork}
            />
          )}
        </>
      )}
    </section>
  );
}
