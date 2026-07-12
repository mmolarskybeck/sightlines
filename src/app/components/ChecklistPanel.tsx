import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/csr/ArrowsDownUp";
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsSixVertical";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { ImageSquareIcon } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { ACCEPTED_IMAGE_MIME_TYPES } from "../../domain/assets/imageIntake";
import type { Artwork, DisplayUnit, Project } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import {
  beginArtworkDragSession,
  emitArtworkTouchDrag,
  endArtworkDragSession
} from "./artworkDragSession";
import { UncertaintyIndicator } from "./UncertaintyIndicator";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "./ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";
import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem
} from "./ui/segmented";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// MIME key for the HTML5 drag payload carrying an artworkId — a later task
// wires the elevation view's drop target to read this same constant, so the
// drag source and drop target can't drift out of sync on the string value.
export const ARTWORK_DRAG_MIME = "application/x-sightlines-artwork";

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

// Shared with the row's `title` tooltip below — one placement per artwork
// per project, so a placed row can't be dragged out again (spec 2026-07-07).
const ALREADY_PLACED_DRAG_MESSAGE =
  "Already placed — drag is disabled. Duplicate the project to try another arrangement.";

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
  // there's at most one, but the X button removes all of them so a row
  // never ends up half-unplaced.
  placementIds: string[];
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
  // dragenter/dragleave fire on every child element the pointer crosses, not
  // just the section boundary — a plain enter/leave toggle would flicker the
  // drop-active state as the drag passes over rows and buttons. Counting
  // nesting depth keeps it lit until the drag has actually left the section.
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const rows: ChecklistRowData[] = project.checklistArtworkIds.map((artworkId, projectIndex) => {
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
  });

  const placedCount = rows.filter((row) => row.isPlaced).length;
  const unplacedCount = rows.length - placedCount;
  const visibleRows = sortChecklistRows(
    rows.filter((row) =>
      filter === "placed" ? row.isPlaced : filter === "unplaced" ? !row.isPlaced : true
    ),
    sort
  );

  const thumbnailUrlsByAssetId = useAssetImageUrls(
    rows.map((row) => row.artwork?.assetId),
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

  return (
    <section
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
            {rows.length} work{rows.length === 1 ? "" : "s"}
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
        <div className="checklist-controls">
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
              count={rows.length}
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

          {/* Sort is deliberately subordinate to the filter tabs: an
              icon-only trigger docked at the track's right end, behind a
              hairline divider so it reads as part of the same instrument.
              The Select semantics are unchanged — the visually-hidden
              SelectValue still announces the active sort — and a
              non-default sort tints the icon petrol so a surprising row
              order always has a visible cause. */}
          <div aria-hidden="true" className="checklist-sort-divider" />
          <Select value={sort} onValueChange={(value) => setSort(value as ChecklistSort)}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectTrigger
                  aria-label="Sort checklist"
                  className="checklist-sort-trigger"
                  data-nondefault={sort === "project" ? undefined : ""}
                >
                  <ArrowsDownUpIcon aria-hidden="true" size={14} />
                  <span className="visually-hidden">
                    <SelectValue />
                  </span>
                </SelectTrigger>
              </TooltipTrigger>
              <TooltipContent className="toolbar-tooltip" side="bottom">
                Sort: {SORT_LABELS[sort]}
              </TooltipContent>
            </Tooltip>
            <SelectContent align="end">
              {CHECKLIST_SORTS.map((value) => (
                <SelectItem key={value} value={value}>
                  {SORT_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        <p className="empty-copy checklist-filter-empty">
          {filter === "placed" ? "Nothing placed yet." : "Everything is placed."}
        </p>
      ) : (
        <ul className="checklist-list">
          {visibleRows.map((row) => (
            <ChecklistRow
              key={row.artworkId}
              artwork={row.artwork}
              artworkId={row.artworkId}
              isPlaced={row.isPlaced}
              isSelected={row.artworkId === selectedArtworkId}
              thumbnailUrl={
                row.artwork?.assetId
                  ? thumbnailUrlsByAssetId.get(row.artwork.assetId)
                  : undefined
              }
              unit={artworkUnit}
              wallName={row.wallName}
              onRemove={() => {
                // Placed: the X unplaces (removes the placement(s), keeps
                // the checklist row) — deleting from the checklist entirely
                // is a separate affordance for later. Unplaced: the X still
                // removes the row, same as before.
                if (row.placementIds.length > 0) {
                  for (const placementId of row.placementIds) {
                    void onRemovePlacement(placementId);
                  }
                  return;
                }
                void onRemoveArtworkFromChecklist(row.artworkId);
              }}
              onSelect={() => onSelectArtwork(row.artworkId)}
              onDragStateChange={onArtworkDragStateChange}
            />
          ))}
        </ul>
      )}

      <div className="checklist-actions">
        <DropdownMenu>
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
        return byText(a.artwork?.title, b.artwork?.title) || byProjectOrder(a, b);
      case "artist":
        return (
          byText(a.artwork?.artist, b.artwork?.artist) ||
          byText(a.artwork?.title, b.artwork?.title) ||
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

function byProjectOrder(a: ChecklistRowData, b: ChecklistRowData) {
  return a.projectIndex - b.projectIndex;
}

function byText(a: string | undefined, b: string | undefined) {
  const aText = a?.trim();
  const bText = b?.trim();
  if (aText && bText) return aText.localeCompare(bText, undefined, { sensitivity: "base" });
  if (aText) return -1;
  if (bText) return 1;
  return 0;
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
  isPlaced,
  isSelected,
  thumbnailUrl,
  unit,
  wallName,
  onRemove,
  onSelect,
  onDragStateChange
}: {
  artwork: Artwork | null;
  artworkId: string;
  isPlaced: boolean;
  isSelected: boolean;
  thumbnailUrl: string | undefined;
  unit: DisplayUnit;
  wallName: string | null;
  onRemove: () => void;
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
  const showUncertainty = artwork !== null && artwork.dimensions.status !== "known";
  const hasMeta = dimensionsText !== undefined || showUncertainty;
  const tagLabel = isPlaced ? wallName ?? "Placed" : "Unplaced";

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
      // Coarse pointers use our long-press drag (below); native draggable would
      // race iPadOS's own long-press, so it's suppressed there.
      draggable={isDraggable && !COARSE_POINTER}
      title={isPlaced ? ALREADY_PLACED_DRAG_MESSAGE : undefined}
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
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect();
      }}
    >
      <DotsSixVerticalIcon aria-hidden="true" className="checklist-grip" size={16} />
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
      <div className="checklist-row-main">
        <span className="checklist-title-line">
          <span className={artwork ? "checklist-title" : "checklist-title missing"}>
            {title}
          </span>
        </span>
        <span className="checklist-artist-line">
          {artwork?.artist ? <span className="checklist-artist">{artwork.artist}</span> : <span />}
          <span className={isPlaced ? "checklist-tag placed" : "checklist-tag"}>
            {tagLabel}
          </span>
        </span>
        {hasMeta ? (
          <span className="checklist-meta">
            {dimensionsText ? <span>{dimensionsText}</span> : null}
            {showUncertainty ? (
              <UncertaintyIndicator compact status={artwork.dimensions.status} />
            ) : null}
          </span>
        ) : null}
      </div>
      <Button
        aria-label={isPlaced ? "Remove placement" : "Remove from checklist"}
        className="icon-button compact checklist-remove"
        size="icon-sm"
        title={isPlaced ? "Remove placement" : "Remove from checklist"}
        variant="outline"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <XIcon aria-hidden="true" size={14} />
      </Button>
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
