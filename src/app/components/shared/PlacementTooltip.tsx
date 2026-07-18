import { DoorIcon } from "@phosphor-icons/react/dist/csr/Door";
import { RectangleDashedIcon } from "@phosphor-icons/react/dist/csr/RectangleDashed";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";
import { TextAlignLeftIcon } from "@phosphor-icons/react/dist/csr/TextAlignLeft";
import type { Icon } from "@phosphor-icons/react";
import { effectiveFraming, getArtworkOuterDimensionsMm } from "../../../domain/framing";
import { getOpeningKindLabel, type OpeningKind } from "../../../domain/placement/createOpening";
import type { Artwork, Dimensions, DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../../domain/units/unitSystem";

// Hover-tooltip bodies shared by the plan and elevation views. They own only
// presentation — every caller resolves the artwork record, its effective
// display dimensions, and (plan only) the thumbnail URL, then hands the pieces
// down. Dimension text reuses formatLength in each subject's own measurement
// scope (artworks in in/cm, openings in the opening-size unit), matching the
// inspectors and checklist rather than inventing a new format.

// Same icon vocabulary as WallInspector's "Add to this wall" buttons, so an
// opening reads as the same object across the toolbar, inspector, and tooltip.
const OPENING_ICONS: Record<OpeningKind, Icon> = {
  door: DoorIcon,
  window: SquareIcon,
  "blocked-zone": RectangleDashedIcon
};

function formatDims(
  widthMm: number,
  secondaryMm: number,
  displayUnit: DisplayUnit
): string {
  return `${formatLength(widthMm, { unit: displayUnit })} × ${formatLength(secondaryMm, {
    unit: displayUnit
  })}`;
}

export function OpeningTooltipContent({
  kind,
  widthMm,
  secondaryMm,
  unit
}: {
  kind: OpeningKind;
  widthMm: number;
  // Wall openings pass their height; a floor blocked zone passes its depth —
  // the plan footprint's second axis. Either way it reads as "W × N".
  secondaryMm: number;
  unit: DisplayUnit;
}) {
  const { displayUnit } = getScopeUnits(unitSystemFromDisplayUnit(unit), "openingSize");
  const OpeningIcon = OPENING_ICONS[kind];

  return (
    <div className="placement-tooltip-opening">
      <span className="placement-tooltip-heading">
        <OpeningIcon aria-hidden="true" size={15} />
        {getOpeningKindLabel(kind)}
      </span>
      <span className="placement-tooltip-dims">{formatDims(widthMm, secondaryMm, displayUnit)}</span>
    </div>
  );
}

// A wall text's hover body: its name (default "Wall text") and footprint. It
// carries no artwork metadata, so it reuses the compact opening layout.
export function WallTextTooltipContent({
  name,
  widthMm,
  heightMm,
  unit
}: {
  name: string;
  widthMm: number;
  heightMm: number;
  unit: DisplayUnit;
}) {
  const { displayUnit } = getScopeUnits(unitSystemFromDisplayUnit(unit), "openingSize");

  return (
    <div className="placement-tooltip-opening">
      <span className="placement-tooltip-heading">
        <TextAlignLeftIcon aria-hidden="true" size={15} />
        {name}
      </span>
      <span className="placement-tooltip-dims">{formatDims(widthMm, heightMm, displayUnit)}</span>
    </div>
  );
}

export function ArtworkTooltipContent({
  artwork,
  dimensions,
  thumbnailUrl,
  unit
}: {
  artwork: Artwork;
  // Effective display dimensions: the placement's displayDimensionsOverride
  // when present, otherwise the library record's own dimensions.
  dimensions: Dimensions;
  // Plan view passes a thumbnail; elevation omits it (the artwork is already
  // visible on the wall).
  thumbnailUrl?: string;
  unit: DisplayUnit;
}) {
  const { displayUnit } = getScopeUnits(unitSystemFromDisplayUnit(unit), "artwork");
  const title = artwork.title ?? "Untitled";
  // Both axes must be known to state a size — matching the checklist, an
  // artwork mid-measurement shows no dims line rather than a placeholder.
  const dims =
    dimensions.widthMm !== undefined && dimensions.heightMm !== undefined
      ? formatDims(dimensions.widthMm, dimensions.heightMm, displayUnit)
      : null;

  // Curators/installers measure between FRAME edges when hanging a work, so a
  // matted/framed piece also states the overall footprint it actually occupies
  // on the wall — not just its image size. Derived from the SAME `dimensions`
  // the image line above renders (the placement's displayDimensionsOverride
  // when present, else the record's own dims — display/provenance metadata
  // per project.ts/framing.ts, never geometry) so the two lines never disagree
  // with each other. No overall line without the image line: an overall size
  // alone, with no image size to anchor it, would misstate which number is
  // which.
  // effectiveFraming is the single interpreter of frameIncludedInImage: a
  // flagged work returns empty bands, so overall collapses to the image size
  // and the second line drops out (isFramed below is false).
  const framing = effectiveFraming(artwork);
  const overall =
    dims && dimensions.widthMm !== undefined && dimensions.heightMm !== undefined
      ? getArtworkOuterDimensionsMm(
          dimensions.widthMm,
          dimensions.heightMm,
          framing.matWidthMm,
          framing.frame
        )
      : null;
  const isFramed =
    overall && (overall.widthMm !== dimensions.widthMm || overall.heightMm !== dimensions.heightMm);

  return (
    <div className="placement-tooltip-artwork">
      {thumbnailUrl ? (
        <img alt="" className="placement-tooltip-thumb" src={thumbnailUrl} />
      ) : null}
      <div className="placement-tooltip-body">
        <span className="placement-tooltip-title">{title}</span>
        {artwork.artist ? (
          <span className="placement-tooltip-artist">{artwork.artist}</span>
        ) : null}
        {dims ? (
          <span className="placement-tooltip-dims">{isFramed ? `Image ${dims}` : dims}</span>
        ) : null}
        {isFramed && overall ? (
          <span className="placement-tooltip-dims">
            {`Overall ${formatDims(overall.widthMm, overall.heightMm, displayUnit)}`}
          </span>
        ) : null}
      </div>
    </div>
  );
}
