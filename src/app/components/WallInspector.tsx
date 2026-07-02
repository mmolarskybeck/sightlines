import { useEffect, useState } from "react";
import { AlertTriangle, Link2 } from "lucide-react";
import type { DisplayUnit } from "../../domain/project";
import { formatLength, parseLength } from "../../domain/units/length";

export type WallDimensionLink = {
  pairedWallName: string;
  roomName: string;
};

export function WallInspector({
  centerlineMm,
  changedWallNames,
  dimensionLink,
  lastGeometryEdit,
  onCommitLength,
  placementWarnings,
  unit,
  wallHeightMm,
  wallLengthMm,
  wallName
}: {
  centerlineMm: number;
  changedWallNames: string[];
  dimensionLink: WallDimensionLink | null;
  lastGeometryEdit: {
    anchorVertexId: string;
    changedWallIds: string[];
  } | null;
  onCommitLength: (lengthMm: number) => Promise<void>;
  placementWarnings: { id: string; message: string; wallObjectId: string }[];
  unit: DisplayUnit;
  wallHeightMm: number;
  wallLengthMm: number;
  wallName: string;
}) {
  const [lengthInput, setLengthInput] = useState(() =>
    formatLength(wallLengthMm, { unit })
  );
  const [lengthError, setLengthError] = useState<string | null>(null);

  useEffect(() => {
    setLengthInput(formatLength(wallLengthMm, { unit }));
    setLengthError(null);
  }, [unit, wallLengthMm]);

  const commitLength = async () => {
    const parsed = parseLength(lengthInput, unit);

    if (!parsed.ok) {
      setLengthError(parsed.error);
      return;
    }

    if (parsed.valueMm <= 0) {
      setLengthError("Wall length must be greater than zero.");
      return;
    }

    setLengthError(null);
    await onCommitLength(parsed.valueMm);
    setLengthInput(formatLength(parsed.valueMm, { unit }));
  };

  return (
    <form
      className="inspector-form"
      onSubmit={(event) => {
        event.preventDefault();
        void commitLength();
      }}
    >
      <label className="field-row">
        <span>Selected wall</span>
        <input readOnly value={wallName} />
      </label>

      <label className="field-row">
        <span>Length</span>
        <input
          aria-describedby={lengthError ? "wall-length-error" : undefined}
          aria-invalid={lengthError ? "true" : "false"}
          inputMode="decimal"
          value={lengthInput}
          onBlur={() => void commitLength()}
          onChange={(event) => setLengthInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void commitLength();
          }}
        />
      </label>
      {lengthError ? (
        <p className="field-error" id="wall-length-error">
          {lengthError}
        </p>
      ) : (
        <p className="field-hint">Accepts 28', 28 ft, 336", 853.4 cm, or 8.53 m.</p>
      )}
      {dimensionLink ? (
        <div className="constraint-panel" aria-label="Linked rectangle dimension">
          <Link2 aria-hidden="true" size={17} />
          <div>
            <h3>{wallName} + {dimensionLink.pairedWallName}</h3>
            <p>{dimensionLink.roomName} keeps opposing wall lengths linked.</p>
          </div>
        </div>
      ) : null}
      {lastGeometryEdit ? (
        <p className="field-hint">
          Last edit updated{" "}
          {changedWallNames.length > 0 ? changedWallNames.join(", ") : "no walls"}.
        </p>
      ) : null}

      {placementWarnings.length > 0 ? (
        <div className="warning-panel" role="status" aria-live="polite">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <h3>Placement needs review</h3>
            <ul>
              {placementWarnings.map((warning) => (
                <li key={warning.id}>
                  {warning.message} <span>{warning.wallObjectId}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <dl className="property-list compact">
        <div>
          <dt>Height</dt>
          <dd>{formatLength(wallHeightMm, { unit })}</dd>
        </div>
        <div>
          <dt>Centerline</dt>
          <dd>
            {formatLength(centerlineMm, {
              unit: "ft",
              secondaryUnit: "cm"
            })}
          </dd>
        </div>
      </dl>
    </form>
  );
}
