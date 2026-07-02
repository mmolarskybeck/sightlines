import { useEffect, useState } from "react";
import type { DisplayUnit } from "../../domain/project";
import { formatLength, parseLength } from "../../domain/units/length";

export function RoomDimensionFields({
  depthMm,
  onCommitDepth,
  onCommitWidth,
  unit,
  widthMm
}: {
  depthMm: number;
  onCommitDepth: (lengthMm: number) => Promise<void>;
  onCommitWidth: (lengthMm: number) => Promise<void>;
  unit: DisplayUnit;
  widthMm: number;
}) {
  return (
    <div className="room-dimensions">
      <DimensionField
        label="Width"
        onCommit={onCommitWidth}
        unit={unit}
        valueMm={widthMm}
      />
      <DimensionField
        label="Depth"
        onCommit={onCommitDepth}
        unit={unit}
        valueMm={depthMm}
      />
    </div>
  );
}

function DimensionField({
  label,
  onCommit,
  unit,
  valueMm
}: {
  label: string;
  onCommit: (lengthMm: number) => Promise<void>;
  unit: DisplayUnit;
  valueMm: number;
}) {
  const [input, setInput] = useState(() => formatLength(valueMm, { unit }));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInput(formatLength(valueMm, { unit }));
    setError(null);
  }, [unit, valueMm]);

  const commit = async () => {
    const parsed = parseLength(input, unit);

    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    if (parsed.valueMm <= 0) {
      setError(`${label} must be greater than zero.`);
      return;
    }

    setError(null);

    try {
      await onCommit(parsed.valueMm);
      setInput(formatLength(parsed.valueMm, { unit }));
    } catch (error) {
      setError(error instanceof Error ? error.message : `Could not resize ${label}.`);
    }
  };

  return (
    <label className="field-row compact">
      <span>{label}</span>
      <input
        aria-invalid={error ? "true" : "false"}
        inputMode="decimal"
        value={input}
        onBlur={() => void commit()}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void commit();
        }}
      />
      {error ? <p className="field-error">{error}</p> : null}
    </label>
  );
}
