import { useEffect, useId, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/dist/csr/CaretUp";
import type { DisplayUnit } from "../../domain/project";
import { formatLength, parseLength } from "../../domain/units/length";
import { getConversionHint } from "../../domain/units/conversionHint";
import { Input } from "./ui/input";

// Epsilon below which two lengths (in mm) are treated as identical for
// "clean" (unchanged) detection — well under any unit's display precision.
const CLEAN_EPSILON_MM = 0.001;

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
  commitErrorFallback = "Could not save this measurement.",
  stepMm,
  onEnterWhenClean
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
  /** Enables the chevron stepper column + ArrowUp/ArrowDown nudge, stepping by this many mm. */
  stepMm?: number;
  /** On Enter, when the input is "clean" (parses to the committed value, or is untouched),
   * call this instead of re-committing. Lets a caller distinguish "Enter to apply a live
   * preview" from "Enter again to accept it". */
  onEnterWhenClean?: () => void;
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

  // Step from the currently typed value when it parses; otherwise fall back
  // to the last committed value. No clamping — negative lengths are
  // legitimate (e.g. an inset past a wall edge), and any real constraint is
  // enforced by the caller's own collision/validation logic. The resync
  // effect above reformats `input` once the caller's `valueMm` prop updates.
  const step = (direction: 1 | -1) => {
    if (stepMm === undefined) return;
    const parsed = parseLength(input, parseUnit);
    const base = parsed.ok ? parsed.valueMm : valueMm ?? 0;
    const next = base + direction * stepMm;
    setError(null);
    Promise.resolve(onCommit(next)).catch((err) => {
      setError(err instanceof Error ? err.message : commitErrorFallback);
    });
  };

  // "Clean" = the input doesn't represent a pending edit: either it parses to
  // (within epsilon of) the committed value, or it's simply untouched from
  // what the committed value would format as (covers e.g. an empty,
  // unparseable field that was never edited).
  const isInputClean = () => {
    const trimmed = input.trim();
    const committedText = valueMm === undefined ? "" : formatLength(valueMm, { unit: displayUnit });
    if (trimmed === committedText) return true;
    const parsed = parseLength(input, parseUnit);
    return parsed.ok && valueMm !== undefined && Math.abs(parsed.valueMm - valueMm) < CLEAN_EPSILON_MM;
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

  const inputElement = (
    <Input
      aria-describedby={message ? messageId : undefined}
      aria-invalid={error ? "true" : "false"}
      className={stepMm !== undefined ? "length-field-input-stepped" : undefined}
      inputMode="decimal"
      placeholder={placeholder}
      size={compact ? "compact" : "default"}
      value={input}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        void commit();
      }}
      onChange={(event) => setInput(event.target.value)}
      onKeyDown={(event) => {
        if (stepMm !== undefined && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          step(event.key === "ArrowUp" ? 1 : -1);
          return;
        }

        if (event.key !== "Enter") return;
        event.preventDefault();

        if (onEnterWhenClean && isInputClean()) {
          onEnterWhenClean();
          return;
        }

        void commit();
      }}
    />
  );

  return (
    <label className={compact ? "field-row compact" : "field-row"}>
      <span>{label}</span>
      {stepMm !== undefined ? (
        <div className="length-field-input-wrap">
          {inputElement}
          <div className="length-field-steppers">
            <button
              aria-label={`Increase ${label}`}
              tabIndex={-1}
              type="button"
              onClick={() => step(1)}
            >
              <CaretUpIcon aria-hidden="true" size={10} />
            </button>
            <button
              aria-label={`Decrease ${label}`}
              tabIndex={-1}
              type="button"
              onClick={() => step(-1)}
            >
              <CaretDownIcon aria-hidden="true" size={10} />
            </button>
          </div>
        </div>
      ) : (
        inputElement
      )}
      {message}
    </label>
  );
}
