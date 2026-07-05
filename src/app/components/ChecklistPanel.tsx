import { useMemo, useRef, useState } from "react";
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsSixVertical";
import { ImageSquareIcon } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { ACCEPTED_IMAGE_MIME_TYPES } from "../../domain/assets/imageIntake";
import type { Artwork, DisplayUnit, Project } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import { UncertaintyIndicator } from "./UncertaintyIndicator";
import { Button } from "./ui/button";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

// MIME key for the HTML5 drag payload carrying an artworkId — a later task
// wires the elevation view's drop target to read this same constant, so the
// drag source and drop target can't drift out of sync on the string value.
export const ARTWORK_DRAG_MIME = "application/x-sightlines-artwork";

type ChecklistFilter = "all" | "placed" | "unplaced";

type ChecklistRowData = {
  artworkId: string;
  artwork: Artwork | null;
  isPlaced: boolean;
  // The wall a placed artwork lives on, resolved to a human name — null when
  // unplaced, or when the placement points at a wall that no longer exists.
  wallName: string | null;
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
  onAddArtworksFromFiles,
  onArtworkDragStateChange,
  onRemoveArtworkFromChecklist,
  onSelectArtwork,
  getBlob
}: {
  project: Project;
  libraryArtworks: Artwork[];
  intakeState: "idle" | "processing";
  selectedArtworkId: string | null;
  onAddArtworksFromFiles: (files: File[]) => Promise<void>;
  // Optional: App.tsx uses this to track which artwork is mid-drag so
  // ElevationView can size its drop ghost during dragover, since dataTransfer
  // payloads are unreadable until drop. Fired with the artworkId on
  // dragstart and null on dragend.
  onArtworkDragStateChange?: (artworkId: string | null) => void;
  onRemoveArtworkFromChecklist: (artworkId: string) => Promise<void>;
  onSelectArtwork: (artworkId: string) => void;
  getBlob: (key: string) => Promise<Blob>;
}) {
  const [isDropActive, setIsDropActive] = useState(false);
  const [filter, setFilter] = useState<ChecklistFilter>("all");
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
  const { placedArtworkWallIds, wallNamesById } = useMemo(() => {
    const wallNames = new Map<string, string>();
    for (const placement of project.floor.rooms) {
      for (const wall of placement.room.walls) {
        wallNames.set(wall.id, wall.name);
      }
    }

    const placedWalls = new Map<string, string>();
    for (const wallObject of project.wallObjects) {
      if (wallObject.kind === "artwork") {
        placedWalls.set(wallObject.artworkId, wallObject.wallId);
      }
    }

    return { placedArtworkWallIds: placedWalls, wallNamesById: wallNames };
  }, [project.floor.rooms, project.wallObjects]);

  const rows: ChecklistRowData[] = project.checklistArtworkIds.map((artworkId) => {
    const wallId = placedArtworkWallIds.get(artworkId);
    return {
      artworkId,
      artwork: artworksById.get(artworkId) ?? null,
      isPlaced: wallId !== undefined,
      wallName: wallId !== undefined ? (wallNamesById.get(wallId) ?? null) : null
    };
  });

  const placedCount = rows.filter((row) => row.isPlaced).length;
  const unplacedCount = rows.length - placedCount;
  const visibleRows = rows.filter((row) =>
    filter === "placed" ? row.isPlaced : filter === "unplaced" ? !row.isPlaced : true
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

      {rows.length > 0 ? (
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
              onRemove={() => void onRemoveArtworkFromChecklist(row.artworkId)}
              onSelect={() => onSelectArtwork(row.artworkId)}
              onDragStateChange={onArtworkDragStateChange}
            />
          ))}
        </ul>
      )}

      <Button
        className="checklist-add"
        variant="primary"
        onClick={() => fileInputRef.current?.click()}
      >
        <ImageSquareIcon aria-hidden="true" size={16} />
        <span>Add Artwork</span>
      </Button>
    </section>
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
  const isDraggable = artwork !== null;

  const metaParts: string[] = [];
  if (artwork?.artist) metaParts.push(artwork.artist);
  if (
    artwork &&
    artwork.dimensions.widthMm !== undefined &&
    artwork.dimensions.heightMm !== undefined
  ) {
    metaParts.push(
      `${formatLength(artwork.dimensions.widthMm, { unit })} × ${formatLength(
        artwork.dimensions.heightMm,
        { unit }
      )}`
    );
  }
  const showUncertainty = artwork !== null && artwork.dimensions.status !== "known";
  const hasMeta = metaParts.length > 0 || showUncertainty;
  const tagLabel = isPlaced ? wallName ?? "Placed" : "Unplaced";

  return (
    <li
      aria-pressed={isSelected}
      className={isSelected ? "checklist-row selected" : "checklist-row"}
      draggable={isDraggable}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDragStart={
        isDraggable
          ? (event) => {
              event.dataTransfer.setData(ARTWORK_DRAG_MIME, artworkId);
              event.dataTransfer.effectAllowed = "copy";
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
        <img alt="" className="checklist-thumb" src={thumbnailUrl} />
      ) : (
        <div aria-hidden="true" className="checklist-thumb placeholder" />
      )}
      <div className="checklist-row-main">
        <span className="checklist-title-line">
          <span className={artwork ? "checklist-title" : "checklist-title missing"}>
            {title}
          </span>
          <span className={isPlaced ? "checklist-tag placed" : "checklist-tag"}>
            {tagLabel}
          </span>
        </span>
        {hasMeta ? (
          <span className="checklist-meta">
            {metaParts.length > 0 ? <span>{metaParts.join(" · ")}</span> : null}
            {showUncertainty ? (
              <UncertaintyIndicator compact status={artwork.dimensions.status} />
            ) : null}
          </span>
        ) : null}
      </div>
      <Button
        aria-label="Remove from checklist"
        className="icon-button compact checklist-remove"
        size="icon-sm"
        title="Remove from checklist"
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
