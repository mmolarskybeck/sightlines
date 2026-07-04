import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { ACCEPTED_IMAGE_MIME_TYPES } from "../../domain/assets/imageIntake";
import type { Artwork, Project } from "../../domain/project";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import { UncertaintyIndicator } from "./UncertaintyIndicator";

// MIME key for the HTML5 drag payload carrying an artworkId — a later task
// wires the elevation view's drop target to read this same constant, so the
// drag source and drop target can't drift out of sync on the string value.
export const ARTWORK_DRAG_MIME = "application/x-sightlines-artwork";

type ChecklistRowData = {
  artworkId: string;
  artwork: Artwork | null;
  isPlaced: boolean;
};

// The sidebar's second nav section (docs/plan.md §3.5, §4.1): checklist
// membership is independent of both the library and wall placement, so a row
// here can be a fully-formed artwork, or — if its library record has since
// been deleted out from under this project — a degraded stub that still
// shows up rather than silently disappearing.
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
  // dragenter/dragleave fire on every child element the pointer crosses, not
  // just the section boundary — a plain enter/leave toggle would flicker the
  // drop-active state as the drag passes over rows and buttons. Counting
  // nesting depth keeps it lit until the drag has actually left the section.
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const artworksById = new Map(libraryArtworks.map((artwork) => [artwork.id, artwork]));
  const placedArtworkIds = new Set(
    project.wallObjects
      .filter((wallObject) => wallObject.kind === "artwork")
      .map((wallObject) => wallObject.artworkId)
  );

  const rows: ChecklistRowData[] = project.checklistArtworkIds.map((artworkId) => ({
    artworkId,
    artwork: artworksById.get(artworkId) ?? null,
    isPlaced: placedArtworkIds.has(artworkId)
  }));

  const thumbnailUrlsByAssetId = useAssetImageUrls(
    rows.map((row) => row.artwork?.assetId),
    getBlob
  );

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
          <button
            aria-label="Add artwork"
            className="icon-button compact"
            title="Add artwork"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus aria-hidden="true" size={16} />
          </button>
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

      {rows.length === 0 ? (
        <p className="empty-copy">Drop images here or click + — no room required.</p>
      ) : (
        <ul className="checklist-list">
          {rows.map((row) => (
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
              onRemove={() => void onRemoveArtworkFromChecklist(row.artworkId)}
              onSelect={() => onSelectArtwork(row.artworkId)}
              onDragStateChange={onArtworkDragStateChange}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChecklistRow({
  artwork,
  artworkId,
  isPlaced,
  isSelected,
  thumbnailUrl,
  onRemove,
  onSelect,
  onDragStateChange
}: {
  artwork: Artwork | null;
  artworkId: string;
  isPlaced: boolean;
  isSelected: boolean;
  thumbnailUrl: string | undefined;
  onRemove: () => void;
  onSelect: () => void;
  onDragStateChange?: (artworkId: string | null) => void;
}) {
  const title = artwork ? artwork.title ?? "Untitled" : "Missing from library";
  // A degraded stub (library record deleted out from under the project, see
  // the module comment above) has nothing to place on a wall, so it isn't a
  // valid drag source even though it still shows up and can be selected.
  const isDraggable = artwork !== null;

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
      {thumbnailUrl ? (
        <img alt="" className="checklist-thumb" src={thumbnailUrl} />
      ) : (
        <div aria-hidden="true" className="checklist-thumb placeholder" />
      )}
      <span className={artwork ? "checklist-title" : "checklist-title missing"}>
        {title}
      </span>
      {artwork && artwork.dimensions.status !== "known" ? (
        <UncertaintyIndicator compact status={artwork.dimensions.status} />
      ) : null}
      <span className="checklist-tag">{isPlaced ? "Placed" : "Unplaced"}</span>
      <button
        aria-label="Remove from checklist"
        className="icon-button compact"
        title="Remove from checklist"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <X aria-hidden="true" size={14} />
      </button>
    </li>
  );
}
