import { useEffect, useId, useState, type ReactNode } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/dist/csr/CaretUp";
import type { DisplayUnit } from "../../domain/project";
import { formatLength, parseLength } from "../../domain/units/length";
import { getConversionHint } from "../../domain/units/conversionHint";
import { Field } from "./ui/field";
import { Input } from "./ui/input";

// Epsilon below which two lengths (in mm) are treated as identical for
// "clean" (unchanged) detection — well under any unit's display precision.
const CLEAN_EPSILON_MM = 0.001;
const ACCEPTED_LENGTH_FORMATS = `Accepts 12', 12 ft, 144", 365.8 cm, or 3.66 m.`;

// Shared commit-on-blur/Enter measurement field. Consolidates the parse,
// validate, and reformat dance that ArtworkInspector, OpeningInspector,
// WallInspector, and RoomDimensionFields each used to duplicate. All lengths
// are stored in mm; `displayUnit` controls how the committed value renders,
// while `parseUnit` is the context unit a bare number is interpreted in — the
// two differ only for imperial opening sizes (specced in inches, read as
// feet-and-inches). See src/domain/units/unitSystem.ts.
export function LengthField({
  label,
  labelBadge,
  valueMm,
  displayUnit,
  parseUnit,
  placeholder,
  compact = false,
  clearable = false,
  disabled = false,
  onClear,
  positiveOnly = false,
  onCommit,
  focusHint,
  commitErrorFallback = "Could not save this measurement.",
  stepMm,
  onEnterWhenClean
}: {
  label: string;
  /** Optional tag rendered inline after the label text (e.g. a "Neighbor"
   * pill when the value is measured against another object, not a wall). */
  labelBadge?: ReactNode;
  valueMm: number | undefined;
  displayUnit: DisplayUnit;
  parseUnit: DisplayUnit;
  placeholder: string;
  compact?: boolean;
  clearable?: boolean;
  /** Locks the input read-only (native disabled): no focus, edit, or commit.
   * Used when an upstream fact makes the measurement inapplicable — e.g. a
   * frame-inclusive work has no editable mat/frame band. */
  disabled?: boolean;
  onClear?: () => void;
  positiveOnly?: boolean;
  onCommit: (valueMm: number) => void | Promise<void>;
  /** Optional context appended to the standard accepted-format guidance. */
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
      // A clearable band (mat, frame) treats "none" as an empty field — say
      // so, since typing 0 is the natural first guess for removing it.
      setError(
        clearable
          ? `${label} must be greater than zero. Leave the field empty for none.`
          : `${label} must be greater than zero.`
      );
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
  const showFocusHint = focused && !error && !conversionHint;

  let message: string | null = null;
  let messageTone: "hint" | "conversion" | "error" = "hint";
  if (error) {
    message = error;
    messageTone = "error";
  } else if (conversionHint) {
    message = `→ ${conversionHint}`;
    messageTone = "conversion";
  } else if (showFocusHint) {
    message = focusHint ? `${ACCEPTED_LENGTH_FORMATS} ${focusHint}` : ACCEPTED_LENGTH_FORMATS;
  }

  const inputElement = (
    <Input
      aria-describedby={message ? messageId : undefined}
      aria-invalid={error ? "true" : "false"}
      disabled={disabled}
      className={
        stepMm !== undefined
          ? "length-field-input length-field-input-stepped"
          : "length-field-input"
      }
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

        if (event.key === "Escape") {
          // Abandon a bad or pending edit: restore the last committed value
          // (same expression the resync effect uses) and clear the error.
          // stopPropagation so a future global deselect-on-Escape never eats a
          // field revert. A clean, error-free field passes Escape through.
          if (isInputClean() && !error) return;
          event.stopPropagation();
          setInput(valueMm === undefined ? "" : formatLength(valueMm, { unit: displayUnit }));
          setError(null);
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
    <Field
      compact={compact}
      label={label}
      labelBadge={labelBadge}
      message={message}
      messageId={messageId}
      messageTone={messageTone}
    >
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
    </Field>
  );
}
