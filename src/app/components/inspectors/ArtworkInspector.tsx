import { useState, type KeyboardEvent, type ReactNode } from "react";
import { LinkBreakIcon } from "@phosphor-icons/react/dist/csr/LinkBreak";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { LockSimpleOpenIcon } from "@phosphor-icons/react/dist/csr/LockSimpleOpen";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import type {
  Artwork,
  ArtworkDisplayAs,
  ArtworkFrame,
  Dimensions,
  DisplayUnit
} from "../../../domain/project";
import {
  effectiveDisplayAs,
  type PlacementForm
} from "../../../domain/placement/artworkForm";
import { MEDIUM_SUGGESTIONS } from "../../../domain/placement/mediumCategory";
import {
  applyAspectFill,
  imageAspectRatio,
  isAspectLocked,
  type PixelAspect
} from "../../../domain/units/aspectFill";
import {
  FRAME_FINISHES,
  deriveFrameWidthFromOverallMm,
  getArtworkOuterDimensionsMm
} from "../../../domain/framing";
import {
  getArtworkScaleState,
  isArtworkRecordComplete,
  type ArtworkScaleState
} from "../../../domain/artworkScale";
import { formatLength } from "../../../domain/units/length";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { useArtworkAsset } from "../../hooks/useArtworkAsset";
import {
  formatDetailsSummary,
  formatDimensionsSummary,
  formatFramingSummary
} from "./artworkInspectorSummaries";
import { InspectorSection } from "./InspectorSection";
import { InspectorRow } from "./InspectorRow";
import { InspectorSummaryRow } from "./InspectorSummaryRow";
import { InspectorNotice } from "./InspectorNotice";
import { ScaleStateBadge } from "./ScaleStateBadge";
import { LengthField } from "../shared/LengthField";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Combobox } from "../ui/combobox";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "../ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";

type ArtworkTextFieldKey =
  | "title"
  | "artist"
  | "date"
  | "accessionNumber"
  | "locationOrLender"
  | "creditLine";

// "medium" is a VIRTUAL key: it is stored at artwork.metadata.medium (the key
// the spreadsheet import wizard writes and every export reads), not as a column
// on Artwork. The store's updateArtwork translates it — see UpdateArtworkChanges
// — so a typed edit and an imported column land in the same slot.
type ArtworkEditableFieldKey = ArtworkTextFieldKey | "medium";

export type ArtworkFieldChanges = Partial<
  Pick<Artwork, ArtworkTextFieldKey | "displayAs">
> & {
  medium?: string;
};

// The "Display" dropdown's options. Every one of them is a storable value now:
// the control shows the RESOLVED type (effectiveDisplayAs, which answers the
// medium-derived or framed default when the record states nothing), and picking
// any entry writes it explicitly. There is deliberately no "Auto" row — a
// curator reading this panel wants to know what the work IS in the room, and
// pinning the answer they can already see is the harmless case.
const DISPLAY_AS_OPTIONS: { value: ArtworkDisplayAs; label: string }[] = [
  { value: "framed", label: "Wall work" },
  { value: "projection", label: "Wall projection" },
  { value: "monitor", label: "Box monitor" },
  { value: "sculpture", label: "Sculpture" }
];

type ArtworkFieldSpec = {
  key: ArtworkEditableFieldKey;
  label: string;
  placeholder?: string;
  // Strings offered in a free-solo combobox (ui/combobox.tsx). Medium stays
  // FREE TEXT — prose like "Oil on canvas" is the common case and must keep
  // working — and the suggestions exist only so the handful of strings that
  // carry a display default (see domain/placement/mediumCategory.ts) are
  // reachable without guessing at spelling. The combobox is what makes that
  // true in both directions: unlike the native <datalist> it replaced, a
  // committed suggestion still shows all the others, so switching medium is a
  // matter of picking rather than deleting first.
  suggestions?: string[];
};

// Identity (what the work is) reads at the top beside the thumbnail and is
// never collapsible — it anchors the panel. Registrar data (where its
// record/loan lives — provenance) sinks to the bottom as the collapsed-by-
// default "Details" section, since it's reference data a curator consults
// less often than the physical measurements or day-to-day arranging.
const IDENTITY_FIELDS: ArtworkFieldSpec[] = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "date", label: "Date" },
  {
    key: "medium",
    label: "Medium",
    placeholder: "Oil on canvas",
    suggestions: MEDIUM_SUGGESTIONS
  }
];

const DETAILS_FIELDS: ArtworkFieldSpec[] = [
  { key: "accessionNumber", label: "Object no." },
  { key: "locationOrLender", label: "Location / lender" },
  {
    key: "creditLine",
    label: "Credit line",
    placeholder: "Courtesy of the artist and Gallery X"
  }
];

// The stored value behind an editable field key, virtual keys included.
function artworkFieldValue(
  artwork: Artwork,
  key: ArtworkEditableFieldKey
): string | undefined {
  if (key !== "medium") return artwork[key];
  const value = artwork.metadata.medium;
  return typeof value === "string" ? value : undefined;
}

type DimensionAxisKey = "widthMm" | "heightMm" | "depthMm";

const DIMENSION_FIELDS: { key: DimensionAxisKey; label: string }[] = [
  { key: "widthMm", label: "Width" },
  { key: "heightMm", label: "Height" },
  { key: "depthMm", label: "Depth" }
];

// Props-driven editor for the right inspector panel when an artwork is
// selected (docs/plan.md §4.1, §5). Everything here comes in as props,
// nothing reaches into the store — including the collapsible sections'
// open state, which App persists via useViewPreferences so it survives
// selection changes and reloads.
export function ArtworkInspector({
  artwork,
  disabledPlacementForm,
  disabledPlacementFormReason,
  isPlaced,
  placementForm,
  placementSection,
  placementTitle,
  removeLabel,
  scopeNote,
  sectionsOpen,
  onCommitDimensions,
  onCommitField,
  onChangePlacementForm,
  onCommitFraming,
  onRemovePlacement,
  onSectionOpenChange,
  unit
}: {
  artwork: Artwork;
  // The segment the Type row shows as active. App derives it from the SURFACE a
  // placed work sits on, and from effectivePlacementForm only while it's
  // unplaced — see PlacementTypeRow.
  placementForm: PlacementForm;
  // Set only when one surface is genuinely unavailable (see PlacementTypeRow).
  disabledPlacementForm?: PlacementForm;
  disabledPlacementFormReason?: string;
  isPlaced: boolean;
  // The wall- or floor-position FIELDS (WallPlacementFields /
  // FloorPlacementFields) for a placed artwork, null/undefined when unplaced.
  // App supplies the bare fields and the section title separately
  // (placementTitle, e.g. "Position on North wall") so this component can
  // wrap them in the same InspectorSection grammar as its own sections.
  // Renders as a plain child of this component's own <form> (never wrapped
  // in a nested <form> — that's invalid HTML; the outer form's onSubmit
  // already preventDefaults).
  placementSection?: ReactNode;
  placementTitle?: string;
  // Destructive-footer label, derived by App from the surface the work sits
  // on ("Remove from wall" / "Remove from floor"). Defaults to the wall
  // phrasing, the common case.
  removeLabel?: string;
  scopeNote?: string;
  // Per-section open flags keyed by section id ("dimensions" | "matframe" |
  // "placement" | "details") — App reads/writes them through
  // useViewPreferences' inspectorSections record. "matframe" carries no
  // stored default (see useViewPreferences); its fallback is derived below.
  sectionsOpen: Record<string, boolean>;
  onCommitDimensions: (dimensions: Dimensions) => void;
  onCommitField: (changes: ArtworkFieldChanges) => void;
  // Changes the wall-vs-floor placement. Distinct from onCommitField's metadata
  // edits: this is a single-purpose commit the segmented control fires on
  // change. For a PLACED work it converts the placement itself in one undo step
  // and never touches the library flag (store.setArtworkPlacementForm).
  onChangePlacementForm: (form: PlacementForm) => void;
  onCommitFraming: (
    changes: Partial<Pick<Artwork, "matWidthMm" | "frame" | "frameIncludedInImage">>
  ) => void;
  onRemovePlacement?: () => void;
  onSectionOpenChange: (sectionId: string, open: boolean) => void;
  unit: DisplayUnit;
}) {
  const { asset, thumbnailUrl } = useArtworkAsset(artwork.assetId);
  const aspect: PixelAspect = {
    widthPx: asset?.widthPx,
    heightPx: asset?.heightPx
  };

  // Collapsed-summary strings quote lengths in the artwork measurement scope
  // (inches / cm), matching what the fields inside would show.
  const { displayUnit: summaryUnit } = getScopedUnitContext(unit, "artwork");

  const isOpen = (sectionId: string, fallback: boolean) =>
    sectionsOpen[sectionId] ?? fallback;

  // Scale state drives both the Dimensions badge and the missing-dims prompt
  // in that section's body — one read, two sinks.
  const scaleState = getArtworkScaleState(artwork);

  // Mat & frame carries no stored default (see useViewPreferences): it opens
  // at rest only when there's a mat or frame worth showing, and otherwise
  // stays out of the way until a curator expands it.
  const hasMatOrFrame = artwork.matWidthMm !== undefined || artwork.frame !== undefined;

  // Framing is a question only a WALL WORK has. A projection has no mat, a
  // sculpture has no frame, and a monitor is a cabinet — for all three the
  // section would describe nothing at all, so it does not render. Nothing is
  // deleted: a stored mat/frame survives on the record (effectiveFraming
  // suppresses it at read time) and the whole section reappears the moment the
  // Display dropdown goes back to "Wall work".
  const showFraming = effectiveDisplayAs(artwork) === "framed";

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {scopeNote ? <p className="artwork-inspector-scope">{scopeNote}</p> : null}

      {/* Keyed on the artwork id so the explicit-edit latch (and any half-typed
          field) resets when the selection changes — a new record must
          re-evaluate its own completeness, never inherit the previous one's. */}
      <ArtworkIdentity
        key={artwork.id}
        artwork={artwork}
        aspect={aspect}
        thumbnailUrl={thumbnailUrl}
        unit={unit}
        onCommitField={onCommitField}
      />

      {/* The collapsible middle of the panel: hairline-separated rows with
          zero extra gap so collapsed sections stack as a tight, scannable
          list (spacing inside each section comes from the section itself). */}
      <div className="inspector-sections">
        {/* Dimensions ride high — the measurement a curator reaches for most. */}
        <InspectorSection
          open={isOpen("dimensions", true)}
          summary={formatDimensionsSummary(artwork.dimensions, summaryUnit)}
          title="Dimensions"
          titleAdornment={<ScaleStateBadge state={scaleState} />}
          onOpenChange={(open) => onSectionOpenChange("dimensions", open)}
        >
          <DimensionsSection
            aspect={aspect}
            dimensions={artwork.dimensions}
            scaleState={scaleState}
            onCommitDimensions={onCommitDimensions}
            unit={unit}
          />
        </InspectorSection>

        {/* Mat + frame ride right below dimensions — they change the physical
            size a work occupies on the wall. Wall works only (see showFraming). */}
        {showFraming ? (
          <InspectorSection
            open={isOpen("matframe", hasMatOrFrame)}
            summary={formatFramingSummary(
              artwork.matWidthMm,
              artwork.frame,
              artwork.dimensions,
              summaryUnit,
              artwork.frameIncludedInImage
            )}
            title="Framing"
            onOpenChange={(open) => onSectionOpenChange("matframe", open)}
          >
            {/* Keyed on the artwork id so the Overall disclosure closes when the
                selection changes rather than carrying its open state across. */}
            <FramingSection
              key={artwork.id}
              dimensions={artwork.dimensions}
              frame={artwork.frame}
              matWidthMm={artwork.matWidthMm}
              frameIncludedInImage={artwork.frameIncludedInImage}
              onCommitFraming={onCommitFraming}
              unit={unit}
            />
          </InspectorSection>
        ) : null}

        {/* Daily-use arranging outranks registrar metadata, so placement
            rides above Details. The section renders only when the work is
            placed; the wall-vs-floor Type row leads it, then App's injected
            position fields. */}
        {placementSection ? (
          <InspectorSection
            open={isOpen("placement", true)}
            title={placementTitle ?? "Placement"}
            onOpenChange={(open) => onSectionOpenChange("placement", open)}
          >
            <PlacementTypeRow
              disabledForm={disabledPlacementForm}
              disabledReason={disabledPlacementFormReason}
              value={placementForm}
              onChangePlacementForm={onChangePlacementForm}
            />
            {placementSection}
          </InspectorSection>
        ) : null}

        {/* Provenance / registrar data, collapsed by default (see
            IDENTITY_FIELDS comment). */}
        <InspectorSection
          open={isOpen("details", false)}
          summary={formatDetailsSummary(artwork.accessionNumber, artwork.locationOrLender)}
          title="Details"
          onOpenChange={(open) => onSectionOpenChange("details", open)}
        >
          {/* Keyed on the artwork id (like ArtworkIdentity/FramingSection):
              TextField seeds its draft once per mount, so without the id in
              the key a selection change kept showing — and could commit —
              the PREVIOUS artwork's value. */}
          {DETAILS_FIELDS.map((field) => (
            <TextField
              key={`${artwork.id}:${field.key}`}
              fieldKey={field.key}
              label={field.label}
              placeholder={field.placeholder}
              value={artworkFieldValue(artwork, field.key)}
              onCommitField={onCommitField}
            />
          ))}
        </InspectorSection>
      </div>

      <div className="inspector-placement">
        {isPlaced ? (
          <Button
            className="inspector-action inspector-danger"
            variant="destructive-ghost"
            onClick={onRemovePlacement}
          >
            <LinkBreakIcon aria-hidden="true" size={15} />
            {removeLabel ?? "Remove from wall"}
          </Button>
        ) : (
          // Unplaced: say so, then let the curator pick wall-vs-floor before
          // placing (the Type row lives in the placement section once placed).
          // Still accurate now that the row converts a placed work: while
          // nothing is placed, the row states the INTENT the drop will honour,
          // and this line names the gesture that acts on it.
          <>
            <InspectorNotice tone="info">
              Not placed yet. Drag it onto a wall or the floor.
            </InspectorNotice>
            <PlacementTypeRow
              value={placementForm}
              onChangePlacementForm={onChangePlacementForm}
            />
          </>
        )}
      </div>
    </form>
  );
}

// Identity zone: an aspect-true thumbnail beside the work's name, with
// state-aware density. An incomplete record (no title, or no width/height to
// draw at scale) always shows the full Title/Artist/Date editor. A complete
// one compacts to a muted one-line Artist · Date summary — the panel heading
// already carries the title — until the curator reopens it. The parent keys
// this on artwork.id, so `userEditing` starts fresh on every selection.
function ArtworkIdentity({
  artwork,
  aspect,
  thumbnailUrl,
  unit,
  onCommitField
}: {
  artwork: Artwork;
  aspect: PixelAspect;
  thumbnailUrl?: string;
  unit: DisplayUnit;
  onCommitField: (changes: ArtworkFieldChanges) => void;
}) {
  const complete = isArtworkRecordComplete(artwork);
  // Explicit-edit latch, separate from `!complete`: once a record is complete
  // it re-expands only when the curator asks (Edit details) or focuses a
  // field — never the instant the record happens to become complete.
  const [userEditing, setUserEditing] = useState(false);
  const editing = !complete || userEditing;

  const artist = artwork.artist?.trim();
  const date = artwork.date?.trim();
  const { displayUnit } = getScopedUnitContext(unit, "artwork");
  const dimensions = formatDimensionsSummary(artwork.dimensions, displayUnit);
  // Named only when it isn't the plain default: "Wall work" on every painting
  // would be noise, but a compacted record whose Display control is folded
  // away still needs to say it's a Box monitor.
  const resolvedDisplayAs = effectiveDisplayAs(artwork);
  const displayLabel =
    resolvedDisplayAs === "framed"
      ? undefined
      : DISPLAY_AS_OPTIONS.find((option) => option.value === resolvedDisplayAs)?.label;

  return (
    <div className="artwork-inspector-header">
      {thumbnailUrl ? (
        <img
          alt=""
          className="artwork-inspector-thumb"
          src={thumbnailUrl}
          // Aspect-true: the square slot's object-fit contains the image, but
          // handing the browser the intrinsic ratio avoids a paint-time
          // reflow once it loads.
          style={
            aspect.widthPx && aspect.heightPx
              ? { aspectRatio: `${aspect.widthPx} / ${aspect.heightPx}` }
              : undefined
          }
        />
      ) : (
        <div aria-hidden="true" className="artwork-inspector-thumb placeholder" />
      )}

      <div className="artwork-tombstone">
        <strong className="artwork-tombstone-title">
          {artwork.title?.trim() || "Untitled artwork"}
        </strong>
        <span className="artwork-tombstone-byline">
          {[artist, date].filter(Boolean).join(" · ") || "Artist and date not recorded"}
        </span>
        <span className="artwork-tombstone-dimensions">
          {[dimensions, displayLabel].filter(Boolean).join(" · ")}
        </span>
        {complete ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-expanded={editing}
                aria-label={editing ? "Close details" : "Edit details"}
                className="artwork-tombstone-edit"
                size="icon-sm"
                variant="ghost"
                onClick={() => setUserEditing((open) => !open)}
              >
                <PencilSimpleIcon aria-hidden="true" size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              {editing ? "Close details" : "Edit details"}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {/* Display collapses WITH the text fields (user decision 2026-08-31):
          it reads as part of the record — open while the record is incomplete,
          folded away behind the pencil once it compacts. What keeps the
          collapsed state honest is the tombstone above, which names any
          non-default display type, so a compacted "Box monitor" still says so
          at a glance. Rendering Display last keeps it directly under Medium,
          the field whose value can imply it. */}
      {editing ? (
        <div className="field-group artwork-inspector-identity">
          {IDENTITY_FIELDS.map((field) => (
            <TextField
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              placeholder={field.placeholder}
              suggestions={field.suggestions}
              value={artworkFieldValue(artwork, field.key)}
              onCommitField={onCommitField}
              // Anti-yank: focusing any identity field latches edit mode, so a
              // record turning complete mid-tab-through never collapses the
              // fields out from under the cursor.
              onFocus={() => setUserEditing(true)}
            />
          ))}

          <Field compact label="Display">
            <Select
              // The RESOLVED type, so the control always states an answer — an
              // untouched video reads "Wall projection" rather than blank — and
              // choosing anything pins that answer explicitly.
              value={effectiveDisplayAs(artwork)}
              onValueChange={(value) => onCommitField({ displayAs: value as ArtworkDisplayAs })}
            >
              <SelectTrigger aria-label="Display type">
                <SelectValue />
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
        </div>
      ) : null}
    </div>
  );
}

function TextField({
  fieldKey,
  label,
  onCommitField,
  onFocus,
  placeholder,
  suggestions,
  value
}: {
  fieldKey: ArtworkEditableFieldKey;
  label: string;
  onCommitField: (changes: ArtworkFieldChanges) => void;
  // Identity fields wire this to latch the edit state (anti-yank); the
  // registrar fields, which never compact, leave it out.
  onFocus?: () => void;
  // Ghost example for fields whose expected shape isn't obvious from the label
  // ("Credit line"). Omitted where the label already says it ("Title").
  placeholder?: string;
  // Offered strings (see ArtworkFieldSpec.suggestions). Their presence swaps the
  // plain input for a free-solo combobox — same input, same commit path, with a
  // list that only offers.
  suggestions?: string[];
  value: string | undefined;
}) {
  const [input, setInput] = useState(value ?? "");

  // Local input is seeded once per mount from `value` and thereafter owns the
  // text until commit; every render site keys this component on artwork.id
  // (identity/framing via their keyed subtrees, registrar fields via their own
  // keys), so a selection change remounts and reseeds. An external write to
  // the same field mid-edit is rare enough that not mirroring it is
  // acceptable — a commit always wins from the field's own value.

  // Takes the text explicitly so picking a suggestion can commit in the same
  // tick it fills the field, without waiting a render for the state to land.
  const commit = (raw: string) => {
    const trimmed = raw.trim();
    // Unlike the project title (always required), these fields are optional
    // curatorial metadata — clearing one is a legitimate edit, so an empty
    // commit is `undefined`, not a revert to the previous value.
    const nextValue = trimmed.length === 0 ? undefined : trimmed;

    if (nextValue === (value ?? undefined)) return;

    onCommitField({ [fieldKey]: nextValue } as ArtworkFieldChanges);
  };

  const sharedProps = {
    placeholder,
    onBlur: () => commit(input),
    onFocus,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  return (
    <Field label={label}>
      {suggestions ? (
        <Combobox
          {...sharedProps}
          suggestions={suggestions}
          value={input}
          onValueChange={setInput}
          // Picking is also a commit: the Display default derives from Medium,
          // so it has to fire now rather than on some later blur.
          onSelectSuggestion={(next) => {
            setInput(next);
            commit(next);
          }}
        />
      ) : (
        <Input
          {...sharedProps}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      )}
    </Field>
  );
}

// Wall-vs-floor selector, shared by the placed (inside the Placement section)
// and unplaced (footer) layouts. A Radix single toggle-group fires "" when the
// active segment is re-clicked (deselect) — ignore that and keep the current
// form, since there's no "back to auto" affordance in v1. The row's label points
// at the group by id rather than wrapping it: a <label> wrapping a toggle-group
// binds to the group's first button, so any label click would toggle "wall".
//
// `value` arrives as a prop rather than being read off the artwork, and that is
// the fix for a specific incoherence, not a preference. The row used to render
// effectivePlacementForm — the LIBRARY flag — for a placed work too, so flipping
// it to Wall while the work stood on the floor left the panel reading "Position
// on floor" under "Type: Wall", with the floor-only fields still showing. App
// now derives this from the surface the object is actually on and lets the flag
// speak only for an unplaced work (see store.setArtworkPlacementForm).
function PlacementTypeRow({
  disabledForm,
  disabledReason,
  onChangePlacementForm,
  value
}: {
  value: PlacementForm;
  // The one segment that cannot be chosen right now, with the reason shown as
  // the row's hint. Only ever set for a real impossibility (a floor work with no
  // placeable wall in the project) — the working case gets no explanatory copy,
  // because retitling the section IS the feedback.
  disabledForm?: PlacementForm;
  disabledReason?: string;
  onChangePlacementForm: (form: PlacementForm) => void;
}) {
  return (
    <InspectorRow
      hint={disabledForm ? disabledReason : undefined}
      htmlFor="artwork-placement-type"
      label="Type"
    >
      <SegmentedToggleGroup
        aria-label="Placement type"
        className="placement-form-toggle"
        id="artwork-placement-type"
        type="single"
        value={value}
        onValueChange={(next) => {
          if (next === "wall" || next === "floor") onChangePlacementForm(next);
        }}
      >
        {/* One-word cells: the row's "Type" label carries the context the old
            in-Dimensions control needed to spell out ("Hangs on wall"), and
            the verb phrases wrap to two lines inside a 260px pane's cells. */}
        <SegmentedToggleGroupItem
          className="placement-form-option"
          disabled={disabledForm === "wall"}
          value="wall"
        >
          Wall
        </SegmentedToggleGroupItem>
        <SegmentedToggleGroupItem
          className="placement-form-option"
          disabled={disabledForm === "floor"}
          value="floor"
        >
          Floor
        </SegmentedToggleGroupItem>
      </SegmentedToggleGroup>
    </InspectorRow>
  );
}

// Section BODY only — the heading and scale badge live in the
// InspectorSection header row.
function DimensionsSection({
  aspect,
  dimensions,
  scaleState,
  onCommitDimensions,
  unit
}: {
  aspect: PixelAspect;
  dimensions: Dimensions;
  scaleState: ArtworkScaleState;
  onCommitDimensions: (dimensions: Dimensions) => void;
  unit: DisplayUnit;
}) {
  const { displayUnit, parseUnit, placeholder } = getScopedUnitContext(unit, "artwork");

  // The lock toggle only makes sense when there's an image ratio to lock
  // to — with no linked image (or a legacy asset missing pixel dims),
  // width/height are just independent numbers.
  const ratio = imageAspectRatio(aspect);
  const locked = ratio !== undefined && isAspectLocked(dimensions, aspect);
  const hasFaceDimensions =
    dimensions.widthMm !== undefined && dimensions.heightMm !== undefined;

  const renderAxis = (field: { key: DimensionAxisKey; label: string }) => (
    <LengthField
      key={field.key}
      compact
      clearable
      positiveOnly
      label={field.label}
      valueMm={dimensions[field.key]}
      displayUnit={displayUnit}
      parseUnit={parseUnit}
      placeholder={placeholder}
      // An axis can be legitimately unmeasured even while others are
      // known — clearing the field commits that axis as undefined.
      onClear={() =>
        onCommitDimensions({ ...dimensions, [field.key]: undefined })
      }
      // Note: committing a dimension value never touches `status` —
      // status is the curator's own claim about how trustworthy these
      // numbers are, not something derived from whether fields happen to
      // be filled in.
      //
      // Committing width or height also auto-fills the other 2D face dim
      // from the image's aspect ratio when the pair is locked (see
      // applyAspectFill for the rule). Depth carries no ratio, so it
      // commits alone. The derived value is a plain committed number —
      // fully editable afterwards, just like a typed one.
      onCommit={(valueMm) =>
        onCommitDimensions(
          field.key === "depthMm"
            ? { ...dimensions, depthMm: valueMm }
            : applyAspectFill(dimensions, field.key, valueMm, aspect)
        )
      }
    />
  );

  return (
    <>
      <div className={ratio !== undefined ? "artwork-dimensions-grid has-lock" : "artwork-dimensions-grid"}>
        {renderAxis(DIMENSION_FIELDS[0])}
        {renderAxis(DIMENSION_FIELDS[1])}
        {renderAxis(DIMENSION_FIELDS[2])}
      </div>

      {ratio !== undefined || hasFaceDimensions ? (
        <div className="artwork-dimensions-utility-row">
          {ratio !== undefined ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  aria-label="Keep proportions"
                  className="artwork-dimensions-lock-row"
                  pressed={locked}
                  size="sm"
                  variant="ghost"
                  onPressedChange={(pressed) =>
                    onCommitDimensions({ ...dimensions, aspectLocked: pressed })
                  }
                >
                  {locked ? (
                    <LockSimpleIcon aria-hidden="true" size={14} />
                  ) : (
                    <LockSimpleOpenIcon aria-hidden="true" size={14} />
                  )}
                </Toggle>
              </TooltipTrigger>
              <TooltipContent className="toolbar-tooltip" side="bottom">
                {locked ? "Unlock proportions" : "Keep proportions"}
              </TooltipContent>
            </Tooltip>
          ) : null}

          {hasFaceDimensions ? (
            <label
              className="artwork-dimensions-approximate"
            >
              <Checkbox
                aria-label="Dimensions are approximate"
                // "unknown" (the image-first default, and every legacy record)
                // reads as checked: it is NOT known, and the scale icon already
                // calls it estimated — an unchecked box beside an "Estimated
                // scale" ruler would have the two disagreeing. Unchecking
                // commits "known"; checking commits "approximate".
                checked={dimensions.status !== "known"}
                onCheckedChange={(checked) =>
                  onCommitDimensions({
                    ...dimensions,
                    status: checked === true ? "approximate" : "known"
                  })
                }
              />
              <span>Approximate</span>
            </label>
          ) : null}
        </div>
      ) : null}

      {/* No real width/height means nothing is drawn to scale — the badge
          says so, this closes the loop with the fix. The notice text isn't
          the only signal (the header badge carries the same state). */}
      {scaleState === "missing" ? (
        <InspectorNotice tone="caution">
          Add width and height to show this artwork at true scale.
        </InspectorNotice>
      ) : null}
    </>
  );
}

// Sensible default frame face width (~1 in) when a curator picks a finish
// before typing a width — the frame is only ever created with a real width.
const DEFAULT_FRAME_WIDTH_MM = 25.4;

// Section BODY only — the "Mat & frame" heading lives in InspectorSection.
// Two thoughts: what you enter (band widths + finish), then what results (the
// Overall footprint, quiet at rest with a disclosure to edit it).
function FramingSection({
  dimensions,
  frame,
  matWidthMm,
  frameIncludedInImage,
  onCommitFraming,
  unit
}: {
  dimensions: Dimensions;
  frame?: ArtworkFrame;
  matWidthMm?: number;
  frameIncludedInImage?: boolean;
  onCommitFraming: (
    changes: Partial<Pick<Artwork, "matWidthMm" | "frame" | "frameIncludedInImage">>
  ) => void;
  unit: DisplayUnit;
}) {
  const { displayUnit, parseUnit, placeholder, system } = getScopedUnitContext(unit, "artwork");

  // When the work's stored size already includes the frame, there is nothing to
  // add or draw — mat/frame/finish and the Overall editor are inapplicable, so
  // they lock. Stored matWidthMm/frame are deliberately NOT cleared (lossless:
  // unchecking restores what was there). The flag wins everywhere regardless,
  // because effectiveFraming (domain/framing.ts) is the sole interpreter — a
  // record carrying both a stored frame AND the flag reads as frame-inclusive.
  const framingLocked = frameIncludedInImage === true;

  // Overall reads quiet at rest; the editor is a nested disclosure, opened
  // only when a curator solves for the frame from a known framed size. Local
  // and default-closed; the parent keys this component on artwork.id, so it
  // resets on selection.
  const [overallOpen, setOverallOpen] = useState(false);

  // Band-width examples, not conversions — these fields take the width of the
  // mat/frame BAND, not the framed size of the work, and a concrete small
  // example (3in mat, 1in frame) is the fastest way to say so.
  const matPlaceholder = system === "imperial" ? 'e.g. 3"' : "e.g. 75 mm";
  const framePlaceholder = system === "imperial" ? 'e.g. 1"' : "e.g. 25 mm";

  // Overall footprint only reads when both image faces are measured — a
  // half-known work has no meaningful outer size to quote or edit.
  const overall =
    dimensions.widthMm !== undefined && dimensions.heightMm !== undefined
      ? getArtworkOuterDimensionsMm(dimensions.widthMm, dimensions.heightMm, matWidthMm, frame)
      : undefined;

  // Editing an overall dim solves for the FRAME band only (mat stays as
  // entered); bands are uniform, so committing either axis updates both —
  // same spirit as the image dims' aspect-ratio autofill. A too-small entry
  // throws, which LengthField surfaces beneath the active field without
  // committing; an entry exactly equal to image + 2·mat clears the frame.
  const commitOverall = (imageMm: number) => (overallMm: number) => {
    const derivation = deriveFrameWidthFromOverallMm(overallMm, imageMm, matWidthMm);

    if (!derivation.ok) {
      throw new Error(
        `Overall must be at least ${formatLength(derivation.minOverallMm, {
          unit: displayUnit
        })} (image plus mat).`
      );
    }

    onCommitFraming({
      frame:
        derivation.frameWidthMm === undefined
          ? undefined
          : { widthMm: derivation.frameWidthMm, finish: frame?.finish ?? "black" }
    });
  };

  // This section only ever renders for a work whose effective display type is
  // "framed" (see showFraming in ArtworkInspector), so there is no display
  // branch here any more — the Display dropdown itself moved up beside Medium,
  // where the question of what a work IS belongs.
  return (
    <>
      {/* Reuses the Dimensions "Approximate" checkbox-row styling (see
          .artwork-dimensions-approximate) rather than adding CSS. */}
      <label className="artwork-dimensions-approximate">
        <Checkbox
          aria-label="Size includes the frame"
          checked={framingLocked}
          onCheckedChange={(checked) =>
            onCommitFraming({ frameIncludedInImage: checked === true ? true : undefined })
          }
        />
        <span>Size includes the frame</span>
      </label>

      <div className="field-pair-grid">
        <LengthField
          compact
          clearable
          positiveOnly
          disabled={framingLocked}
          label="Mat"
          valueMm={matWidthMm}
          displayUnit={displayUnit}
          parseUnit={parseUnit}
          placeholder={matPlaceholder}
          onClear={() => onCommitFraming({ matWidthMm: undefined })}
          onCommit={(valueMm) => onCommitFraming({ matWidthMm: valueMm })}
        />
        <LengthField
          compact
          clearable
          positiveOnly
          disabled={framingLocked}
          label="Frame"
          valueMm={frame?.widthMm}
          displayUnit={displayUnit}
          parseUnit={parseUnit}
          placeholder={framePlaceholder}
          // Clearing the frame width removes the frame entirely; setting it
          // keeps (or defaults) the finish.
          onClear={() => onCommitFraming({ frame: undefined })}
          onCommit={(valueMm) =>
            onCommitFraming({
              frame: { widthMm: valueMm, finish: frame?.finish ?? "black" }
            })
          }
        />
      </div>

      {/* Keep Finish on its own full-width row with the compact stacked label
          used by the other inspector fields. */}
      <Field compact label="Finish">
        <Select
          disabled={framingLocked}
          value={frame?.finish ?? "black"}
          onValueChange={(value) =>
            onCommitFraming({
              frame: {
                widthMm: frame?.widthMm ?? DEFAULT_FRAME_WIDTH_MM,
                finish: value as ArtworkFrame["finish"]
              }
            })
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

      {!framingLocked && overall && dimensions.widthMm !== undefined && dimensions.heightMm !== undefined ? (
        // Derived footprint reads quiet at rest (InspectorSummaryRow); the
        // "Set…" disclosure reveals the editable pair, whose commit re-derives
        // the frame band (see commitOverall above).
        <div className="framing-overall">
          <InspectorSummaryRow
            label="Overall"
            value={`${formatLength(overall.widthMm, { unit: displayUnit })} × ${formatLength(
              overall.heightMm,
              { unit: displayUnit }
            )}`}
            action={
              <button
                aria-label={overallOpen ? "Close overall size editor" : "Edit overall size"}
                aria-controls="framing-overall-editor"
                aria-expanded={overallOpen}
                className="inspector-disclosure-trigger"
                type="button"
                onClick={() => setOverallOpen((open) => !open)}
              >
                <PencilSimpleIcon aria-hidden="true" size={14} />
              </button>
            }
          />

          {overallOpen ? (
            <div className="framing-overall-editor" id="framing-overall-editor">
              <div className="field-pair-grid">
                <LengthField
                  compact
                  positiveOnly
                  label="Overall W"
                  valueMm={overall.widthMm}
                  displayUnit={displayUnit}
                  parseUnit={parseUnit}
                  placeholder={placeholder}
                  onCommit={commitOverall(dimensions.widthMm)}
                />
                <LengthField
                  compact
                  positiveOnly
                  label="Overall H"
                  valueMm={overall.heightMm}
                  displayUnit={displayUnit}
                  parseUnit={parseUnit}
                  placeholder={placeholder}
                  onCommit={commitOverall(dimensions.heightMm)}
                />
              </div>
              <p className="field-hint">Framed size. Editing either derives the frame width.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
