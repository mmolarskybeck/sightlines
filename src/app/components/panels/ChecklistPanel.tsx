import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/csr/ArrowsDownUp";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { ImageSquareIcon } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { ACCEPTED_IMAGE_MIME_TYPES } from "../../../domain/assets/imageIntake";
import type { Artwork, Project } from "../../../domain/project";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../../domain/units/unitSystem";
import { useAssetImageUrls } from "../../hooks/useAssetImageUrls";
import { ChecklistRow } from "./ChecklistRow";
import {
  CHECKLIST_SORTS,
  artistGroupIdentity,
  checklistRowMatchesQuery,
  defaultChecklistView,
  groupChecklistRowsByArtist,
  sortChecklistRows,
  type ChecklistArtistGroup,
  type ChecklistRowData,
  type ChecklistSort,
  type ChecklistViewPreferences
} from "./checklistViewPreferences";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem
} from "../ui/segmented";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

type ChecklistFilter = "all" | "placed" | "unplaced";

const SORT_LABELS: Record<ChecklistSort, string> = {
  project: "Project order",
  title: "Title",
  artist: "Artist",
  status: "Status"
};

// The left workspace pane (docs/plan.md §3.5, §4.1): checklist membership is
// independent of both the library and wall placement, so a row here can be a
// fully-formed artwork, or — if its library record has since been deleted out
// from under this project — a degraded stub that still shows up rather than
// silently disappearing.
export function ChecklistPanel({
  project,
  libraryArtworks,
  intakeState,
  selectedArtworkId,
  pendingDuplicateUploads,
  onAddArtworksFromFiles,
  onArtworkDragStateChange,
  onConfirmDuplicateUploads,
  onDismissDuplicateUploads,
  onChangeChecklistView,
  onOpenImportWizard,
  onOpenArtworkLibrary,
  onRemoveArtworkFromChecklist,
  onRemovePlacement,
  onSelectArtwork,
  getBlob
}: {
  project: Project;
  libraryArtworks: Artwork[];
  intakeState: "idle" | "processing";
  selectedArtworkId: string | null;
  pendingDuplicateUploads: { file: File; existingArtworkTitle: string }[];
  onAddArtworksFromFiles: (files: File[]) => Promise<void>;
  onConfirmDuplicateUploads: () => Promise<void>;
  onDismissDuplicateUploads: () => void;
  onOpenImportWizard: () => void;
  onOpenArtworkLibrary: () => void;
  // Optional: App.tsx uses this to track which artwork is mid-drag so
  // ElevationView can size its drop ghost during dragover, since dataTransfer
  // payloads are unreadable until drop. Fired with the artworkId on
  // dragstart and null on dragend.
  onArtworkDragStateChange?: (artworkId: string | null) => void;
  // Sort/grouping are project data (project.checklistView); the panel renders
  // whatever the project carries and hands explicit choices back up as a
  // complete view record — it never writes the project itself.
  onChangeChecklistView: (view: ChecklistViewPreferences) => Promise<void>;
  onRemoveArtworkFromChecklist: (artworkId: string) => Promise<void>;
  onRemovePlacement: (wallObjectId: string) => Promise<void>;
  onSelectArtwork: (artworkId: string) => void;
  getBlob: (key: string) => Promise<Blob>;
}) {
  const [isDropActive, setIsDropActive] = useState(false);
  const [filter, setFilter] = useState<ChecklistFilter>("all");
  const [collapsedArtistKeys, setCollapsedArtistKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Removing a work from the checklist is a two-step inline confirm (same
  // idiom as RoomsPanel's room delete): the overflow menu arms this, and only
  // the Remove button in the swapped-in strip actually dispatches.
  const [confirmingRemoveArtworkId, setConfirmingRemoveArtworkId] = useState<string | null>(null);
  // Set when selection changes to an artwork whose row should be scrolled
  // into view once it exists in the DOM (see the effect pair below); cleared
  // again as soon as that effect runs.
  const [scrollTargetArtworkId, setScrollTargetArtworkId] = useState<string | null>(null);
  // dragenter/dragleave fire on every child element the pointer crosses, not
  // just the section boundary — a plain enter/leave toggle would flicker the
  // drop-active state as the drag passes over rows and buttons. Counting
  // nesting depth keeps it lit until the drag has actually left the section.
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const searchInputId = useId();
  const previousProjectIdRef = useRef(project.id);

  const artworksById = useMemo(
    () => new Map(libraryArtworks.map((artwork) => [artwork.id, artwork])),
    [libraryArtworks]
  );

  // Wall names by id (across every room) and the placement each artwork sits
  // on, so a placed row can show the wall it lives on rather than a flat
  // "Placed". Derived here from `project` — the panel already receives it.
  const { placedArtworkWallIds, floorPlacedArtworkIds, wallNamesById, placementIdsByArtworkId } =
    useMemo(() => {
      const wallNames = new Map<string, string>();
      for (const placement of project.floor.rooms) {
        for (const wall of placement.room.walls) {
          wallNames.set(wall.id, wall.name);
        }
      }

      const placedWalls = new Map<string, string>();
      const placementIds = new Map<string, string[]>();
      for (const wallObject of project.wallObjects) {
        if (wallObject.kind === "artwork") {
          placedWalls.set(wallObject.artworkId, wallObject.wallId);
          placementIds.set(wallObject.artworkId, [
            ...(placementIds.get(wallObject.artworkId) ?? []),
            wallObject.id
          ]);
        }
      }

      // A floor-placed artwork counts as placed too — it has no wall name, so
      // its row falls back to the plain "Placed" tag.
      const floorPlaced = new Set<string>();
      for (const floorObject of project.floorObjects) {
        if (floorObject.kind === "artwork") {
          floorPlaced.add(floorObject.artworkId);
          placementIds.set(floorObject.artworkId, [
            ...(placementIds.get(floorObject.artworkId) ?? []),
            floorObject.id
          ]);
        }
      }

      return {
        placedArtworkWallIds: placedWalls,
        floorPlacedArtworkIds: floorPlaced,
        wallNamesById: wallNames,
        placementIdsByArtworkId: placementIds
      };
    }, [project.floor.rooms, project.wallObjects, project.floorObjects]);

  // Memoized: this feeds the auto-expand/scroll effect's deps below, and an
  // inline `.map` here would rebuild the array (new identity) every render —
  // that used to make the effect re-fire on every render, including the
  // user's own collapse click, and immediately re-open the section it just
  // closed. The ref guard in that effect is the actual fix for the bug, but
  // there's no reason for this array to churn identity on every render either.
  const rows: ChecklistRowData[] = useMemo(
    () =>
      project.checklistArtworkIds.map((artworkId, projectIndex) => {
        const wallId = placedArtworkWallIds.get(artworkId);
        const isFloorPlaced = floorPlacedArtworkIds.has(artworkId);
        return {
          artworkId,
          artwork: artworksById.get(artworkId) ?? null,
          isPlaced: wallId !== undefined || isFloorPlaced,
          projectIndex,
          wallName: wallId !== undefined ? (wallNamesById.get(wallId) ?? null) : null,
          placementIds: placementIdsByArtworkId.get(artworkId) ?? []
        };
      }),
    [
      project.checklistArtworkIds,
      placedArtworkWallIds,
      floorPlacedArtworkIds,
      artworksById,
      wallNamesById,
      placementIdsByArtworkId
    ]
  );

  // Sort and grouping are project data: an explicit choice lives at
  // project.checklistView and travels with the exhibition. Until one is made,
  // a checklist that reads as a group show — two or more artists each with
  // multiple works — opens grouped by artist; anything else opens in project
  // order.
  const checklistView = project.checklistView ?? defaultChecklistView(rows);
  const { sort, groupByArtist } = checklistView;

  const searchMatchedRows = rows.filter((row) => checklistRowMatchesQuery(row, searchQuery));
  const placedCount = searchMatchedRows.filter((row) => row.isPlaced).length;
  const unplacedCount = searchMatchedRows.length - placedCount;
  const visibleRows = sortChecklistRows(
    searchMatchedRows.filter((row) =>
      filter === "placed" ? row.isPlaced : filter === "unplaced" ? !row.isPlaced : true
    ),
    sort
  );
  const artistGroups = groupChecklistRowsByArtist(visibleRows);
  const allArtistKeys = groupChecklistRowsByArtist(sortChecklistRows(rows, "artist")).map(
    (group) => group.key
  );
  const searchIsActive = searchQuery.trim().length > 0;
  // The search row's one trailing control walks a ladder rather than doing two
  // things at once: with a query it clears and leaves you typing, and only an
  // already-empty field closes. So the button can name exactly what the next
  // press does, and a press can never take away more than you asked for.
  // Escape follows the same ladder, and the magnifier trigger above stays the
  // outright toggle for anyone who wants out in one move.
  const clearOrCloseSearch = () => {
    if (searchQuery.length > 0) {
      setSearchQuery("");
      searchInputRef.current?.focus();
      return;
    }
    setIsSearchOpen(false);
  };
  const renderedRows = groupByArtist
    ? artistGroups.flatMap((group) =>
        searchIsActive || !collapsedArtistKeys.has(group.key) ? group.rows : []
      )
    : visibleRows;

  useEffect(() => {
    if (isSearchOpen) searchInputRef.current?.focus();
  }, [isSearchOpen]);

  // Search, filter, and artist disclosures are temporary workspace aids. A
  // project switch must never carry a stale query or a previous exhibition's
  // hidden artists into the newly opened checklist. Sort and grouping are NOT
  // reset here: they are project data (project.checklistView), so the newly
  // opened project brings its own.
  useEffect(() => {
    if (previousProjectIdRef.current === project.id) return;
    previousProjectIdRef.current = project.id;
    setFilter("all");
    setCollapsedArtistKeys(new Set());
    setSearchQuery("");
    setIsSearchOpen(false);
  }, [project.id]);

  // Selection can move from the canvas, inspector, or 3D view while its
  // artist group is collapsed. Open that one group so the checklist always
  // reflects the current selection, without closing any other groups the
  // curator is using — and queue the row to be scrolled into view once that
  // expansion (if any) has committed.
  //
  // This must fire only when selectedArtworkId actually CHANGES, never
  // merely because the component re-rendered. `rows` is memoized above now,
  // but the ref guard below is the load-bearing fix, not the memoization:
  // without it, the user's own collapse click (which re-renders this
  // component) would look identical to a fresh selection and re-open the
  // section right back up. This intentionally uses a sibling ref rather than
  // the `previousSelectedArtworkIdRef` below (:328) — that one's paired
  // effect answers a different question ("did selection move to a
  // DIFFERENT row, including to null") for a different purpose (disarming
  // the remove-confirm strip), and folding this into it would make both
  // conditions harder to read.
  const previousAutoRevealArtworkIdRef = useRef(selectedArtworkId);
  useEffect(() => {
    const changedToSelection =
      selectedArtworkId !== null &&
      previousAutoRevealArtworkIdRef.current !== selectedArtworkId;
    previousAutoRevealArtworkIdRef.current = selectedArtworkId;
    if (!changedToSelection) return;

    if (groupByArtist) {
      const selectedRow = rows.find((row) => row.artworkId === selectedArtworkId);
      if (selectedRow) {
        const selectedArtistKey = artistGroupIdentity(selectedRow).key;
        setCollapsedArtistKeys((current) => {
          if (!current.has(selectedArtistKey)) return current;
          const next = new Set(current);
          next.delete(selectedArtistKey);
          return next;
        });
      }
    }
    setScrollTargetArtworkId(selectedArtworkId);
  }, [groupByArtist, rows, selectedArtworkId]);

  // Runs in its own effect, one render after the expand above (if any): in
  // group-by-artist mode the group's <ul> is conditionally rendered, so the
  // row's DOM node doesn't exist until that expand has committed. Batches
  // with the setState above into a single re-render, so by the time this
  // effect observes the new scrollTargetArtworkId the row already exists —
  // no rAF or polling needed. Works in ungrouped mode too, where there's no
  // expand to wait on and the row already exists on the same render.
  useEffect(() => {
    if (scrollTargetArtworkId === null) return;
    const targetId = scrollTargetArtworkId;
    setScrollTargetArtworkId(null);
    // block: "nearest" is also what makes a guard against "selection
    // originated from clicking the row itself" unnecessary: a row already
    // in view is already "nearest" and this is a no-op for it.
    const node = sectionRef.current?.querySelector<HTMLElement>(
      `[data-artwork-id="${cssAttributeEscape(targetId)}"]`
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [scrollTargetArtworkId]);

  // Disarm a pending remove-confirm whenever the row it belongs to could have
  // moved out from under the user — a filter/sort change that hides it, or the
  // row disappearing by another route. Otherwise the strip can sit armed on a
  // row the user has left behind.
  const isConfirmingRowVisible = renderedRows.some(
    (row) => row.artworkId === confirmingRemoveArtworkId
  );
  useEffect(() => {
    if (confirmingRemoveArtworkId !== null && !isConfirmingRowVisible) {
      setConfirmingRemoveArtworkId(null);
    }
  }, [confirmingRemoveArtworkId, isConfirmingRowVisible]);

  // Moving the selection to a DIFFERENT row also disarms. Both halves of that
  // condition are load-bearing: opening the overflow menu selects its own row,
  // and that selection can land in the same commit as the arm — a bare
  // "selection changed" test then clears the strip the instant it appears,
  // while a bare identity test trips on the stale selection of the frame
  // before. Together they only fire when the user has genuinely moved on.
  const previousSelectedArtworkIdRef = useRef(selectedArtworkId);
  useEffect(() => {
    const movedAway = previousSelectedArtworkIdRef.current !== selectedArtworkId;
    previousSelectedArtworkIdRef.current = selectedArtworkId;
    if (movedAway && selectedArtworkId !== confirmingRemoveArtworkId) {
      setConfirmingRemoveArtworkId(null);
    }
  }, [confirmingRemoveArtworkId, selectedArtworkId]);

  const thumbnailUrlsByAssetId = useAssetImageUrls(
    renderedRows.map((row) => row.artwork?.assetId),
    getBlob
  );

  // Artwork dimension summaries read in the artwork scope's unit (in/cm),
  // not the global project unit — a canvas is specced in inches, never feet.
  const artworkUnit = getScopeUnits(
    unitSystemFromDisplayUnit(project.unit),
    "artwork"
  ).displayUnit;

  const duplicateNotice = duplicateNoticeCopy(pendingDuplicateUploads);

  const handleFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    void onAddArtworksFromFiles(fileArray);
  };

  const renderChecklistRow = (row: ChecklistRowData) => (
    <ChecklistRow
      key={row.artworkId}
      artwork={row.artwork}
      artworkId={row.artworkId}
      isConfirmingRemove={row.artworkId === confirmingRemoveArtworkId}
      hasPlacement={row.placementIds.length > 0}
      isPlaced={row.isPlaced}
      isSelected={row.artworkId === selectedArtworkId}
      thumbnailUrl={
        row.artwork?.assetId
          ? thumbnailUrlsByAssetId.get(row.artwork.assetId)
          : undefined
      }
      unit={artworkUnit}
      wallName={row.wallName}
      onRemovePlacement={() => {
        for (const placementId of row.placementIds) {
          void onRemovePlacement(placementId);
        }
      }}
      onRequestRemove={() => setConfirmingRemoveArtworkId(row.artworkId)}
      onCancelRemove={() => setConfirmingRemoveArtworkId(null)}
      onConfirmRemove={() => {
        setConfirmingRemoveArtworkId(null);
        void onRemoveArtworkFromChecklist(row.artworkId);
      }}
      onSelect={() => onSelectArtwork(row.artworkId)}
      onDragStateChange={onArtworkDragStateChange}
    />
  );

  return (
    <section
      ref={sectionRef}
      aria-label="Checklist"
      className={isDropActive ? "checklist-panel drop-active" : "checklist-panel"}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDropActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDropActive(false);
      }}
      onDragOver={(event) => {
        // Required for the drop event to fire at all.
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDropActive(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <div className="panel-heading">
        <h2>Checklist</h2>
        <div className="panel-heading-actions">
          <span>
            {searchIsActive ? `${visibleRows.length} of ${rows.length}` : rows.length} work
            {rows.length === 1 ? "" : "s"}
          </span>
          {intakeState === "processing" ? (
            <span className="intake-note">Adding…</span>
          ) : null}
        </div>
      </div>

      <input
        ref={fileInputRef}
        accept={ACCEPTED_IMAGE_MIME_TYPES.join(",")}
        aria-label="Add artwork images"
        className="visually-hidden"
        multiple
        type="file"
        onChange={(event) => {
          const files = event.target.files;
          if (files) handleFiles(files);
          // Reset so selecting the same file again still fires onChange.
          event.target.value = "";
        }}
      />

      {duplicateNotice ? (
        <div className="checklist-duplicate-notice" role="status">
          <p>{duplicateNotice}</p>
          <div className="checklist-duplicate-actions">
            <Button
              size="sm"
              variant="primary"
              onClick={() => void onConfirmDuplicateUploads()}
            >
              Add anyway
            </Button>
            <Button size="sm" variant="outline" onClick={onDismissDuplicateUploads}>
              Don't add
            </Button>
          </div>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="checklist-controls" data-search-open={isSearchOpen ? "" : undefined}>
          <SegmentedToggleGroup
            aria-label="Filter checklist"
            className="checklist-filters"
            type="single"
            value={filter}
            onValueChange={(value) => {
              if (value === "all" || value === "placed" || value === "unplaced") {
                setFilter(value);
              }
            }}
          >
            <FilterTab
              count={searchMatchedRows.length}
              label="All"
              value="all"
            />
            <FilterTab
              count={placedCount}
              label="Placed"
              value="placed"
            />
            <FilterTab
              count={unplacedCount}
              label="Unplaced"
              value="unplaced"
            />
          </SegmentedToggleGroup>

          {/* Search and checklist options stay subordinate to the filter
              tabs: two icon-only triggers docked inside the same track,
              behind one hairline. Active temporary views tint their icon so
              hidden rows or a surprising order always have a visible cause. */}
          <div aria-hidden="true" className="checklist-sort-divider" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-controls={`${searchInputId}-region`}
                aria-expanded={isSearchOpen}
                aria-label={isSearchOpen ? "Close search" : "Search checklist"}
                className="checklist-control-trigger"
                data-active={isSearchOpen || searchIsActive ? "" : undefined}
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  // A real toggle in both directions: the disclosure that
                  // opened the row is also the one-press way out of it, query
                  // and all. The field's own X walks the gentler ladder.
                  if (isSearchOpen) {
                    setSearchQuery("");
                    setIsSearchOpen(false);
                  } else {
                    setIsSearchOpen(true);
                  }
                }}
              >
                <MagnifyingGlassIcon aria-hidden="true" size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              {isSearchOpen ? "Close search" : "Search checklist"}
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={`Checklist options. Sort: ${SORT_LABELS[sort]}${groupByArtist ? ". Grouped by artist" : ""}`}
                    className="checklist-control-trigger"
                    data-active={sort !== "project" || groupByArtist ? "" : undefined}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <ArrowsDownUpIcon aria-hidden="true" size={14} />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent className="toolbar-tooltip" side="bottom">
                {groupByArtist ? "Grouped by artist" : `Sort: ${SORT_LABELS[sort]}`}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="checklist-options-menu">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) => {
                  const nextSort = value as ChecklistSort;
                  void onChangeChecklistView(
                    nextSort === "artist"
                      ? { ...checklistView, sort: nextSort }
                      : { sort: nextSort, groupByArtist: false }
                  );
                }}
              >
                {CHECKLIST_SORTS.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {SORT_LABELS[value]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={groupByArtist}
                onCheckedChange={(checked) => {
                  const enabled = checked === true;
                  void onChangeChecklistView(
                    enabled
                      ? { sort: "artist", groupByArtist: true }
                      : { ...checklistView, groupByArtist: false }
                  );
                }}
              >
                Group by artist
              </DropdownMenuCheckboxItem>
              {groupByArtist ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={allArtistKeys.every((key) => collapsedArtistKeys.has(key))}
                    onSelect={() => setCollapsedArtistKeys(new Set(allArtistKeys))}
                  >
                    Collapse all artists
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={collapsedArtistKeys.size === 0}
                    onSelect={() => setCollapsedArtistKeys(new Set())}
                  >
                    Expand all artists
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      {rows.length > 0 && isSearchOpen ? (
        <div className="checklist-search" id={`${searchInputId}-region`} role="search">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="checklist-search-icon"
            size={14}
          />
          <label className="visually-hidden" htmlFor={searchInputId}>
            Search checklist
          </label>
          <Input
            ref={searchInputRef}
            id={searchInputId}
            placeholder="Search checklist"
            size="compact"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              clearOrCloseSearch();
            }}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={searchQuery.length > 0 ? "Clear search" : "Close search"}
                className="icon-button compact checklist-search-clear"
                size="icon-sm"
                variant="ghost"
                onClick={clearOrCloseSearch}
              >
                <XIcon aria-hidden="true" size={13} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              {searchQuery.length > 0 ? "Clear search" : "Close search"}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="checklist-empty">
          <ImageSquareIcon aria-hidden="true" size={26} />
          <p className="empty-copy">
            Drop images here or click <strong>Add Artwork</strong> to begin building the checklist.
          </p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="checklist-filter-empty">
          <p className="empty-copy">
            {searchIsActive
              ? filter === "placed"
                ? `No placed works match “${searchQuery.trim()}”.`
                : filter === "unplaced"
                  ? `No unplaced works match “${searchQuery.trim()}”.`
                  : `No works match “${searchQuery.trim()}”.`
              : filter === "placed"
                ? "Nothing placed yet."
                : "Everything is placed."}
          </p>
          {searchIsActive ? (
            <Button size="sm" variant="outline" onClick={() => setSearchQuery("")}>
              Clear search
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="checklist-list">
          {groupByArtist
            ? artistGroups.map((group) => (
                <ArtistChecklistGroup
                  key={group.key}
                  group={group}
                  isOpen={searchIsActive || !collapsedArtistKeys.has(group.key)}
                  onOpenChange={(open) => {
                    if (searchIsActive) return;
                    setCollapsedArtistKeys((current) => {
                      const next = new Set(current);
                      if (open) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    });
                  }}
                  renderRow={renderChecklistRow}
                />
              ))
            : visibleRows.map(renderChecklistRow)}
        </ul>
      )}

      <div className="checklist-actions">
        {/* modal={false}: this menu launches the Import Wizard and Artwork
            Library dialogs, and a modal menu's body pointer-events lock can be
            captured as the dialog's "restore" value while the menu's exit
            animation overlaps the dialog mount — cancelling the dialog then
            re-applies pointer-events:none to body and freezes the app. Same
            bug and fix as the topbar Export menu (e954cb2). */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button className="checklist-add" variant="primary">
              <ImageSquareIcon aria-hidden="true" size={16} />
              <span>Add artwork</span>
              <CaretDownIcon aria-hidden="true" size={13} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Quick path first: straight to the file picker, same intake as
                drag-drop. The wizard is the bulk/metadata route. */}
            <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
              <PlusIcon aria-hidden="true" size={16} />
              Add images…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenImportWizard}>
              <FileArrowUpIcon aria-hidden="true" size={16} />
              Bulk import…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenArtworkLibrary}>
              <ImageSquareIcon aria-hidden="true" size={16} />
              Add from Artwork Library…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
  );
}

// Confirm-strip copy for held duplicate uploads. Singular names the one work;
// plural lists every held title so it's clear which uploads are in question.
function duplicateNoticeCopy(
  pending: { file: File; existingArtworkTitle: string }[]
): string | null {
  if (pending.length === 0) return null;
  if (pending.length === 1) {
    return `This image looks identical to “${pending[0].existingArtworkTitle}” already in the checklist. Add it anyway?`;
  }
  const titles = pending.map((entry) => `“${entry.existingArtworkTitle}”`).join(", ");
  return `${pending.length} images look identical to works already in the checklist: ${titles}. Add them anyway?`;
}

// Artwork ids are generated (nanoid-style), never author-supplied, so this
// is a defensive belt-and-suspenders rather than a real threat model — still
// cheaper than pulling in CSS.escape's jsdom quirks for a one-line query.
function cssAttributeEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function ArtistChecklistGroup({
  group,
  isOpen,
  onOpenChange,
  renderRow
}: {
  group: ChecklistArtistGroup;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  renderRow: (row: ChecklistRowData) => ReactNode;
}) {
  const contentId = useId();
  return (
    <li className="checklist-artist-group">
      <button
        aria-controls={contentId}
        aria-expanded={isOpen}
        aria-label={`${group.label}, ${group.rows.length} work${group.rows.length === 1 ? "" : "s"}`}
        className="checklist-artist-heading"
        type="button"
        onClick={() => onOpenChange(!isOpen)}
      >
        <CaretRightIcon aria-hidden="true" className="checklist-artist-caret" size={13} />
        <span className="checklist-artist-name">{group.label}</span>
        <span aria-hidden="true" className="checklist-artist-count">
          · {group.rows.length}
        </span>
      </button>
      {isOpen ? (
        <ul
          aria-label={`${group.label} works`}
          className="checklist-artist-rows"
          id={contentId}
        >
          {group.rows.map(renderRow)}
        </ul>
      ) : null}
    </li>
  );
}

function FilterTab({
  count,
  label,
  value
}: {
  count: number;
  label: string;
  value: ChecklistFilter;
}) {
  return (
    <SegmentedToggleGroupItem
      aria-label={`${label} (${count})`}
      className="checklist-filter"
      value={value}
    >
      {label}
      <span className="checklist-filter-count">· {count}</span>
    </SegmentedToggleGroupItem>
  );
}
