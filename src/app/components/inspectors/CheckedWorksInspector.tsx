import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Artwork, ArtworkDisplayAs, DisplayUnit } from "../../../domain/project";
import { effectiveDisplayAs, type PlacementForm } from "../../../domain/placement/artworkForm";
import { MEDIUM_SUGGESTIONS } from "../../../domain/placement/mediumCategory";
import type { BulkArtworkChanges } from "../../store/artworkEditSlice";
import { Button } from "../ui/button";
import { Combobox } from "../ui/combobox";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "../ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { InspectorSection } from "./InspectorSection";
import { MatFrameSection, type BulkMatFrameTarget } from "./SelectionInspector";
import { DISPLAY_AS_OPTIONS } from "./displayAsOptions";
import { TEXT_FIELDS, TEXT_SOURCES, sharedValue, type BulkTextKey } from "./bulkArtworkFields";

function BulkTextField({
  label,
  shared,
  selectionKey,
  suggestions,
  onCommit
}: {
  label: string;
  // Common value, "" when all blank, null when mixed.
  shared: string | null;
  selectionKey: string;
  suggestions?: string[];
  onCommit: (value: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(shared ?? "");
  const [focused, setFocused] = useState(false);
  const cancelBlurCommit = useRef(false);

  useEffect(() => {
    if (!focused) setDraft(shared ?? "");
    // Focus state is intentionally not a dependency: only external changes re-sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, selectionKey]);

  const commit = (raw: string) => {
    const next = raw.trim();
    if (shared === null && next === "") return;
    if (next !== (shared ?? "")) onCommit(next === "" ? undefined : next);
  };

  const sharedProps = {
    "aria-label": label,
    placeholder: shared === null ? "Mixed" : undefined,
    onFocus: () => {
      cancelBlurCommit.current = false;
      setFocused(true);
    },
    onBlur: () => {
      setFocused(false);
      // Escape blurs before React renders the reset draft. Keep cancellation
      // synchronous so that blur cannot commit the discarded text.
      const cancelled = cancelBlurCommit.current;
      cancelBlurCommit.current = false;
      if (!cancelled) commit(draft);
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelBlurCommit.current = true;
        setDraft(shared ?? "");
        event.currentTarget.blur();
      }
    }
  };

  return (
    <Field compact label={label}>
      {suggestions ? (
        <Combobox
          {...sharedProps}
          suggestions={suggestions}
          value={draft}
          onValueChange={setDraft}
          onSelectSuggestion={(next) => {
            setDraft(next);
            commit(next);
          }}
        />
      ) : (
        <Input
          {...sharedProps}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
    </Field>
  );
}

// Inspector body shown while works are checked in the library/checklist. Every
// field commits like the single-work inspector (on blur / pick) as one bulk
// store call; mixed fields stay mixed until the curator types a value.
export function CheckedWorksInspector({
  artworks,
  unit,
  onCommit,
  matFrame,
  onClear
}: {
  artworks: Artwork[];
  unit: DisplayUnit;
  onCommit: (
    changes: BulkArtworkChanges
  ) => Promise<{ updated: number; placementTypeSkipped: number }>;
  matFrame: BulkMatFrameTarget;
  onClear: () => void;
}) {
  const selectionKey = artworks
    .map((a) => a.id)
    .sort()
    .join("|");
  const count = artworks.length;
  const [skipped, setSkipped] = useState(0);

  useEffect(() => {
    setSkipped(0);
  }, [selectionKey]);

  const sharedDisplay = sharedValue<ArtworkDisplayAs>(artworks, effectiveDisplayAs);
  const sharedPlacement = sharedValue<PlacementForm>(artworks, (a) => a.placementForm);

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      <div className="panel-heading">
        <h3>{`${count} checked work${count === 1 ? "" : "s"}`}</h3>
        <Button type="button" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
      <p className="field-hint">Changes apply to every checked work.</p>

      <InspectorSection collapsible={false} title="Details">
        {TEXT_FIELDS.map(({ key, label }) => (
          <BulkTextField
            key={key}
            label={label}
            shared={sharedValue(artworks, TEXT_SOURCES[key as BulkTextKey])}
            selectionKey={selectionKey}
            suggestions={key === "medium" ? MEDIUM_SUGGESTIONS : undefined}
            onCommit={(value) => void onCommit({ [key]: value } as BulkArtworkChanges)}
          />
        ))}

        <Field compact label="Display">
          <Select
            value={sharedDisplay === null || sharedDisplay === "" ? undefined : sharedDisplay}
            onValueChange={(value) =>
              void onCommit({ displayAs: value as ArtworkDisplayAs })
            }
          >
            <SelectTrigger aria-label="Display">
              <SelectValue placeholder="Mixed" />
            </SelectTrigger>
            <SelectContent>
              {DISPLAY_AS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field compact label="Placement type">
          <SegmentedToggleGroup
            aria-label="Placement type"
            type="single"
            value={sharedPlacement ?? ""}
            onValueChange={(next) => {
              if (next !== "wall" && next !== "floor") return;
              void onCommit({ placementForm: next }).then((result) =>
                setSkipped(result.placementTypeSkipped)
              );
            }}
          >
            <SegmentedToggleGroupItem value="wall">Wall</SegmentedToggleGroupItem>
            <SegmentedToggleGroupItem value="floor">Floor</SegmentedToggleGroupItem>
          </SegmentedToggleGroup>
        </Field>
        {skipped > 0 ? (
          <p className="field-hint">
            {`${skipped} placed work${skipped === 1 ? "" : "s"} kept ${skipped === 1 ? "its" : "their"} placement type. Change ${skipped === 1 ? "it" : "them"} from the inspector one at a time.`}
          </p>
        ) : null}
      </InspectorSection>

      <MatFrameSection selectionKey={selectionKey} matFrame={matFrame} unit={unit} />
    </form>
  );
}
