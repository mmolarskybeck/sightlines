import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/csr/ArrowsDownUp";
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsSixVertical";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { ImageSquareIcon } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { ACCEPTED_IMAGE_MIME_TYPES } from "../../domain/assets/imageIntake";
import type { Artwork, DisplayUnit, Project } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import { UncertaintyIndicator } from "./UncertaintyIndicator";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// MIME key for the HTML5 drag payload carrying an artworkId — a later task
// wires the elevation view's drop target to read this same constant, so the
// drag source and drop target can't drift out of sync on the string value.
export const ARTWORK_DRAG_MIME = "application/x-sightlines-artwork";

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
          <ToggleGroup
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
          </ToggleGroup>

          {/* Sort is deliberately subordinate to the filter tabs: an
              icon-only trigger at the row's right edge. The Select semantics
              are unchanged — the visually-hidden SelectValue still announces
              the active sort — and a non-default sort tints the icon petrol
              so a surprising row order always has a visible cause. */}
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
              <TooltipContent side="bottom">Sort: {SORT_LABELS[sort]}</TooltipContent>
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
            Drop images here or click Add Artwork — no room required.
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
        <Button
          className="checklist-add-images"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageSquareIcon aria-hidden="true" size={16} />
          <span>Add images</span>
        </Button>
        <Button className="checklist-add" variant="primary" onClick={onOpenImportWizard}>
          <FileArrowUpIcon aria-hidden="true" size={16} />
          <span>Import</span>
        </Button>
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
    <ToggleGroupItem
      className="checklist-filter"
      size="sm"
      variant="tab"
      value={value}
    >
      {label} · {count}
    </ToggleGroupItem>
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

  return (
    <li
      aria-pressed={isSelected}
      className={isSelected ? "checklist-row selected" : "checklist-row"}
      draggable={isDraggable}
      title={
        isPlaced
          ? "Already placed — drag is disabled. Duplicate the project to try another arrangement."
          : undefined
      }
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDragStart={
        isDraggable
          ? (event) => {
              event.dataTransfer.setData(ARTWORK_DRAG_MIME, artworkId);
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
            }
          : undefined
      }
      onDragEnd={isDraggable ? () => onDragStateChange?.(null) : undefined}
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
  );
}
