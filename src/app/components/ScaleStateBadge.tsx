// Sibling of UncertaintyIndicator's `.uncertainty-badge`: a small
// non-interactive badge saying how trustworthy an artwork's ON-CANVAS SCALE
// is, given its dimensions. Where UncertaintyIndicator flags the dimension
// record ("Approx." / "No dims"), this flags what that means for the drawing —
// whether the shape on the wall is at true scale or a stand-in size.
//
// `state` mirrors `ArtworkScaleState` in src/domain/artworkScale.ts (created
// by a parallel task) — deliberately re-declared as an inline union here so
// this component doesn't take a build dependency on that in-flight module.
// Keep the two in sync; if the domain type grows a case, add it here.
//
// Palette tiers by severity (loudest → quietest): `missing` takes the full
// caution wash (no dims → the scale is a guess), `estimated` keeps the caution
// ink on the neutral surface (a softer "approximate" read), `true` renders
// quiet/muted with no fill (accurate scale is not a warning).
//
// Pure <span>, no controls — safe to drop inside a button (e.g. an
// InspectorSection titleAdornment) without nesting interactive content.
export type ScaleState = "missing" | "estimated" | "true";

const TITLES: Record<ScaleState, string> = {
  missing: "No dimensions — the artwork is drawn at an approximate scale",
  estimated: "Dimensions are approximate — the artwork is drawn at an estimated scale",
  true: "Dimensions are known — the artwork is drawn at true scale"
};

export function ScaleStateBadge({ state }: { state: ScaleState }) {
  return (
    <span className={`scale-badge ${state}`} title={TITLES[state]}>
      {state === "missing" ? (
        // Terse on purpose: the badge shares one row with the section title
        // and lock toggle at 260px, and the full "add width and height" story
        // lives in the notice below plus this badge's title. Visible
        // "Approx." with a visually-hidden full word so a screen reader
        // announces "Approximate scale", not the truncation.
        <>
          <span aria-hidden="true">Approx.</span>
          <span className="visually-hidden">Approximate</span> scale
        </>
      ) : state === "estimated" ? (
        "Estimated scale"
      ) : (
        "True scale"
      )}
    </span>
  );
}
