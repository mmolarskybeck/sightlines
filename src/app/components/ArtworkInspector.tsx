import { useEffect, useState, type ReactNode } from "react";
import { LinkBreakIcon } from "@phosphor-icons/react/dist/csr/LinkBreak";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { LockSimpleOpenIcon } from "@phosphor-icons/react/dist/csr/LockSimpleOpen";
import type { Artwork, ArtworkFrame, Dimensions, DisplayUnit } from "../../domain/project";
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
import { LengthField } from "./LengthField";
import { UncertaintyIndicator } from "./UncertaintyIndicator";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Toggle } from "./ui/toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";

type ArtworkTextFieldKey = "title" | "artist" | "date" | "accessionNumber" | "locationOrLender";

// Grouped into two rhythm clusters (see .field-group in global.css): identity
// (what the work is) reads at the top beside the thumbnail, and registrar
// (where its record/loan lives — provenance) sinks toward the bottom of the
// panel, below both the dimensions AND the placement slot, since it's
// reference data a curator consults less often than the physical measurements
// or day-to-day arranging. Each cluster reads as one unit, separated from the
// other by the more generous gap on .inspector-form itself.
const IDENTITY_FIELDS: { key: ArtworkTextFieldKey; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "date", label: "Date" }
];

const REGISTRAR_FIELDS: { key: ArtworkTextFieldKey; label: string }[] = [
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
// selected (docs/plan.md §4.1, §5). App wires this in behind selection state
// in a later task — everything here comes in as props, nothing reaches into
// the store.
export function ArtworkInspector({
  artwork,
  isPlaced,
  placementSection,
  onCommitDimensions,
  onCommitField,
  onCommitFraming,
  onRemovePlacement,
  unit
}: {
  artwork: Artwork;
  isPlaced: boolean;
  // The wall- or floor-position form (WallPlacementFields / FloorPlacementFields)
  // for a placed artwork, null/undefined when unplaced — see the reading-order
  // comment above IDENTITY_FIELDS. App supplies this rather than the form
  // rendering itself here, same discipline as everything else in this
  // component: no store access, props only. It renders as a plain child of
  // this component's own <form> (never wrapped in its own nested <form> —
  // that's invalid HTML; the outer form's onSubmit already preventDefaults).
  placementSection?: ReactNode;
  onCommitDimensions: (dimensions: Dimensions) => void;
  onCommitField: (
    changes: Partial<Pick<Artwork, ArtworkTextFieldKey>>
  ) => void;
  onCommitFraming: (changes: Partial<Pick<Artwork, "matWidthMm" | "frame">>) => void;
  onRemovePlacement?: () => void;
  unit: DisplayUnit;
}) {
  const { asset, thumbnailUrl } = useArtworkAsset(artwork.assetId);
  const aspect: PixelAspect = {
    widthPx: asset?.widthPx,
    heightPx: asset?.heightPx
  };

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
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

      {/* Dimensions ride high — the measurement a curator reaches for most. */}
      <DimensionsSection
        aspect={aspect}
        dimensions={artwork.dimensions}
        onCommitDimensions={onCommitDimensions}
        unit={unit}
      />

      {/* Mat + frame ride right below dimensions — they change the physical
          size a work occupies on the wall. */}
      <FramingSection
        dimensions={artwork.dimensions}
        frame={artwork.frame}
        matWidthMm={artwork.matWidthMm}
        onCommitFraming={onCommitFraming}
        unit={unit}
      />

      {/* Daily-use arranging outranks registrar metadata (see IDENTITY_FIELDS),
          so the placement form rides right below Dimensions — before
          Accession no./Location, not after. Nothing renders when the artwork
          isn't placed anywhere. */}
      {placementSection}

      {/* Provenance / registrar data sits at the bottom (see IDENTITY_FIELDS). */}
      <div className="field-group">
        {REGISTRAR_FIELDS.map((field) => (
          <TextField
            key={field.key}
            fieldKey={field.key}
            label={field.label}
            value={artwork[field.key]}
            onCommitField={onCommitField}
          />
        ))}
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

function DimensionsSection({
  aspect,
  dimensions,
  onCommitDimensions,
  unit
}: {
  aspect: PixelAspect;
  dimensions: Dimensions;
  onCommitDimensions: (dimensions: Dimensions) => void;
  unit: DisplayUnit;
}) {
  const { displayUnit, parseUnit, placeholder } = getScopedUnitContext(unit, "artwork");

  // The lock toggle only makes sense when there's an image ratio to lock
  // to — with no linked image (or a legacy asset missing pixel dims),
  // width/height are just independent numbers.
  const ratio = imageAspectRatio(aspect);
  const locked = ratio !== undefined && isAspectLocked(dimensions, aspect);

  return (
    <div className="artwork-dimensions">
      <div className="artwork-dimensions-heading">
        <h3>Dimensions</h3>
        <UncertaintyIndicator status={dimensions.status} />
        {ratio !== undefined ? (
          // Visible text is the accessible name; aria-pressed carries the
          // locked/unlocked state, so the label stays constant.
          <Toggle
            className="artwork-dimensions-lock"
            pressed={locked}
            size="sm"
            variant="ghost"
            onPressedChange={(pressed) =>
              onCommitDimensions({ ...dimensions, aspectLocked: pressed })
            }
          >
            {locked ? (
              <LockSimpleIcon aria-hidden="true" size={13} />
            ) : (
              <LockSimpleOpenIcon aria-hidden="true" size={13} />
            )}
            Lock ratio
          </Toggle>
        ) : null}
      </div>

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
    </div>
  );
}

// Sensible default frame face width (~1 in) when a curator picks a finish
// before typing a width — the frame is only ever created with a real width.
const DEFAULT_FRAME_WIDTH_MM = 25.4;

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
    <div className="artwork-dimensions">
      <div className="artwork-dimensions-heading">
        <h3>Mat &amp; frame</h3>
      </div>

      <div className="artwork-dimensions-grid">
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
        <div className="artwork-dimensions-grid">
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
      ) : null}
    </div>
  );
}
