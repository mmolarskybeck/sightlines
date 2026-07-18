import { useState, type ReactNode } from "react";
import { LinkBreakIcon } from "@phosphor-icons/react/dist/csr/LinkBreak";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { LockSimpleOpenIcon } from "@phosphor-icons/react/dist/csr/LockSimpleOpen";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import type { Artwork, ArtworkFrame, Dimensions, DisplayUnit } from "../../../domain/project";
import {
  effectivePlacementForm,
  type PlacementForm
} from "../../../domain/placement/artworkForm";
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

type ArtworkTextFieldKey = "title" | "artist" | "date" | "accessionNumber" | "locationOrLender";

// Identity (what the work is) reads at the top beside the thumbnail and is
// never collapsible — it anchors the panel. Registrar data (where its
// record/loan lives — provenance) sinks to the bottom as the collapsed-by-
// default "Details" section, since it's reference data a curator consults
// less often than the physical measurements or day-to-day arranging.
const IDENTITY_FIELDS: { key: ArtworkTextFieldKey; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "date", label: "Date" }
];

const DETAILS_FIELDS: { key: ArtworkTextFieldKey; label: string }[] = [
  { key: "accessionNumber", label: "Accession no." },
  { key: "locationOrLender", label: "Location / lender" }
];

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
  isPlaced,
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
  onCommitField: (
    changes: Partial<Pick<Artwork, ArtworkTextFieldKey>>
  ) => void;
  // Writes the explicit placementForm override (wall vs floor). Distinct from
  // onCommitField's metadata edits: this is a single-purpose commit ("Change
  // placement type") the segmented control fires on change.
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
            size a work occupies on the wall. */}
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
            <PlacementTypeRow artwork={artwork} onChangePlacementForm={onChangePlacementForm} />
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
          {DETAILS_FIELDS.map((field) => (
            <TextField
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              value={artwork[field.key]}
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
          <>
            <InspectorNotice tone="info">
              Not placed yet. Drag it onto a wall or the floor.
            </InspectorNotice>
            <PlacementTypeRow artwork={artwork} onChangePlacementForm={onChangePlacementForm} />
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
  onCommitField: (changes: Partial<Pick<Artwork, ArtworkTextFieldKey>>) => void;
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
        <span className="artwork-tombstone-dimensions">{dimensions}</span>
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

      {editing ? (
        <div className="field-group artwork-inspector-identity">
          {IDENTITY_FIELDS.map((field) => (
            <TextField
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              value={artwork[field.key]}
              onCommitField={onCommitField}
              // Anti-yank: focusing any identity field latches edit mode, so a
              // record turning complete mid-tab-through never collapses the
              // fields out from under the cursor.
              onFocus={() => setUserEditing(true)}
            />
          ))}
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
  value
}: {
  fieldKey: ArtworkTextFieldKey;
  label: string;
  onCommitField: (
    changes: Partial<Pick<Artwork, ArtworkTextFieldKey>>
  ) => void;
  // Identity fields wire this to latch the edit state (anti-yank); the
  // registrar fields, which never compact, leave it out.
  onFocus?: () => void;
  value: string | undefined;
}) {
  const [input, setInput] = useState(value ?? "");

  // Local input is seeded once per mount from `value` and thereafter owns the
  // text until commit; the parent keys the identity/framing subtrees on
  // artwork.id, so a selection change remounts and reseeds. Registrar fields
  // never remount on their own, but an external write to the same field is
  // rare enough that not mirroring it mid-edit is acceptable — a commit always
  // wins from the field's own value.

  const commit = () => {
    const trimmed = input.trim();
    // Unlike the project title (always required), these fields are optional
    // curatorial metadata — clearing one is a legitimate edit, so an empty
    // commit is `undefined`, not a revert to the previous value.
    const nextValue = trimmed.length === 0 ? undefined : trimmed;

    if (nextValue === (value ?? undefined)) return;

    onCommitField({ [fieldKey]: nextValue } as Partial<Pick<Artwork, ArtworkTextFieldKey>>);
  };

  return (
    <Field label={label}>
      <Input
        value={input}
        onBlur={commit}
        onChange={(event) => setInput(event.target.value)}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
      />
    </Field>
  );
}

// Wall-vs-floor selector, shared by the placed (inside the Placement section)
// and unplaced (footer) layouts. DISPLAYS the effective form; a change writes
// the explicit override in one commit. A Radix single toggle-group fires ""
// when the active segment is re-clicked (deselect) — ignore that and keep the
// current form, since there's no "back to auto" affordance in v1. The row's
// label points at the group by id rather than wrapping it: a <label> wrapping
// a toggle-group binds to the group's first button, so any label click would
// toggle "wall".
function PlacementTypeRow({
  artwork,
  onChangePlacementForm
}: {
  artwork: Artwork;
  onChangePlacementForm: (form: PlacementForm) => void;
}) {
  return (
    <InspectorRow htmlFor="artwork-placement-type" label="Type">
      <SegmentedToggleGroup
        aria-label="Placement type"
        className="placement-form-toggle"
        id="artwork-placement-type"
        type="single"
        value={effectivePlacementForm(artwork)}
        onValueChange={(value) => {
          if (value === "wall" || value === "floor") onChangePlacementForm(value);
        }}
      >
        {/* One-word cells: the row's "Type" label carries the context the old
            in-Dimensions control needed to spell out ("Hangs on wall"), and
            the verb phrases wrap to two lines inside a 260px pane's cells. */}
        <SegmentedToggleGroupItem className="placement-form-option" value="wall">
          Wall
        </SegmentedToggleGroupItem>
        <SegmentedToggleGroupItem className="placement-form-option" value="floor">
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
