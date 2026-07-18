import type { Dimensions } from "../../../domain/project";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export type UncertaintyStatus = Dimensions["status"];

// The one shared "approximate/unknown" visual (docs/plan.md §8) — checklist
// rows, the artwork inspector, wall elevation, plan, and 3D all need to show
// dimension uncertainty, and building that as four local treatments is how
// you end up with four different visual languages. This component is the
// canonical one; a later elevation task mirrors its color tokens for the SVG
// surface, where an actual DOM badge can't be dropped in directly.
export function UncertaintyIndicator({
  compact = false,
  status
}: {
  compact?: boolean;
  status: UncertaintyStatus;
}) {
  if (status === "known") return null;

  const label = status === "approximate" ? "Approx." : "No dims";
  const tooltip =
    status === "approximate"
      ? "Approximate dimensions"
      : "Missing dimensions";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={
            compact ? `uncertainty-badge ${status} compact` : `uncertainty-badge ${status}`
          }
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="toolbar-tooltip">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
