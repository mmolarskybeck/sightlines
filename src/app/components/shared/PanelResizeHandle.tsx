import { useRef, useState } from "react";
import { clamp } from "../../../domain/geometry/scalar";

// How far past `min` a drag has to travel (in the collapsing direction)
// before it snaps the pane shut instead of just resting at its floor. Without
// slack, a drag that overshoots by a pixel while aiming for "small but still
// open" would collapse the pane the instant it touches min — this threshold
// gives the user room to park right at the floor before the gesture commits
// to a full collapse.
const COLLAPSE_THRESHOLD = 64;

// A hand-rolled drag handle for the resizable workspace panels — deliberately
// not a dependency (the app has no split-pane library and one thin pointer
// handler covers both seams). It renders a vertical splitter that sits centered
// on the seam between two panes; the resting hairline is the panel's own border
// (this element is transparent until hover), matching the "quiet until touched"
// design language.
//
// It's an ARIA window-splitter: role="separator" + tabindex makes it a focus
// stop, aria-orientation="vertical" describes the split, and the value trio
// (min/max/now, in px) lets assistive tech announce the current size. Arrow
// keys nudge; which arrow grows the pane depends on the side, since the left
// panel widens rightward and the right inspector widens leftward.
export function PanelResizeHandle({
  side,
  width,
  min,
  max,
  label,
  onResize,
  onCollapse
}: {
  // Which pane this handle resizes — "left" (checklist/rooms) grows as the
  // pointer moves right; "right" (inspector) grows as it moves left.
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  label: string;
  onResize: (nextWidth: number) => void;
  // Dragging well past `min` collapses the pane instead of just parking at
  // the floor — the same outcome as the rail toggle. Optional because the
  // caller decides whether a given seam supports drag-to-collapse; when
  // omitted, dragging simply clamps at `min` as before. The handle itself
  // unmounts once the pane collapses (its `visible*` state goes away), so
  // this fires at most once per drag.
  onCollapse?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  // Latch the down-press origin so a drag measures from where the grab
  // started, not from a stale render's width — the store update is async, so
  // reading `width` mid-drag would lag a frame.
  const dragOrigin = useRef<{ pointerX: number; startWidth: number } | null>(null);
  // A pointer moving right is +delta; the left pane consumes that directly
  // while the right pane (inspector) inverts it, so both feel natural.
  const directionSign = side === "left" ? 1 : -1;

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Ignore secondary buttons so a right-click never starts a phantom drag.
    if (event.button !== 0) return;
    event.preventDefault();
    dragOrigin.current = { pointerX: event.clientX, startWidth: width };
    setDragging(true);
    // Pointer capture keeps move/up events flowing to this element even when
    // the pointer strays over the canvas or the neighbouring panel mid-drag.
    event.currentTarget.setPointerCapture(event.pointerId);
    // A body-wide class forces the col-resize cursor everywhere and kills text
    // selection for the duration, so dragging over the canvas or a label never
    // flickers the cursor or selects stray text.
    document.body.classList.add("panels-resizing");
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const origin = dragOrigin.current;
    if (!origin) return;
    const delta = (event.clientX - origin.pointerX) * directionSign;
    // The raw (unclamped) width is what decides collapse — clamping first
    // would hide how far past `min` the pointer actually travelled.
    const rawWidth = origin.startWidth + delta;
    if (onCollapse && rawWidth < min - COLLAPSE_THRESHOLD) {
      // Past the collapse threshold: end the drag ourselves (this component
      // is about to unmount as the pane collapses, so no further pointer
      // events will reach it) and hand off to the caller. Cleanup runs
      // first so nothing here touches a detached element after onCollapse
      // triggers the unmount.
      endDrag(event);
      onCollapse();
      return;
    }
    onResize(clamp(rawWidth, min, max));
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragOrigin.current) return;
    dragOrigin.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.classList.remove("panels-resizing");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // 16px per press (a comfortable, visible step), 48px with Shift for a
    // coarse jump. Arrow direction follows the same side logic as the drag.
    const step = (event.shiftKey ? 48 : 16) * directionSign;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onResize(clamp(width - step, min, max));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onResize(clamp(width + step, min, max));
    } else if (event.key === "Home") {
      event.preventDefault();
      onResize(min);
    } else if (event.key === "End") {
      event.preventDefault();
      onResize(max);
    }
  }

  return (
    <div
      className={`panel-resize-handle ${side}${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}
