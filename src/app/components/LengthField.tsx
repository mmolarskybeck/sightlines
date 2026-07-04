import { useEffect, useId, useState } from "react";
import type { DisplayUnit } from "../../domain/project";
import { formatLength, parseLength } from "../../domain/units/length";
import { getConversionHint } from "../../domain/units/conversionHint";

// Shared commit-on-blur/Enter measurement field. Consolidates the parse,
// validate, and reformat dance that ArtworkInspector, OpeningInspector,
// WallInspector, and RoomDimensionFields each used to duplicate. All lengths
// are stored in mm; `displayUnit` controls how the committed value renders,
// while `parseUnit` is the context unit a bare number is interpreted in — the
// two differ only for imperial opening sizes (specced in inches, read as
// feet-and-inches). See src/domain/units/unitSystem.ts.
export function LengthField({
  label,
  valueMm,
  displayUnit,
  parseUnit,
  placeholder,
  compact = false,
  clearable = false,
  onClear,
  positiveOnly = false,
  onCommit,
  focusHint,
  commitErrorFallback = "Could not save this measurement."
}: {
  label: string;
  valueMm: number | undefined;
  displayUnit: DisplayUnit;
  parseUnit: DisplayUnit;
  placeholder: string;
  compact?: boolean;
  clearable?: boolean;
  onClear?: () => void;
  positiveOnly?: boolean;
  onCommit: (valueMm: number) => void | Promise<void>;
  focusHint?: string;
  commitErrorFallback?: string;
}) {
  const [input, setInput] = useState(() =>
    valueMm === undefined ? "" : formatLength(valueMm, { unit: displayUnit })
  );
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const messageId = useId();

  // Resync (and clear any stale error) whenever the committed value or its
  // display unit changes out from under us — a store update, a unit switch,
  // or a sibling edit. All four original sites did exactly this.
  useEffect(() => {
    setInput(valueMm === undefined ? "" : formatLength(valueMm, { unit: displayUnit }));
    setError(null);
  }, [displayUnit, valueMm]);

  const commit = async () => {
    const trimmed = input.trim();

    if (trimmed.length === 0 && clearable) {
      setError(null);
      // Clearing an already-set value is a legitimate edit (commit undefined);
      // clearing an already-empty field is a no-op. Non-clearable fields fall
      // through to parseLength, which reports "Enter a measurement.".
      if (valueMm !== undefined) {
        onClear?.();
      }
      return;
    }

    const parsed = parseLength(input, parseUnit);

    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    if (positiveOnly && parsed.valueMm <= 0) {
      setError(`${label} must be greater than zero.`);
      return;
    }

    setError(null);

    try {
      await onCommit(parsed.valueMm);
      setInput(formatLength(parsed.valueMm, { unit: displayUnit }));
    } catch (err) {
      setError(err instanceof Error ? err.message : commitErrorFallback);
    }
  };

  // Message precedence: error > live conversion hint > focus hint. The
  // conversion hint is computed from the current input, so it naturally
  // vanishes once a successful commit reformats the field to its committed
  // form (getConversionHint returns null when input already matches).
  const conversionHint = error
    ? null
    : getConversionHint(input, { parseUnit, displayUnit });
  const showFocusHint = Boolean(focused && !error && !conversionHint && focusHint);

  let message: JSX.Element | null = null;
  if (error) {
    message = (
      <p className="field-error" id={messageId}>
        {error}
      </p>
    );
  } else if (conversionHint) {
    message = (
      <p className="length-field-hint" id={messageId}>
        → {conversionHint}
      </p>
    );
  } else if (showFocusHint) {
    message = (
      <p className="field-hint" id={messageId}>
        {focusHint}
      </p>
    );
  }

  return (
    <label className={compact ? "field-row compact" : "field-row"}>
      <span>{label}</span>
      <input
        aria-describedby={message ? messageId : undefined}
        aria-invalid={error ? "true" : "false"}
        inputMode="decimal"
        placeholder={placeholder}
        value={input}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          void commit();
        }}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void commit();
        }}
      />
      {message}
    </label>
  );
}
