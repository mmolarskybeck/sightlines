import { useEffect, useState } from "react";
import type { ArtworkFrame, DisplayUnit } from "../../domain/project";
import { FRAME_FINISHES } from "../../domain/framing";
import { LengthField } from "./LengthField";
import { getScopedUnitContext } from "./scopedUnits";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { Field } from "./ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";

// Sensible default frame face width (~1 in) when a curator picks a finish
// before typing a width — mirrors the single inspector (ArtworkInspector's
// FramingSection): the frame is only ever created with a real width.
const DEFAULT_FRAME_WIDTH_MM = 25.4;

// Bulk mat/frame editor for a multi-selection. Unlike the single inspector this
// starts blank (the picked works may differ) and always sets BOTH bands, so
// applying it can set OR clear each: an empty mat field applies "no mat" and an
// empty frame field applies "no frame" across every target. Works whose stored
// size already includes the frame are skipped by the store; the note here counts
// them so the curator knows before applying.
export function BulkMatFrameDialog({
  open,
  targetCount,
  skippedCount,
  unit,
  onOpenChange,
  onApply
}: {
  open: boolean;
  // Distinct artwork records the change will apply to, already deduped by the
  // caller (skipped frame-inclusive works are excluded from this count).
  targetCount: number;
  // Works among the selection whose size includes the frame; the store skips
  // them and the note names how many.
  skippedCount: number;
  unit: DisplayUnit;
  onOpenChange: (open: boolean) => void;
  onApply: (changes: { matWidthMm?: number; frame?: ArtworkFrame }) => void;
}) {
  const { displayUnit, parseUnit, system } = getScopedUnitContext(unit, "artwork");

  // Local draft, reset each time the dialog opens so a prior apply never leaks
  // into the next selection. Undefined bands read as "No mat" / "No frame".
  const [matWidthMm, setMatWidthMm] = useState<number | undefined>(undefined);
  const [frame, setFrame] = useState<ArtworkFrame | undefined>(undefined);
  useEffect(() => {
    if (open) {
      setMatWidthMm(undefined);
      setFrame(undefined);
    }
  }, [open]);

  // Band-width examples, not conversions — same concrete small examples the
  // single inspector uses to say "this is the width of the BAND".
  const matPlaceholder = system === "imperial" ? 'e.g. 3"' : "e.g. 75 mm";
  const framePlaceholder = system === "imperial" ? 'e.g. 1"' : "e.g. 25 mm";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bulk-matframe-dialog">
        <DialogHeader>
          <DialogTitle>Set mat &amp; frame</DialogTitle>
          <DialogDescription>
            {`Applies to ${targetCount} work${targetCount === 1 ? "" : "s"}. `}
            Changes apply everywhere these artworks are used.
          </DialogDescription>
        </DialogHeader>

        <div className="bulk-matframe-fields">
          <div className="field-pair-grid">
            <LengthField
              compact
              clearable
              positiveOnly
              hideFocusHint
              label="Mat"
              valueMm={matWidthMm}
              displayUnit={displayUnit}
              parseUnit={parseUnit}
              placeholder={matPlaceholder}
              onClear={() => setMatWidthMm(undefined)}
              onCommit={(valueMm) => setMatWidthMm(valueMm)}
            />
            <LengthField
              compact
              clearable
              positiveOnly
              hideFocusHint
              label="Frame"
              valueMm={frame?.widthMm}
              displayUnit={displayUnit}
              parseUnit={parseUnit}
              placeholder={framePlaceholder}
              // Clearing the frame width removes the frame entirely; setting it
              // keeps (or defaults) the finish — same rule as the inspector.
              onClear={() => setFrame(undefined)}
              onCommit={(valueMm) =>
                setFrame((current) => ({ widthMm: valueMm, finish: current?.finish ?? "black" }))
              }
            />
            {/* Finish rides the Frame column (width + finish describe the same
                band), inheriting its exact width so the stack reads as one
                field group: Mat | Frame-then-finish. */}
            <Field compact className="matframe-finish" label="Finish">
              <Select
                // No frame yet: picking a finish first defaults the width, just
                // like the single inspector's finish dropdown.
                value={frame?.finish ?? "black"}
                onValueChange={(value) =>
                  setFrame((current) => ({
                    widthMm: current?.widthMm ?? DEFAULT_FRAME_WIDTH_MM,
                    finish: value as ArtworkFrame["finish"]
                  }))
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
            </Field>
          </div>

          <p className="field-hint">
            Leave a band empty to remove it from every selected work.
          </p>

          {skippedCount > 0 ? (
            <p className="field-hint">
              {skippedCount === 1
                ? "1 selected work includes the frame in its size and will be skipped."
                : `${skippedCount} selected works include the frame in their size and will be skipped.`}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={targetCount === 0}
            variant="primary"
            onClick={() => {
              onApply({ matWidthMm, frame });
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
