import { useEffect, useState } from "react";
import { Link2Off } from "lucide-react";
import type { Artwork, Dimensions, DisplayUnit } from "../../domain/project";
import { formatLength, parseLength } from "../../domain/units/length";
import { UncertaintyIndicator } from "./UncertaintyIndicator";

type ArtworkTextFieldKey = "title" | "artist" | "date" | "accessionNumber" | "locationOrLender";

// Grouped into two rhythm clusters (see .field-group in global.css): identity
// (what the work is) and registrar (where its record/loan lives) — each
// cluster reads as one unit, separated from the other by the more generous
// gap on .inspector-form itself.
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
  onCommitDimensions,
  onCommitField,
  onRemovePlacement,
  unit
}: {
  artwork: Artwork;
  isPlaced: boolean;
  onCommitDimensions: (dimensions: Dimensions) => void;
  onCommitField: (
    changes: Partial<Pick<Artwork, ArtworkTextFieldKey>>
  ) => void;
  onRemovePlacement?: () => void;
  unit: DisplayUnit;
}) {
  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <div className="field-group">
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

      <DimensionsSection
        dimensions={artwork.dimensions}
        onCommitDimensions={onCommitDimensions}
        unit={unit}
      />

      {isPlaced ? (
        <div className="inspector-placement">
          <button
            className="inspector-action"
            type="button"
            onClick={onRemovePlacement}
          >
            <Link2Off aria-hidden="true" size={15} />
            Remove from wall
          </button>
        </div>
      ) : (
        <p className="field-hint">Not currently placed on a wall.</p>
      )}
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
      <input
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
  dimensions,
  onCommitDimensions,
  unit
}: {
  dimensions: Dimensions;
  onCommitDimensions: (dimensions: Dimensions) => void;
  unit: DisplayUnit;
}) {
  return (
    <div className="artwork-dimensions">
      <div className="artwork-dimensions-heading">
        <h3>Dimensions</h3>
        <UncertaintyIndicator status={dimensions.status} />
      </div>

      <div className="artwork-dimensions-grid">
        {DIMENSION_FIELDS.map((field) => (
          <DimensionAxisField
            key={field.key}
            axisKey={field.key}
            dimensions={dimensions}
            label={field.label}
            onCommitDimensions={onCommitDimensions}
            unit={unit}
          />
        ))}
      </div>

      <label className="field-row compact">
        <span>Status</span>
        <select
          value={dimensions.status}
          onChange={(event) =>
            onCommitDimensions({
              ...dimensions,
              status: event.target.value as Dimensions["status"]
            })
          }
        >
          <option value="known">Known</option>
          <option value="approximate">Approximate</option>
          <option value="unknown">Unknown</option>
        </select>
      </label>
    </div>
  );
}

function DimensionAxisField({
  axisKey,
  dimensions,
  label,
  onCommitDimensions,
  unit
}: {
  axisKey: DimensionAxisKey;
  dimensions: Dimensions;
  label: string;
  onCommitDimensions: (dimensions: Dimensions) => void;
  unit: DisplayUnit;
}) {
  const valueMm = dimensions[axisKey];
  const [input, setInput] = useState(() =>
    valueMm === undefined ? "" : formatLength(valueMm, { unit })
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInput(valueMm === undefined ? "" : formatLength(valueMm, { unit }));
    setError(null);
  }, [unit, valueMm]);

  const commit = () => {
    const trimmed = input.trim();

    if (trimmed.length === 0) {
      setError(null);
      // An axis can be legitimately unmeasured even while others are known —
      // clearing the field commits that axis as undefined rather than 0.
      if (valueMm !== undefined) {
        onCommitDimensions({ ...dimensions, [axisKey]: undefined });
      }
      return;
    }

    const parsed = parseLength(trimmed, unit);

    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    if (parsed.valueMm <= 0) {
      setError(`${label} must be greater than zero.`);
      return;
    }

    setError(null);
    // Note: committing a dimension value never touches `status` — status is
    // the curator's own claim about how trustworthy these numbers are, not
    // something derived from whether fields happen to be filled in. A
    // placeholder mockup size can be typed in while status stays
    // "approximate", and a precisely measured work can still be marked
    // "unknown" if the curator hasn't verified it yet.
    onCommitDimensions({ ...dimensions, [axisKey]: parsed.valueMm });
    setInput(formatLength(parsed.valueMm, { unit }));
  };

  return (
    <label className="field-row compact">
      <span>{label}</span>
      <input
        aria-invalid={error ? "true" : "false"}
        inputMode="decimal"
        value={input}
        onBlur={commit}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
      />
      {error ? <p className="field-error">{error}</p> : null}
    </label>
  );
}
