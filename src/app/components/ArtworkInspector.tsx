import { useEffect, useState, type ReactNode } from "react";
import { LinkBreakIcon } from "@phosphor-icons/react/dist/csr/LinkBreak";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { LockSimpleOpenIcon } from "@phosphor-icons/react/dist/csr/LockSimpleOpen";
import type { Artwork, ArtworkFrame, Dimensions, DisplayUnit } from "../../domain/project";
import {
  effectivePlacementForm,
  type PlacementForm
} from "../../domain/placement/artworkForm";
import {
  applyAspectFill,
  imageAspectRatio,
  isAspectLocked,
  type PixelAspect
} from "../../domain/units/aspectFill";
import {
  FRAME_FINISHES,
  deriveFrameWidthFromOverallMm,
  getArtworkOuterDimensionsMm
} from "../../domain/framing";
import { formatLength } from "../../domain/units/length";
import { getScopedUnitContext } from "./scopedUnits";
import { useArtworkAsset } from "../hooks/useArtworkAsset";
import {
  formatDetailsSummary,
  formatDimensionsSummary,
  formatFramingSummary
} from "./artworkInspectorSummaries";
import { InspectorSection } from "./InspectorSection";
import { LengthField } from "./LengthField";
import { UncertaintyIndicator } from "./UncertaintyIndicator";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Toggle } from "./ui/toggle";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "./ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";

type ArtworkTextFieldKey = "title" | "artist" | "date" | "accessionNumber" | "locationOrLender";

// Identity (what the work is) reads at the top beside the thumbnail and is
// never collapsible — it anchors the panel. Registrar data (where its
// record/loan lives — provenance) sinks to the bottom as the collapsed-by-
// default "Details" section, since it's reference data a curator consults
// less often than the physical measurements or day-to-day arranging.
const IDENTITY_FIELDS: { key: ArtworkTextFieldKey; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "date", label: "Date" }
];

const DETAILS_FIELDS: { key: ArtworkTextFieldKey; label: string }[] = [
  { key: "accessionNumber", label: "Accession no." },
  { key: "locationOrLender", label: "Location / lender" }
];

type DimensionAxisKey = "widthMm" | "heightMm" | "depthMm";

const DIMENSION_FIELDS: { key: DimensionAxisKey; label: string }[] = [
  { key: "widthMm", label: "Width" },
  { key: "heightMm", label: "Height" },
  { key: "depthMm", label: "Depth" }
];

// Props-driven editor for the right inspector panel when an artwork is
// selected (docs/plan.md §4.1, §5). Everything here comes in as props,
// nothing reaches into the store — including the collapsible sections'
// open state, which App persists via useViewPreferences so it survives
// selection changes and reloads.
export function ArtworkInspector({
  artwork,
  isPlaced,
  placementSection,
  placementTitle,
  scopeNote,
  sectionsOpen,
  onCommitDimensions,
  onCommitField,
  onChangePlacementForm,
  onCommitFraming,
  onRemovePlacement,
  onSectionOpenChange,
  unit
}: {
  artwork: Artwork;
  isPlaced: boolean;
  // The wall- or floor-position FIELDS (WallPlacementFields /
  // FloorPlacementFields) for a placed artwork, null/undefined when unplaced.
  // App supplies the bare fields and the section title separately
  // (placementTitle, e.g. "Position on North wall") so this component can
  // wrap them in the same InspectorSection grammar as its own sections.
  // Renders as a plain child of this component's own <form> (never wrapped
  // in a nested <form> — that's invalid HTML; the outer form's onSubmit
  // already preventDefaults).
  placementSection?: ReactNode;
  placementTitle?: string;
  scopeNote?: string;
  // Per-section open flags keyed by section id ("dimensions" | "framing" |
  // "placement" | "details") — App reads/writes them through
  // useViewPreferences' inspectorSections record.
  sectionsOpen: Record<string, boolean>;
  onCommitDimensions: (dimensions: Dimensions) => void;
  onCommitField: (
    changes: Partial<Pick<Artwork, ArtworkTextFieldKey>>
  ) => void;
  // Writes the explicit placementForm override (wall vs floor). Distinct from
  // onCommitField's metadata edits: this is a single-purpose commit ("Change
  // placement type") the segmented control fires on change.
  onChangePlacementForm: (form: PlacementForm) => void;
  onCommitFraming: (changes: Partial<Pick<Artwork, "matWidthMm" | "frame">>) => void;
  onRemovePlacement?: () => void;
  onSectionOpenChange: (sectionId: string, open: boolean) => void;
  unit: DisplayUnit;
}) {
  const { asset, thumbnailUrl } = useArtworkAsset(artwork.assetId);
  const aspect: PixelAspect = {
    widthPx: asset?.widthPx,
    heightPx: asset?.heightPx
  };

  // Collapsed-summary strings quote lengths in the artwork measurement scope
  // (inches / cm), matching what the fields inside would show.
  const { displayUnit: summaryUnit } = getScopedUnitContext(unit, "artwork");

  // The lock toggle only makes sense when there's an image ratio to lock
  // to — with no linked image (or a legacy asset missing pixel dims),
  // width/height are just independent numbers. It lives in the Dimensions
  // section HEADER (next to the uncertainty dot) and is passed through
  // InspectorSection's extras slot, which hides it while collapsed — a
  // hidden section shouldn't offer a live toggle.
  const ratio = imageAspectRatio(aspect);
  const locked = ratio !== undefined && isAspectLocked(artwork.dimensions, aspect);
  // The lock toggle is the only header CONTROL (extras hide while collapsed);
  // the uncertainty badge is pure status, so it rides inside the trigger as a
  // titleAdornment instead — visible even collapsed, and it yields width
  // before the title does (the "Dimensions" → "Dimension" clip at narrow
  // panel widths came from badge + lock crowding the extras row).
  const dimensionsExtras =
    ratio !== undefined ? (
      // Visible text is the accessible name; aria-pressed carries the
      // locked/unlocked state, so the label stays constant.
      <Toggle
        className="artwork-dimensions-lock"
        pressed={locked}
        size="sm"
        variant="ghost"
        onPressedChange={(pressed) =>
          onCommitDimensions({ ...artwork.dimensions, aspectLocked: pressed })
        }
      >
        {locked ? (
          <LockSimpleIcon aria-hidden="true" size={13} />
        ) : (
          <LockSimpleOpenIcon aria-hidden="true" size={13} />
        )}
        Lock ratio
      </Toggle>
    ) : undefined;

  const isOpen = (sectionId: string, fallback: boolean) =>
    sectionsOpen[sectionId] ?? fallback;

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {scopeNote ? <p className="artwork-inspector-scope">{scopeNote}</p> : null}
      {/* Thumbnail beside identity when the panel is wide enough, stacking
          above it when narrow (see .artwork-inspector-header). */}
      <div className="artwork-inspector-header">
        {thumbnailUrl ? (
          <img
            alt=""
            className="artwork-inspector-thumb"
            src={thumbnailUrl}
            // Aspect-true: the square slot's object-fit contains the image, but
            // handing the browser the intrinsic ratio avoids a paint-time
            // reflow once it loads.
            style={
              aspect.widthPx && aspect.heightPx
                ? { aspectRatio: `${aspect.widthPx} / ${aspect.heightPx}` }
                : undefined
            }
          />
        ) : (
          <div aria-hidden="true" className="artwork-inspector-thumb placeholder" />
        )}

        <div className="field-group artwork-inspector-identity">
          {IDENTITY_FIELDS.map((field) => (
            <TextField
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              value={artwork[field.key]}
              onCommitField={onCommitField}
            />
          ))}
        </div>
      </div>

      {/* The collapsible middle of the panel: hairline-separated rows with
          zero extra gap so collapsed sections stack as a tight, scannable
          list (spacing inside each section comes from the section itself). */}
      <div className="inspector-sections">
        {/* Dimensions ride high — the measurement a curator reaches for most. */}
        <InspectorSection
          headerExtras={dimensionsExtras}
          open={isOpen("dimensions", true)}
          summary={formatDimensionsSummary(artwork.dimensions, summaryUnit)}
          title="Dimensions"
          titleAdornment={<UncertaintyIndicator status={artwork.dimensions.status} />}
          onOpenChange={(open) => onSectionOpenChange("dimensions", open)}
        >
          <DimensionsSection
            aspect={aspect}
            dimensions={artwork.dimensions}
            placementForm={effectivePlacementForm(artwork)}
            onCommitDimensions={onCommitDimensions}
            onChangePlacementForm={onChangePlacementForm}
            unit={unit}
          />
        </InspectorSection>

        {/* Mat + frame ride right below dimensions — they change the physical
            size a work occupies on the wall. */}
        <InspectorSection
          open={isOpen("framing", true)}
          summary={formatFramingSummary(artwork.matWidthMm, artwork.frame, summaryUnit)}
          title="Mat & frame"
          onOpenChange={(open) => onSectionOpenChange("framing", open)}
        >
          <FramingSection
            dimensions={artwork.dimensions}
            frame={artwork.frame}
            matWidthMm={artwork.matWidthMm}
            onCommitFraming={onCommitFraming}
            unit={unit}
          />
        </InspectorSection>

        {/* Daily-use arranging outranks registrar metadata, so placement
            rides above Details. Nothing renders when the artwork isn't
            placed anywhere. */}
        {placementSection ? (
          <InspectorSection
            open={isOpen("placement", true)}
            title={placementTitle ?? "Placement"}
            onOpenChange={(open) => onSectionOpenChange("placement", open)}
          >
            {placementSection}
          </InspectorSection>
        ) : null}

        {/* Provenance / registrar data, collapsed by default (see
            IDENTITY_FIELDS comment). */}
        <InspectorSection
          open={isOpen("details", false)}
          summary={formatDetailsSummary(artwork.accessionNumber, artwork.locationOrLender)}
          title="Details"
          onOpenChange={(open) => onSectionOpenChange("details", open)}
        >
          {DETAILS_FIELDS.map((field) => (
            <TextField
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              value={artwork[field.key]}
              onCommitField={onCommitField}
            />
          ))}
        </InspectorSection>
      </div>

      <div className="inspector-placement">
        {isPlaced ? (
          <Button
            className="inspector-action inspector-danger"
            variant="destructive-ghost"
            onClick={onRemovePlacement}
          >
            <LinkBreakIcon aria-hidden="true" size={15} />
            Remove from wall
          </Button>
        ) : (
          <p className="field-hint">Not currently placed on a wall.</p>
        )}
      </div>
    </form>
  );
}

function TextField({
  fieldKey,
  label,
  onCommitField,
  value
}: {
  fieldKey: ArtworkTextFieldKey;
  label: string;
  onCommitField: (
    changes: Partial<Pick<Artwork, ArtworkTextFieldKey>>
  ) => void;
  value: string | undefined;
}) {
  const [input, setInput] = useState(value ?? "");

  useEffect(() => {
    setInput(value ?? "");
  }, [value]);

  const commit = () => {
    const trimmed = input.trim();
    // Unlike the project title (always required), these fields are optional
    // curatorial metadata — clearing one is a legitimate edit, so an empty
    // commit is `undefined`, not a revert to the previous value.
    const nextValue = trimmed.length === 0 ? undefined : trimmed;

    if (nextValue === (value ?? undefined)) return;

    onCommitField({ [fieldKey]: nextValue } as Partial<Pick<Artwork, ArtworkTextFieldKey>>);
  };

  return (
    <label className="field-row">
      <span>{label}</span>
      <Input
        value={input}
        onBlur={commit}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
      />
    </label>
  );
}

// Section BODY only — the heading, uncertainty dot, and lock toggle live in
// the InspectorSection header row (see dimensionsExtras above).
function DimensionsSection({
  aspect,
  dimensions,
  placementForm,
  onCommitDimensions,
  onChangePlacementForm,
  unit
}: {
  aspect: PixelAspect;
  dimensions: Dimensions;
  // The EFFECTIVE form (override or inferred) — the segmented control shows it;
  // a change writes the explicit override upstream.
  placementForm: PlacementForm;
  onCommitDimensions: (dimensions: Dimensions) => void;
  onChangePlacementForm: (form: PlacementForm) => void;
  unit: DisplayUnit;
}) {
  const { displayUnit, parseUnit, placeholder } = getScopedUnitContext(unit, "artwork");

  return (
    <>
      <div className="artwork-dimensions-grid">
        {DIMENSION_FIELDS.map((field) => (
          <LengthField
            key={field.key}
            compact
            clearable
            positiveOnly
            label={field.label}
            valueMm={dimensions[field.key]}
            displayUnit={displayUnit}
            parseUnit={parseUnit}
            placeholder={placeholder}
            // An axis can be legitimately unmeasured even while others are
            // known — clearing the field commits that axis as undefined.
            onClear={() =>
              onCommitDimensions({ ...dimensions, [field.key]: undefined })
            }
            // Note: committing a dimension value never touches `status` —
            // status is the curator's own claim about how trustworthy these
            // numbers are, not something derived from whether fields happen to
            // be filled in.
            //
            // Committing width or height also auto-fills the other 2D face dim
            // from the image's aspect ratio when the pair is locked (see
            // applyAspectFill for the rule). Depth carries no ratio, so it
            // commits alone. The derived value is a plain committed number —
            // fully editable afterwards, just like a typed one.
            onCommit={(valueMm) =>
              onCommitDimensions(
                field.key === "depthMm"
                  ? { ...dimensions, depthMm: valueMm }
                  : applyAspectFill(dimensions, field.key, valueMm, aspect)
              )
            }
          />
        ))}
      </div>

      {/* Wall vs floor: a two-cell soft track matching the arrange-mode
          vocabulary (recessed track, raised chip slides to the active cell).
          It DISPLAYS the effective form; a change writes the explicit
          override in one commit. A Radix single toggle-group fires "" when the
          active segment is re-clicked (deselect) — ignore that and keep the
          current form, since there's no "back to auto" affordance in v1. */}
      <SegmentedToggleGroup
        aria-label="Placement type"
        className="placement-form-toggle"
        type="single"
        value={placementForm}
        onValueChange={(value) => {
          if (value === "wall" || value === "floor") onChangePlacementForm(value);
        }}
      >
        <SegmentedToggleGroupItem className="placement-form-option" value="wall">
          Hangs on wall
        </SegmentedToggleGroupItem>
        <SegmentedToggleGroupItem className="placement-form-option" value="floor">
          Sits on floor
        </SegmentedToggleGroupItem>
      </SegmentedToggleGroup>

      <label className="field-row compact">
        <span>Status</span>
        <Select
          value={dimensions.status}
          onValueChange={(value) =>
            onCommitDimensions({
              ...dimensions,
              status: value as Dimensions["status"]
            })
          }
        >
          <SelectTrigger aria-label="Dimension status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="known">Known</SelectItem>
            <SelectItem value="approximate">Approximate</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
      </label>
    </>
  );
}

// Sensible default frame face width (~1 in) when a curator picks a finish
// before typing a width — the frame is only ever created with a real width.
const DEFAULT_FRAME_WIDTH_MM = 25.4;

// Section BODY only — the "Mat & frame" heading lives in InspectorSection.
// Two thoughts, separated by a touch of extra air (.framing-overall): what
// you enter (band widths + finish), then what results (the Overall pair).
function FramingSection({
  dimensions,
  frame,
  matWidthMm,
  onCommitFraming,
  unit
}: {
  dimensions: Dimensions;
  frame?: ArtworkFrame;
  matWidthMm?: number;
  onCommitFraming: (changes: Partial<Pick<Artwork, "matWidthMm" | "frame">>) => void;
  unit: DisplayUnit;
}) {
  const { displayUnit, parseUnit, placeholder, system } = getScopedUnitContext(unit, "artwork");

  // Band-width examples, not conversions — these fields take the width of the
  // mat/frame BAND, not the framed size of the work, and a concrete small
  // example (3in mat, 1in frame) is the fastest way to say so.
  const matPlaceholder = system === "imperial" ? 'e.g. 3"' : "e.g. 75 mm";
  const framePlaceholder = system === "imperial" ? 'e.g. 1"' : "e.g. 25 mm";

  // Overall footprint only reads when both image faces are measured — a
  // half-known work has no meaningful outer size to quote or edit.
  const overall =
    dimensions.widthMm !== undefined && dimensions.heightMm !== undefined
      ? getArtworkOuterDimensionsMm(dimensions.widthMm, dimensions.heightMm, matWidthMm, frame)
      : undefined;

  // Editing an overall dim solves for the FRAME band only (mat stays as
  // entered); bands are uniform, so committing either axis updates both —
  // same spirit as the image dims' aspect-ratio autofill. A too-small entry
  // throws, which LengthField surfaces in its reserved message slot without
  // committing; an entry exactly equal to image + 2·mat clears the frame.
  const commitOverall = (imageMm: number) => (overallMm: number) => {
    const derivation = deriveFrameWidthFromOverallMm(overallMm, imageMm, matWidthMm);

    if (!derivation.ok) {
      throw new Error(
        `Overall must be at least ${formatLength(derivation.minOverallMm, {
          unit: displayUnit
        })} (image plus mat).`
      );
    }

    onCommitFraming({
      frame:
        derivation.frameWidthMm === undefined
          ? undefined
          : { widthMm: derivation.frameWidthMm, finish: frame?.finish ?? "black" }
    });
  };

  return (
    <>
      <div className="field-pair-grid">
        <LengthField
          compact
          clearable
          positiveOnly
          label="Mat"
          valueMm={matWidthMm}
          displayUnit={displayUnit}
          parseUnit={parseUnit}
          placeholder={matPlaceholder}
          onClear={() => onCommitFraming({ matWidthMm: undefined })}
          onCommit={(valueMm) => onCommitFraming({ matWidthMm: valueMm })}
        />
        <LengthField
          compact
          clearable
          positiveOnly
          label="Frame"
          valueMm={frame?.widthMm}
          displayUnit={displayUnit}
          parseUnit={parseUnit}
          placeholder={framePlaceholder}
          // Clearing the frame width removes the frame entirely; setting it
          // keeps (or defaults) the finish.
          onClear={() => onCommitFraming({ frame: undefined })}
          onCommit={(valueMm) =>
            onCommitFraming({
              frame: { widthMm: valueMm, finish: frame?.finish ?? "black" }
            })
          }
        />
      </div>

      <label className="field-row compact">
        <span>Finish</span>
        <Select
          value={frame?.finish ?? "black"}
          onValueChange={(value) =>
            onCommitFraming({
              frame: {
                widthMm: frame?.widthMm ?? DEFAULT_FRAME_WIDTH_MM,
                finish: value as ArtworkFrame["finish"]
              }
            })
          }
        >
          <SelectTrigger aria-label="Frame finish">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FRAME_FINISHES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {overall && dimensions.widthMm !== undefined && dimensions.heightMm !== undefined ? (
        // Editable overall footprint (image + mat + frame per side, W × H):
        // shows the current effective outer dims at rest; committing either
        // one re-derives the frame band (see commitOverall above).
        <div className="framing-overall">
          <div className="field-pair-grid">
            <LengthField
              compact
              positiveOnly
              label="Overall W"
              valueMm={overall.widthMm}
              displayUnit={displayUnit}
              parseUnit={parseUnit}
              placeholder={placeholder}
              onCommit={commitOverall(dimensions.widthMm)}
            />
            <LengthField
              compact
              positiveOnly
              label="Overall H"
              valueMm={overall.heightMm}
              displayUnit={displayUnit}
              parseUnit={parseUnit}
              placeholder={placeholder}
              onCommit={commitOverall(dimensions.heightMm)}
            />
          </div>
          <p className="field-hint">Framed size — editing either derives the frame width.</p>
        </div>
      ) : null}
    </>
  );
}
