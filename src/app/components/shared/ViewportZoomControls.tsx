import type { ReactElement } from "react";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { Button } from "../ui/button";
import { ToolbarTooltipKbd } from "../toolbar/ToolbarTooltipKbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

function ZoomTooltip({
  children,
  disabled = false,
  kbd,
  label
}: {
  children: ReactElement;
  disabled?: boolean;
  kbd?: string;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span className="disabled-tooltip-trigger">{children}</span> : children}
      </TooltipTrigger>
      <TooltipContent className="toolbar-tooltip" side="top">
        {label}
        {kbd ? <ToolbarTooltipKbd hint={kbd} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

// Floating zoom cluster for the 2D drawing surfaces — anchored bottom-right
// inside the canvas. Reads
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
        <ZoomTooltip disabled={fitSelectedDisabled} label="Fit selection">
          <Button
            aria-label="Fit selection"
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
        </ZoomTooltip>
      ) : null}
      <ZoomTooltip disabled={isFit} kbd="⌘0" label="Fit to view">
        <Button
          aria-label="Fit to view"
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
      </ZoomTooltip>
      <ZoomTooltip disabled={!canZoomOut} label="Zoom out">
        <Button
          aria-label="Zoom out"
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
      </ZoomTooltip>
      <ZoomTooltip label="Reset zoom">
        <button
          className="viewport-zoom-value"
          aria-label={`Zoom level ${Math.round(zoom * 100)} percent. Reset zoom`}
          type="button"
          onClick={(event) => {
            blur(event);
            onFit();
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
      </ZoomTooltip>
      <ZoomTooltip disabled={!canZoomIn} label="Zoom in">
        <Button
          aria-label="Zoom in"
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
      </ZoomTooltip>
    </div>
  );
}
