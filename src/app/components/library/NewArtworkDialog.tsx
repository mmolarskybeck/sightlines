import { useEffect, useRef, useState } from "react";
import type { DisplayUnit } from "../../../domain/project";
import type { PlacementForm } from "../../../domain/placement/artworkForm";
import { LengthField } from "../shared/LengthField";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "../ui/segmented";

// Creates an image-less work from typed details; it reads as a grey box at
// scale until an image is added.
export function NewArtworkDialog({
  open,
  unit,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  unit: DisplayUnit;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    title?: string;
    artist?: string;
    widthMm: number;
    heightMm: number;
    placementForm: PlacementForm;
  }) => Promise<unknown>;
}) {
  const { displayUnit, parseUnit } = getScopedUnitContext(unit, "artwork");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [widthMm, setWidthMm] = useState<number | undefined>(undefined);
  const [heightMm, setHeightMm] = useState<number | undefined>(undefined);
  const [placementForm, setPlacementForm] = useState<PlacementForm>("wall");
  const [creating, setCreating] = useState(false);
  const [showSizeError, setShowSizeError] = useState(false);
  // The size fields commit on blur, which lands just before the Add click.
  // The button is therefore never size-disabled (a disabled button swallows
  // that click, costing a second press), and create() reads the committed
  // values through refs so the click never sees a stale render.
  const widthRef = useRef<number | undefined>(undefined);
  const heightRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setTitle("");
      setArtist("");
      setWidthMm(undefined);
      setHeightMm(undefined);
      widthRef.current = undefined;
      heightRef.current = undefined;
      setShowSizeError(false);
      setPlacementForm("wall");
      setCreating(false);
    }
  }, [open]);

  async function create() {
    const widthMm = widthRef.current;
    const heightMm = heightRef.current;
    if (widthMm === undefined || widthMm <= 0 || heightMm === undefined || heightMm <= 0) {
      setShowSizeError(true);
      return;
    }
    setCreating(true);
    try {
      await onCreate({
        title: title.trim() || undefined,
        artist: artist.trim() || undefined,
        widthMm,
        heightMm,
        placementForm
      });
      onOpenChange(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="new-artwork-dialog">
        <DialogHeader>
          <DialogTitle>New work without image</DialogTitle>
          <DialogDescription>
            Add a work by its details now. It shows as a placeholder until you add an image.
          </DialogDescription>
        </DialogHeader>

        <div className="bulk-edit-fields">
          <Field compact label="Title">
            <Input
              aria-label="Title"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field compact label="Artist">
            <Input
              aria-label="Artist"
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
            />
          </Field>
          <div className="field-pair-grid">
            <LengthField
              compact
              positiveOnly
              hideFocusHint
              label="Width"
              valueMm={widthMm}
              displayUnit={displayUnit}
              parseUnit={parseUnit}
              placeholder="Width"
              onCommit={(valueMm) => {
                widthRef.current = valueMm;
                setWidthMm(valueMm);
                setShowSizeError(false);
              }}
            />
            <LengthField
              compact
              positiveOnly
              hideFocusHint
              label="Height"
              valueMm={heightMm}
              displayUnit={displayUnit}
              parseUnit={parseUnit}
              placeholder="Height"
              onCommit={(valueMm) => {
                heightRef.current = valueMm;
                setHeightMm(valueMm);
                setShowSizeError(false);
              }}
            />
          </div>
          <Field compact label="Type">
            <SegmentedToggleGroup
              aria-label="Placement type"
              type="single"
              value={placementForm}
              onValueChange={(next) => {
                if (next === "wall" || next === "floor") setPlacementForm(next);
              }}
            >
              <SegmentedToggleGroupItem value="wall">Wall</SegmentedToggleGroupItem>
              <SegmentedToggleGroupItem value="floor">Floor</SegmentedToggleGroupItem>
            </SegmentedToggleGroup>
          </Field>
          {showSizeError ? (
            <p className="field-error" role="alert">
              Enter a width and height to add the work.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={creating} variant="primary" onClick={() => void create()}>
            Add work
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
