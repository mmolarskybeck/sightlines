import { RulerIcon } from "@phosphor-icons/react/dist/csr/Ruler";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// Non-interactive status icon saying how trustworthy an artwork's ON-CANVAS
// SCALE is, given its dimensions. It flags what the record means for the
// drawing — whether the shape on the wall is at true scale or a stand-in.
// Only exceptional states render: an icon preserves the collapsed dimension
// summary's width, while the full sentence rides the title and hidden label.
//
// `state` mirrors `ArtworkScaleState` in src/domain/artworkScale.ts —
// deliberately re-declared as an inline union so this stays a leaf component.
// Keep the two in sync; if the domain type grows a case, add it here.
//
// Pure <span>, no controls — safe to drop inside a button (e.g. an
// InspectorSection titleAdornment) without nesting interactive content.
export type ScaleState = "missing" | "estimated" | "true";

const TITLES: Record<ScaleState, string> = {
  missing: "Dimensions missing. Scale is approximate.",
  estimated: "Approximate dimensions. Scale is estimated.",
  true: "Dimensions known. Artwork is shown at true scale."
};

const HIDDEN_LABELS: Record<ScaleState, string> = {
  missing: "Approximate scale",
  estimated: "Estimated scale",
  true: "True scale"
};

export function ScaleStateBadge({ state }: { state: ScaleState }) {
  // True scale is the healthy default. Giving it permanent header chrome
  // crowds the collapsed dimensions summary and competes with actionable
  // states, so only missing/estimated scale gets an icon here.
  if (state === "true") return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`scale-state-icon ${state}`}>
          {state === "missing" ? (
            <WarningIcon aria-hidden="true" size={13} weight="fill" />
          ) : (
            <RulerIcon aria-hidden="true" size={13} />
          )}
          <span className="visually-hidden">{HIDDEN_LABELS[state]}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="toolbar-tooltip" side="bottom">
        {TITLES[state]}
      </TooltipContent>
    </Tooltip>
  );
}
