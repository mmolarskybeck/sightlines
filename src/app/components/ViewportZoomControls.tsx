import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { Button } from "./ui/button";

// Floating zoom cluster for the 2D drawing surfaces — anchored bottom-right
// inside the canvas (opposite the top-right PlanToolbar). Reads
// `[Fit] [−] 82% [+]`, plus a `[Fit selected]` before `Fit` when a selection-
// framing callback is provided (elevation, a later task). The percentage is
// the effective zoom relative to fit and doubles as a reset-to-fit button.
//
// Every button blurs itself on click: a lingering focus would let a following
// Space press re-activate the button instead of engaging the pan gesture.
export function ViewportZoomControls({
  zoom,
  isFit,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onFit,
  onFitSelected,
  fitSelectedDisabled
}: {
  zoom: number; // effective zoom, 1 = fit
  isFit: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  onFitSelected?: () => void; // used by ElevationView in a later task
  fitSelectedDisabled?: boolean;
}) {
  const blur = (event: { currentTarget: { blur(): void } }) => event.currentTarget.blur();

  return (
    <div className="viewport-zoom" role="toolbar" aria-label="Zoom">
      {onFitSelected ? (
        <Button
          aria-label="Fit selected"
          title="Fit selected"
          className="plan-toolbar-button"
          disabled={fitSelectedDisabled}
          type="button"
          variant="inspector"
          onClick={(event) => {
            blur(event);
            onFitSelected();
          }}
        >
          Fit selected
        </Button>
      ) : null}
      <Button
        aria-label="Fit to view"
        title="Fit to view (⌘0)"
        className="plan-toolbar-button"
        disabled={isFit}
        type="button"
        variant="inspector"
        onClick={(event) => {
          blur(event);
          onFit();
        }}
      >
        Fit
      </Button>
      <Button
        aria-label="Zoom out"
        title="Zoom out"
        className="viewport-zoom-step"
        disabled={!canZoomOut}
        size="icon-sm"
        type="button"
        variant="inspector"
        onClick={(event) => {
          blur(event);
          onZoomOut();
        }}
      >
        <MinusIcon aria-hidden="true" size={14} />
      </Button>
      <button
        className="viewport-zoom-value"
        aria-label={`Zoom level ${Math.round(zoom * 100)} percent — reset to fit`}
        title="Reset to fit"
        type="button"
        onClick={(event) => {
          blur(event);
          onFit();
        }}
      >
        {Math.round(zoom * 100)}%
      </button>
      <Button
        aria-label="Zoom in"
        title="Zoom in"
        className="viewport-zoom-step"
        disabled={!canZoomIn}
        size="icon-sm"
        type="button"
        variant="inspector"
        onClick={(event) => {
          blur(event);
          onZoomIn();
        }}
      >
        <PlusIcon aria-hidden="true" size={14} />
      </Button>
    </div>
  );
}
