// Non-interactive status dot saying how trustworthy an artwork's ON-CANVAS
// SCALE is, given its dimensions. Where UncertaintyIndicator flags the
// dimension record ("Approx." / "No dims"), this flags what that means for
// the drawing — whether the shape on the wall is at true scale or a stand-in
// size. A dot, not words: even a two-word badge was too wide for the section
// header at the 260px pane minimum, so color + fill carry the tier (solid
// caution = missing, hollow caution = estimated, quiet petrol = true) and
// the sentence rides the title tooltip plus visually-hidden text.
//
// `state` mirrors `ArtworkScaleState` in src/domain/artworkScale.ts —
// deliberately re-declared as an inline union so this stays a leaf component.
// Keep the two in sync; if the domain type grows a case, add it here.
//
// Pure <span>, no controls — safe to drop inside a button (e.g. an
// InspectorSection titleAdornment) without nesting interactive content.
export type ScaleState = "missing" | "estimated" | "true";

const TITLES: Record<ScaleState, string> = {
  missing: "No dimensions — the artwork is drawn at an approximate scale",
  estimated: "Dimensions are approximate — the artwork is drawn at an estimated scale",
  true: "Dimensions are known — the artwork is drawn at true scale"
};

const HIDDEN_LABELS: Record<ScaleState, string> = {
  missing: "Approximate scale",
  estimated: "Estimated scale",
  true: "True scale"
};

export function ScaleStateBadge({ state }: { state: ScaleState }) {
  return (
    <span className={`scale-dot ${state}`} title={TITLES[state]}>
      <span className="visually-hidden">{HIDDEN_LABELS[state]}</span>
    </span>
  );
}
