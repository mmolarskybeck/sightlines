import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsSixVertical";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { Artwork, DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
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

export function ChecklistRow({
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
