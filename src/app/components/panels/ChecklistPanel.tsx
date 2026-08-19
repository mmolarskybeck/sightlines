import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/csr/ArrowsDownUp";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsSixVertical";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { ImageSquareIcon } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { ACCEPTED_IMAGE_MIME_TYPES } from "../../../domain/assets/imageIntake";
import type { Artwork, DisplayUnit, Project } from "../../../domain/project";
import { compareChecklistText } from "../../../domain/checklistExport/sort";
import { formatLength } from "../../../domain/units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../../domain/units/unitSystem";
import { useAssetImageUrls } from "../../hooks/useAssetImageUrls";
import {
  ARTWORK_DRAG_MIME,
  beginArtworkDragSession,
  emitArtworkTouchDrag,
  endArtworkDragSession
} from "../library/artworkDragSession";
import { UncertaintyIndicator } from "./UncertaintyIndicator";
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

// Coarse pointers (touch) run our long-press drag instead of HTML5 DnD; on
// those devices native `draggable` would race our long-press (iPadOS has its
// own long-press drag), so we suppress it entirely and drive touch/pen drags
// through the pointer-event path below. Evaluated once — the input type of a
// device doesn't change mid-session.
const COARSE_POINTER =
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

// Long-press timing and slop for arming a touch drag: hold ~300ms without
// straying past 10px (that's a scroll, not a press-to-drag).
const LONG_PRESS_MS = 300;
const TOUCH_DRAG_SLOP_PX = 10;

// One placement per artwork per project, so a placed row can't be dragged out
// again (spec 2026-07-07).
const ALREADY_PLACED_DRAG_MESSAGE =
  "Already placed. Remove the current placement before dragging again.";

type ChecklistFilter = "all" | "placed" | "unplaced";
export type ChecklistSort = "project" | "title" | "artist" | "status";

const CHECKLIST_SORTS: ChecklistSort[] = ["project", "title", "artist", "status"];

const SORT_LABELS: Record<ChecklistSort, string> = {
  project: "Project order",
  title: "Title",
  artist: "Artist",
  status: "Status"
};

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
  onRemoveArtworkFromChecklist: (artworkId: string) => Promise<void>;
  onRemovePlacement: (wallObjectId: string) => Promise<void>;
  onSelectArtwork: (artworkId: string) => void;
  getBlob: (key: string) => Promise<Blob>;
}) {
  const [isDropActive, setIsDropActive] = useState(false);
  const [filter, setFilter] = useState<ChecklistFilter>("all");
  const [sort, setSort] = useState<ChecklistSort>("project");
  const [groupByArtist, setGroupByArtist] = useState(false);
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

  // Search and artist disclosures are temporary workspace aids. A project
  // switch must never carry a stale query or a previous exhibition's hidden
  // artists into the newly opened checklist.
  useEffect(() => {
    if (previousProjectIdRef.current === project.id) return;
    previousProjectIdRef.current = project.id;
    setFilter("all");
    setSort("project");
    setGroupByArtist(false);
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
                  setSort(nextSort);
                  if (nextSort !== "artist") setGroupByArtist(false);
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
                  setGroupByArtist(enabled);
                  if (enabled) setSort("artist");
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

function artistGroupIdentity(row: ChecklistRowData): { key: string; label: string } {
  const artist = row.artwork?.artist?.trim();
  if (!artist) return { key: "missing-artist", label: "Artist not recorded" };
  return { key: `artist:${artist.toLocaleLowerCase()}`, label: artist };
}

// Artwork ids are generated (nanoid-style), never author-supplied, so this
// is a defensive belt-and-suspenders rather than a real threat model — still
// cheaper than pulling in CSS.escape's jsdom quirks for a one-line query.
function cssAttributeEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function byProjectOrder(a: ChecklistRowData, b: ChecklistRowData) {
  return a.projectIndex - b.projectIndex;
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

function ChecklistRow({
  artwork,
  artworkId,
  hasPlacement,
  isConfirmingRemove,
  isPlaced,
  isSelected,
  thumbnailUrl,
  unit,
  wallName,
  onCancelRemove,
  onConfirmRemove,
  onRemovePlacement,
  onRequestRemove,
  onSelect,
  onDragStateChange
}: {
  artwork: Artwork | null;
  artworkId: string;
  hasPlacement: boolean;
  isConfirmingRemove: boolean;
  isPlaced: boolean;
  isSelected: boolean;
  thumbnailUrl: string | undefined;
  unit: DisplayUnit;
  wallName: string | null;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
  onRemovePlacement: () => void;
  onRequestRemove: () => void;
  onSelect: () => void;
  onDragStateChange?: (artworkId: string | null) => void;
}) {
  const title = artwork ? artwork.title ?? "Untitled" : "Missing from library";
  // A degraded stub (library record deleted out from under the project, see
  // the module comment above) has nothing to place on a wall, so it isn't a
  // valid drag source even though it still shows up and can be selected.
  // A placed artwork can't be dragged out again — one placement per artwork
  // per project (spec 2026-07-07). The store guard is the authority; disabling
  // the drag here keeps the checklist from offering a move that would be rejected.
  const isDraggable = artwork !== null && !isPlaced;

  // A placed row's drag is a silent no-op otherwise — the only feedback was
  // the `title` tooltip above, which nothing surfaces without a hover. The
  // shared toast id dedupes repeat attempts into one visible toast rather
  // than stacking a new one per press.
  const notifyAlreadyPlaced = () => {
    if (!isPlaced) return;
    toast.warning(ALREADY_PLACED_DRAG_MESSAGE, { id: "checklist-already-placed" });
  };

  // A plain click on a placed row is how you SELECT it — that must stay
  // silent. Only a press that travels (past the same slop the touch drag
  // uses) or escapes the row while held reads as a drag attempt and warns.
  const placedPressRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    notified: boolean;
  } | null>(null);

  // Store image dimensions for creating a properly-sized drag preview with
  // correct aspect ratio (task: fix squished drag thumbnail).
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const thumbnailImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!thumbnailImgRef.current) return;
    const img = thumbnailImgRef.current;

    // Once the thumbnail image loads, measure its natural dimensions.
    // These will be used to compute the correct aspect ratio for the drag image.
    const handleLoad = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImageDimensions({
          width: img.naturalWidth,
          height: img.naturalHeight
        });
      }
    };

    if (img.complete && img.naturalWidth > 0) {
      // Image is already loaded (cached).
      handleLoad();
    } else {
      // Wait for image to load.
      img.addEventListener("load", handleLoad);
      return () => img.removeEventListener("load", handleLoad);
    }
  }, [thumbnailUrl]);

  // --- Touch/pen long-press drag ------------------------------------------
  //
  // The HTML5 drag path above is the mouse path. Touch and pen pointers can't
  // use it (iPhone Safari has no HTML5 DnD; iPadOS won't reliably fire drop),
  // so they drive a parallel pointer-event drag: hold ~300ms to arm, then the
  // finger drags a floating preview while emitArtworkTouchDrag feeds the drop
  // target's ghost. A short move before arming is a scroll and is left native.
  const rowRef = useRef<HTMLLIElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const touchDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    armed: boolean;
  } | null>(null);
  // Adding/removing the SAME function reference matters, and it must block
  // touchmove non-passively — pointer capture alone does not stop iOS from
  // scrolling the list under the finger. Held in a ref so the reference is
  // stable across renders. The initializer runs once.
  const blockTouchScrollRef = useRef((event: TouchEvent) => {
    event.preventDefault();
  });
  const [isTouchDragging, setIsTouchDragging] = useState(false);
  const [touchPreviewPos, setTouchPreviewPos] = useState<{ x: number; y: number } | null>(null);

  function cancelPendingLongPress() {
    if (longPressTimerRef.current !== undefined) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = undefined;
    }
    touchDragRef.current = null;
  }

  function teardownTouchDrag() {
    if (longPressTimerRef.current !== undefined) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = undefined;
    }
    const state = touchDragRef.current;
    const row = rowRef.current;
    if (state && row) {
      if (state.armed) {
        row.removeEventListener("touchmove", blockTouchScrollRef.current);
      }
      if (row.hasPointerCapture(state.pointerId)) {
        row.releasePointerCapture(state.pointerId);
      }
    }
    touchDragRef.current = null;
    setIsTouchDragging(false);
    setTouchPreviewPos(null);
  }

  function armTouchDrag() {
    const state = touchDragRef.current;
    const row = rowRef.current;
    if (!state || !row) return;
    state.armed = true;
    try {
      // Route every subsequent pointer event to the row even if the finger
      // strays off it, so the drag can't be stolen by a neighbouring row.
      row.setPointerCapture(state.pointerId);
    } catch {
      // The pointer may already be gone (lifted between timer schedule and
      // fire) — harmless; the ensuing pointercancel/up tears things down.
    }
    row.addEventListener("touchmove", blockTouchScrollRef.current, { passive: false });
    setIsTouchDragging(true);
    // Show the preview immediately under the finger, before the first move.
    setTouchPreviewPos({ x: state.startX, y: state.startY });
  }

  // Unmount safety: a row can scroll out (list re-sort/filter) mid-press.
  useEffect(() => {
    const blocker = blockTouchScrollRef.current;
    return () => {
      if (longPressTimerRef.current !== undefined) clearTimeout(longPressTimerRef.current);
      rowRef.current?.removeEventListener("touchmove", blocker);
    };
  }, []);

  let dimensionsText: string | undefined;
  if (
    artwork &&
    artwork.dimensions.widthMm !== undefined &&
    artwork.dimensions.heightMm !== undefined
  ) {
    dimensionsText = `${formatLength(artwork.dimensions.widthMm, { unit })} × ${formatLength(
      artwork.dimensions.heightMm,
      { unit }
    )}`;
  }
  // "unknown" deliberately gets no badge — it's the default state of every
  // fresh import, and line 3 now collapses entirely in that case (below).
  const showApproximate = artwork !== null && artwork.dimensions.status === "approximate";
  // Line 2 collapses on a blank/whitespace-only artist as well as a missing
  // one, so a record carrying "" doesn't open an empty row.
  const artistName = artwork?.artist?.trim() ? artwork.artist.trim() : null;
  // Only placed rows carry a tag now; unplaced is the silent default.
  const tagLabel = wallName ?? "Placed";
  // Line 3 renders only when it has something to say. A work with no
  // dimensions that isn't placed yet has nothing for this line, and the
  // em-dash placeholder it used to draw was a full line of row height
  // carrying zero information — repeated down a sketching curator's whole
  // checklist, since "no dimensions yet" is the default state of every fresh
  // import. Same collapse as the missing-artist case on line 2.
  const showMeta = dimensionsText !== undefined || showApproximate || isPlaced;

  const rowClassName = [
    "checklist-row",
    isSelected ? "selected" : "",
    isTouchDragging ? "touch-dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
    <li
      ref={rowRef}
      aria-pressed={isSelected}
      className={rowClassName}
      // Lets the panel's scroll-into-view effect find this row by artwork id
      // without threading a ref map through ChecklistRow.
      data-artwork-id={artworkId}
      // Coarse pointers use our long-press drag (below); native draggable would
      // race iPadOS's own long-press, so it's suppressed there.
      draggable={isDraggable && !COARSE_POINTER}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onPointerDown={
        isDraggable
          ? (event) => {
              // Mouse keeps the HTML5 path; only touch/pen arm a long-press.
              if (event.pointerType === "mouse" || !event.isPrimary) return;
              // Don't preventDefault: a tap must still select and a vertical
              // swipe must still scroll the list until the press arms.
              touchDragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                armed: false
              };
              if (longPressTimerRef.current !== undefined) {
                clearTimeout(longPressTimerRef.current);
              }
              longPressTimerRef.current = setTimeout(armTouchDrag, LONG_PRESS_MS);
            }
          : isPlaced
          ? (event) => {
              if (!event.isPrimary) return;
              placedPressRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                notified: false
              };
            }
          : undefined
      }
      onPointerMove={
        isDraggable
          ? (event) => {
              const state = touchDragRef.current;
              if (!state || state.pointerId !== event.pointerId) return;
              if (!state.armed) {
                // Straying past the slop before arming means the user is
                // scrolling — abandon the press and let the list scroll.
                const dx = event.clientX - state.startX;
                const dy = event.clientY - state.startY;
                if (dx * dx + dy * dy > TOUCH_DRAG_SLOP_PX * TOUCH_DRAG_SLOP_PX) {
                  cancelPendingLongPress();
                }
                return;
              }
              setTouchPreviewPos({ x: event.clientX, y: event.clientY });
              emitArtworkTouchDrag({
                type: "move",
                artworkId,
                clientX: event.clientX,
                clientY: event.clientY
              });
            }
          : isPlaced
          ? (event) => {
              const state = placedPressRef.current;
              if (!state || state.pointerId !== event.pointerId || state.notified) return;
              const dx = event.clientX - state.startX;
              const dy = event.clientY - state.startY;
              if (dx * dx + dy * dy > TOUCH_DRAG_SLOP_PX * TOUCH_DRAG_SLOP_PX) {
                state.notified = true;
                notifyAlreadyPlaced();
              }
            }
          : undefined
      }
      onPointerUp={
        isDraggable
          ? (event) => {
              const state = touchDragRef.current;
              if (!state || state.pointerId !== event.pointerId) return;
              if (state.armed) {
                emitArtworkTouchDrag({
                  type: "drop",
                  artworkId,
                  clientX: event.clientX,
                  clientY: event.clientY
                });
                teardownTouchDrag();
              } else {
                // Never armed → this was a tap; onClick selects.
                cancelPendingLongPress();
              }
            }
          : isPlaced
          ? () => {
              placedPressRef.current = null;
            }
          : undefined
      }
      onPointerCancel={
        isDraggable
          ? (event) => {
              const state = touchDragRef.current;
              if (!state || state.pointerId !== event.pointerId) return;
              if (state.armed) emitArtworkTouchDrag({ type: "cancel", artworkId });
              teardownTouchDrag();
            }
          : isPlaced
          ? () => {
              placedPressRef.current = null;
            }
          : undefined
      }
      onPointerLeave={
        isDraggable
          ? (event) => {
              const state = touchDragRef.current;
              if (!state || state.pointerId !== event.pointerId) return;
              // Once armed the pointer is captured, so leave won't fire; before
              // arming, leaving the row abandons the pending press.
              if (!state.armed) cancelPendingLongPress();
            }
          : isPlaced
          ? (event) => {
              const state = placedPressRef.current;
              if (!state || state.pointerId !== event.pointerId) return;
              // Escaping the row while still held is a drag attempt too.
              if (!state.notified && event.buttons > 0) notifyAlreadyPlaced();
              placedPressRef.current = null;
            }
          : undefined
      }
      onDragStart={
        isDraggable
          ? (event) => {
              // A touch long-press may still fire native dragstart on hybrid
              // devices (Chrome on a touch laptop) — our pointer drag owns it.
              if (touchDragRef.current?.armed) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.setData(ARTWORK_DRAG_MIME, artworkId);
              // iPadOS may cancel drops whose only payload is an unrecognized
              // custom type, so carry a standard one too.
              event.dataTransfer.setData("text/plain", artworkId);
              event.dataTransfer.effectAllowed = "copy";

              // Create a properly-sized drag image that preserves aspect ratio
              // (fix for squished drag thumbnail). Max size is 120px on the
              // longer dimension, scaled down proportionally.
              if (imageDimensions && thumbnailUrl && thumbnailImgRef.current) {
                const MAX_DIM = 120;
                const { width, height } = imageDimensions;
                const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
                const dragWidth = Math.round(width * scale);
                const dragHeight = Math.round(height * scale);

                const canvas = document.createElement("canvas");
                canvas.width = dragWidth;
                canvas.height = dragHeight;

                // Draw the thumbnail image onto the canvas, preserving aspect ratio.
                const ctx = canvas.getContext("2d");
                if (ctx) {
                  ctx.drawImage(thumbnailImgRef.current, 0, 0, dragWidth, dragHeight);
                  event.dataTransfer.setDragImage(canvas, dragWidth / 2, dragHeight / 2);
                }
              }

              onDragStateChange?.(artworkId);
              beginArtworkDragSession(artworkId);
            }
          : isPlaced
          ? (event) => {
              // The row itself isn't draggable, but the thumbnail <img> is
              // natively draggable by default and its dragstart still
              // bubbles here — block it so a placed row's image can't be
              // dragged out on its own.
              event.preventDefault();
              notifyAlreadyPlaced();
            }
          : undefined
      }
      onDragEnd={
        isDraggable
          ? () => {
              onDragStateChange?.(null);
              endArtworkDragSession();
            }
          : undefined
      }
      onKeyDown={(event) => {
        // Escape backs out of an armed remove-confirm — it bubbles here from
        // the strip's own buttons too, so focus can be anywhere in the row.
        if (event.key === "Escape" && isConfirmingRemove) {
          event.preventDefault();
          onCancelRemove();
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect();
      }}
    >
      {isDraggable ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="checklist-grip">
              <DotsSixVerticalIcon aria-hidden="true" weight="bold" size={16} />
            </span>
          </TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="left">
            Drag into exhibition plan
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="checklist-grip">
          <DotsSixVerticalIcon aria-hidden="true" weight="bold" size={16} />
        </span>
      )}
      {thumbnailUrl ? (
        <img
          ref={thumbnailImgRef}
          alt=""
          className="checklist-thumb"
          src={thumbnailUrl}
        />
      ) : (
        <div aria-hidden="true" className="checklist-thumb placeholder" />
      )}
      {/* Up to three lines: title, artist, then the meta line. Only the title
          always renders. Lines 2 and 3 are dropped entirely rather than
          rendered empty or placeholdered — a line that exists only to say
          "nothing here" is row height spent on noise, and repeated down a
          list it becomes the pane's dominant texture. The row's height is
          unaffected either way (see .checklist-row's min-height derivation),
          so collapsing costs no rhythm. */}
      <div className="checklist-row-main">
        <span className={artwork ? "checklist-title" : "checklist-title missing"}>
          {title}
        </span>
        {artistName ? <span className="checklist-artist">{artistName}</span> : null}
        {showMeta ? (
          <span className="checklist-meta">
            {/* The em-dash survives only where the line is rendered for some
                OTHER reason — a placed work whose dimensions aren't recorded,
                or an approximate-status record. There it's meaningful: it
                says "measured? no" next to a fact that is known. It is never
                a danger badge; missing dimensions are the default state of a
                freshly imported work, not an error. Approximate dimensions DO
                stay badged — a real exception, caution-toned, not danger. */}
            <span className="checklist-dims">{dimensionsText ?? "—"}</span>
            {showApproximate ? (
              <UncertaintyIndicator compact status="approximate" />
            ) : null}
            {isPlaced ? (
              <>
                <span aria-hidden="true" className="checklist-meta-sep">
                  ·
                </span>
                <span className="checklist-tag placed">{tagLabel}</span>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      {isConfirmingRemove ? (
        <div className="checklist-remove-confirmation">
          {/* Names the consequence and its limit in one breath: this drops the
              work from THIS checklist, the Library copy is untouched. */}
          <span>Remove? It stays in your Artwork Library.</span>
          <Button
            size="sm"
            variant="destructive"
            onClick={(event) => {
              event.stopPropagation();
              onConfirmRemove();
            }}
          >
            Remove
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Cancel remove"
                className="icon-button compact"
                size="icon-sm"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  onCancelRemove();
                }}
              >
                <XIcon aria-hidden="true" size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="left">
              Cancel
            </TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <div className="checklist-row-actions">
          {/* One trailing control, not two. Unplacing used to be a standalone
              X rendered permanently-but-disabled on unplaced rows — which
              cost 26px of title column on every row to show a control that is
              inert on most of them, and made "why can't I click this?" the
              row's most common question. Both problems have the same fix:
              move it into the menu, where an action that doesn't apply is
              simply absent. The trigger itself stays unconditional and
              fixed-width, so the title column still never reflows as a row
              moves between placed and unplaced — that guarantee is why the
              disabled X existed, and it survives the X.

              modal={false} for the same body pointer-events reason as the
              panel's Add artwork menu above. */}
          <DropdownMenu modal={false}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={`More actions for ${title}`}
                    className="icon-button compact checklist-row-menu"
                    size="icon-sm"
                    variant="ghost"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <DotsThreeIcon aria-hidden="true" weight="bold" size={16} />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent className="toolbar-tooltip" side="left">
                Artwork actions
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              {/* Present only when there's a placement to remove. Not
                  destructive-toned: this returns the work to the checklist's
                  unplaced pool, it doesn't destroy anything. */}
              {hasPlacement ? (
                <DropdownMenuItem onSelect={onRemovePlacement}>
                  <XIcon aria-hidden="true" size={16} />
                  Remove from wall
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="checklist-row-menu-destructive"
                onSelect={onRequestRemove}
              >
                <TrashIcon aria-hidden="true" size={16} />
                Remove from checklist
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
    {isTouchDragging && touchPreviewPos
      ? createPortal(
          <ArtworkDragPreview
            imageDimensions={imageDimensions}
            thumbnailUrl={thumbnailUrl}
            x={touchPreviewPos.x}
            y={touchPreviewPos.y}
          />,
          document.body
        )
      : null}
    </>
  );
}

// The floating thumbnail that follows the finger during a touch drag — the
// pointer-event equivalent of the HTML5 setDragImage canvas. Fixed-position and
// pointer-events:none so it can't intercept the drag it's a preview of;
// centered on the finger; honours the artwork's aspect when known (~96px on the
// longest edge), else a neutral square.
function ArtworkDragPreview({
  imageDimensions,
  thumbnailUrl,
  x,
  y
}: {
  imageDimensions: { width: number; height: number } | null;
  thumbnailUrl: string | undefined;
  x: number;
  y: number;
}) {
  const MAX_EDGE = 96;
  let width = MAX_EDGE;
  let height = MAX_EDGE;
  if (imageDimensions && imageDimensions.width > 0 && imageDimensions.height > 0) {
    const scale = Math.min(MAX_EDGE / imageDimensions.width, MAX_EDGE / imageDimensions.height);
    width = Math.round(imageDimensions.width * scale);
    height = Math.round(imageDimensions.height * scale);
  }
  return (
    <div
      aria-hidden="true"
      className="artwork-drag-preview"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${x}px, ${y}px) translate(-50%, -50%)`
      }}
    >
      {thumbnailUrl ? (
        <img alt="" src={thumbnailUrl} />
      ) : (
        <div className="artwork-drag-preview-placeholder" />
      )}
    </div>
  );
}
