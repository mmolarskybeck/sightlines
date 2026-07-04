import { useEffect, useState } from "react";
import { DoorOpen, Link2, Square, SquareDashed } from "lucide-react";
import type { OpeningKind } from "../../domain/placement/createOpening";
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
  onAddOpening,
  onCommitLength,
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
  onAddOpening: (kind: OpeningKind) => void;
  onCommitLength: (lengthMm: number) => Promise<void>;
  unit: DisplayUnit;
  wallHeightMm: number;
  wallLengthMm: number;
  wallName: string;
}) {
  const [lengthInput, setLengthInput] = useState(() =>
    formatLength(wallLengthMm, { unit })
  );
  const [lengthError, setLengthError] = useState<string | null>(null);
  // The format hint is guidance while typing, not a permanent label — it
  // shows only while the Length input is focused. The error, when present,
  // always shows and takes precedence.
  const [lengthFocused, setLengthFocused] = useState(false);

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

    try {
      await onCommitLength(parsed.valueMm);
      setLengthInput(formatLength(parsed.valueMm, { unit }));
    } catch (error) {
      setLengthError(
        error instanceof Error ? error.message : "Could not resize this wall."
      );
    }
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
        <span>Length</span>
        <input
          aria-describedby={
            lengthError
              ? "wall-length-error"
              : lengthFocused
                ? "wall-length-hint"
                : undefined
          }
          aria-invalid={lengthError ? "true" : "false"}
          inputMode="decimal"
          value={lengthInput}
          onFocus={() => setLengthFocused(true)}
          onBlur={() => {
            setLengthFocused(false);
            void commitLength();
          }}
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
      ) : lengthFocused ? (
        <p className="field-hint" id="wall-length-hint">
          Accepts 28', 28 ft, 336", 853.4 cm, or 8.53 m.
        </p>
      ) : null}
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

      <div className="opening-add-row">
        <span>Add to this wall</span>
        <div className="opening-add-buttons">
          <button className="inspector-action" type="button" onClick={() => onAddOpening("door")}>
            <DoorOpen aria-hidden="true" size={15} />
            Door
          </button>
          <button className="inspector-action" type="button" onClick={() => onAddOpening("window")}>
            <Square aria-hidden="true" size={15} />
            Window
          </button>
          <button
            className="inspector-action"
            type="button"
            onClick={() => onAddOpening("blocked-zone")}
          >
            <SquareDashed aria-hidden="true" size={15} />
            Blocked zone
          </button>
        </div>
      </div>

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
