import { useEffect, useState, type ReactNode } from "react";
import { LinkBreakIcon } from "@phosphor-icons/react/dist/csr/LinkBreak";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { LockSimpleOpenIcon } from "@phosphor-icons/react/dist/csr/LockSimpleOpen";
import type { Artwork, Dimensions, DisplayUnit } from "../../domain/project";
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
import { getScopedUnitContext } from "./scopedUnits";
import { useArtworkAsset } from "../hooks/useArtworkAsset";
import { LengthField } from "./LengthField";
import { UncertaintyIndicator } from "./UncertaintyIndicator";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Toggle } from "./ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
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
  onChangePlacementForm,
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
  // Writes the explicit placementForm override (wall vs floor). Distinct from
  // onCommitField's metadata edits: this is a single-purpose commit ("Change
  // placement type") the segmented control fires on change.
  onChangePlacementForm: (form: PlacementForm) => void;
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
        placementForm={effectivePlacementForm(artwork)}
        onCommitDimensions={onCommitDimensions}
        onChangePlacementForm={onChangePlacementForm}
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

      {/* Wall vs floor: a two-segment switch matching the arrange-mode
          vocabulary (crisp squares, petrol wash on the active segment, never a
          pill). It DISPLAYS the effective form; a change writes the explicit
          override in one commit. A Radix single toggle-group fires "" when the
          active segment is re-clicked (deselect) — ignore that and keep the
          current form, since there's no "back to auto" affordance in v1. */}
      <ToggleGroup
        aria-label="Placement type"
        className="placement-form-toggle"
        type="single"
        value={placementForm}
        onValueChange={(value) => {
          if (value === "wall" || value === "floor") onChangePlacementForm(value);
        }}
      >
        <ToggleGroupItem className="placement-form-option" value="wall">
          Hangs on wall
        </ToggleGroupItem>
        <ToggleGroupItem className="placement-form-option" value="floor">
          Sits on floor
        </ToggleGroupItem>
      </ToggleGroup>

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
