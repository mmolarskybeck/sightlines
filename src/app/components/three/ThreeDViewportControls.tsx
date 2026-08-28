import type { ReactElement } from "react";
import { HandIcon } from "@phosphor-icons/react/dist/csr/Hand";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { Button } from "../ui/button";
import { ToolbarTooltipKbd } from "../toolbar/ToolbarTooltipKbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// Same wrapper ViewportZoomControls uses, restated rather than exported from
// there: a DISABLED trigger swallows its own pointer events, so Radix never
// hears the hover and the tooltip silently stops working — the span puts a live
// element back in front of it. Kept identical in both clusters on purpose.
function ViewportTooltip({
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

// The 3D viewport's floating control cluster — the sibling of the 2D surfaces'
// ViewportZoomControls, borrowing its `.viewport-zoom` chip styling so the two
// read as one family, and anchored bottom-right inside `.three-view`.
//
// Reads `[hand] [−] [+]`. Deliberately NOT a copy of the 2D cluster:
//   - NO PERCENTAGE READOUT. An orbit rig has a distance, not a zoom level; a
//     "%" would have to be invented against some reference distance that means
//     nothing to a perspective camera moving through a room.
//   - NO FIT BUTTON. "Overview" already lives in the shared view toolbar above
//     the canvas (viewControls.tsx) and is the same action; a second one here
//     would be two buttons for one behaviour.
//   - A HAND TOOL, which the 2D surfaces don't need — they pan on Space-drag
//     over a flat drawing, while 3D's left-drag is orbit and the pan binding
//     (right-drag) is the one nobody finds.
//
// Every handler blurs its button first, exactly as the 2D cluster does: a
// lingering focus would let the next Space press re-activate the button, and in
// 3D it would also swallow WASD travel.
export function ThreeDViewportControls({
  handActive,
  onToggleHand,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut
}: {
  handActive: boolean;
  onToggleHand: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
}) {
  const blur = (event: { currentTarget: { blur(): void } }) => event.currentTarget.blur();

  return (
    <div className="viewport-zoom three-view-controls" role="toolbar" aria-label="3D view">
      <ViewportTooltip
        kbd="Esc exits"
        label={handActive ? "Drag to pan (on)" : "Drag to pan"}
      >
        <Button
          aria-label="Pan tool"
          aria-pressed={handActive}
          className="viewport-zoom-step"
          data-active={handActive}
          size="icon-sm"
          type="button"
          variant="inspector"
          onClick={(event) => {
            blur(event);
            onToggleHand();
          }}
        >
          <HandIcon aria-hidden="true" size={14} weight={handActive ? "fill" : "regular"} />
        </Button>
      </ViewportTooltip>
      <ViewportTooltip disabled={!canZoomOut} kbd="⌘−" label="Zoom out">
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
      </ViewportTooltip>
      <ViewportTooltip disabled={!canZoomIn} kbd="⌘+" label="Zoom in">
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
      </ViewportTooltip>
    </div>
  );
}
