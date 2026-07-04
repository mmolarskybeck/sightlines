import { useEffect, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { getOpeningKindLabel } from "../../domain/placement/createOpening";
import type { OpeningWallObject, DisplayUnit } from "../../domain/project";
import { formatLength, parseLength } from "../../domain/units/length";

// Numeric position/size fields for a selected door/window/blocked zone,
// mirroring WallInspector's commit-on-blur/Enter pattern exactly — the
// tactile (drag) and numeric paths must always agree (docs/plan.md §2).
export function OpeningInspector({
  onCommitPosition,
  onCommitSize,
  onDelete,
  opening,
  placementWarnings,
  unit
}: {
  onCommitPosition: (xMm: number, yMm: number) => void;
  onCommitSize: (widthMm: number, heightMm: number) => void;
  onDelete: () => void;
  opening: OpeningWallObject;
  placementWarnings: { id: string; message: string; subject?: string }[];
  unit: DisplayUnit;
}) {
  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <label className="field-row">
        <span>Kind</span>
        <input readOnly value={getOpeningKindLabel(opening.kind)} />
      </label>

      {placementWarnings.length > 0 ? (
        <div className="warning-panel" role="status" aria-live="polite">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <h3>Placement needs review</h3>
            <ul>
              {placementWarnings.map((warning) => (
                <li key={warning.id}>
                  {warning.message}
                  {warning.subject ? <span>{warning.subject}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="artwork-dimensions-grid">
        <NumericField
          label="X (from wall start)"
          unit={unit}
          valueMm={opening.xMm}
          onCommit={(xMm) => onCommitPosition(xMm, opening.yMm)}
        />
        <NumericField
          label="Y (from floor)"
          unit={unit}
          valueMm={opening.yMm}
          onCommit={(yMm) => onCommitPosition(opening.xMm, yMm)}
        />
      </div>

      <div className="artwork-dimensions-grid">
        <NumericField
          label="Width"
          positiveOnly
          unit={unit}
          valueMm={opening.widthMm}
          onCommit={(widthMm) => onCommitSize(widthMm, opening.heightMm)}
        />
        <NumericField
          label="Height"
          positiveOnly
          unit={unit}
          valueMm={opening.heightMm}
          onCommit={(heightMm) => onCommitSize(opening.widthMm, heightMm)}
        />
      </div>

      <div className="inspector-placement">
        <button className="inspector-action" type="button" onClick={onDelete}>
          <Trash2 aria-hidden="true" size={15} />
          Delete {getOpeningKindLabel(opening.kind).toLowerCase()}
        </button>
      </div>
    </form>
  );
}

function NumericField({
  label,
  onCommit,
  positiveOnly = false,
  unit,
  valueMm
}: {
  label: string;
  onCommit: (valueMm: number) => void;
  positiveOnly?: boolean;
  unit: DisplayUnit;
  valueMm: number;
}) {
  const [input, setInput] = useState(() => formatLength(valueMm, { unit }));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInput(formatLength(valueMm, { unit }));
    setError(null);
  }, [unit, valueMm]);

  const commit = () => {
    const parsed = parseLength(input, unit);

    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    if (positiveOnly && parsed.valueMm <= 0) {
      setError(`${label} must be greater than zero.`);
      return;
    }

    setError(null);
    onCommit(parsed.valueMm);
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
