import { useEffect, useId, useState, type ReactNode } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/csr/ArrowsLeftRight";
import { ArrowsOutLineHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutLineHorizontal";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import type {
  SharedOpeningResolution,
  SharedOpeningStatus
} from "../../../domain/geometry/sharedOpeningStatus";
import { getOpeningKindLabel } from "../../../domain/placement/createOpening";
import type { OpeningFit } from "../../../domain/placement/fitOpeningOnWall";
import type { SharedOpeningTarget } from "../../../domain/placement/sharedOpeningAnalysis";
import { formatLength } from "../../../domain/units/length";
import type { DoorLeaf, OpeningWallObject, DisplayUnit } from "../../../domain/project";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";
import { InspectorActionGroup } from "./InspectorActionGroup";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { InspectorNotice } from "./InspectorNotice";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { SegmentedToggleGroup, SegmentedToggleGroupItem } from "../ui/segmented";

// Everything the panel needs to render the shared-opening state of ONE selected
// opening, assembled in App.tsx so this component stays rendering.
//
// Pairing is not a user-managed field — it is a consequence of wall topology —
// so there is no "Connects to" picker and no Disconnect. What is offered is a
// list of RESOLUTIONS for a state that needs one, and which resolutions those
// are is decided by `sharedOpeningResolutions` (exhaustiveness-guarded in the
// domain), never re-derived from the conflict reason here.
export type OpeningSharedSection = {
  status: SharedOpeningStatus;
  resolutions: SharedOpeningResolution[];
  /** The `shared` line, the drift sentence, or the conflict sentence. */
  message: string | null;
  /** Non-empty only when `resolutions` includes "resolve". */
  candidates: { key: string; label: string; target: SharedOpeningTarget }[];
  onResolve: (target: SharedOpeningTarget) => void;
  onComplete: () => void;
  onRealign: () => void;
  onSplit: () => void;
  onKeepThisOnly: () => void;
};

// The Stage 7 state -> UI table. Returns null for every state that has nothing
// to say, so the panel never renders an empty ruled section.
function SharedOpeningSection({
  opening,
  section
}: {
  opening: OpeningWallObject;
  section: OpeningSharedSection;
}) {
  const { candidates, message, resolutions, status } = section;

  // An exposed opening is not a problem: no section, no placeholder. The old
  // "No {kind} on a facing wall to pair with." was mechanism talk about a
  // choice the user does not have.
  if (status.kind === "exposed") return null;

  // Mid-sentence noun for the kind-aware button labels ("Keep both as separate
  // doors" / "…windows"). Blocked zones never pair, so App passes null for them
  // and this component never sees one.
  const noun = getOpeningKindLabel(opening.kind).toLowerCase();

  // A healthy pairing states itself once and stays quiet. The check and the
  // muted line are the same treatment the old "Aligned" status used; only a
  // state needing attention escalates to the filled caution wash.
  //
  // role="status" stays on an inner span so the live-region readout is exactly
  // the sentence, with no button text leaking into it.
  if (status.kind === "shared") {
    if (message === null) return null;
    return (
      <div className="opening-connection-section">
        <div className="opening-connection-status">
          <CheckCircleIcon
            aria-hidden="true"
            className="opening-connection-status-icon"
            size={14}
            weight="fill"
          />
          <span className="opening-connection-status-text" role="status">
            {message}
          </span>
        </div>
      </div>
    );
  }

  const actions: ReactNode[] = [];
  let picker = false;

  for (const resolution of resolutions) {
    switch (resolution) {
      // A pick, not a verb: rendered as the captioned Select below.
      case "resolve":
        picker = true;
        break;

      case "complete":
        actions.push(
          <Button
            key="complete"
            className="inspector-action"
            size="sm"
            variant="inspector"
            onClick={section.onComplete}
          >
            Complete shared opening
          </Button>
        );
        break;

      case "realign":
        actions.push(
          <Button
            key="realign"
            className="inspector-action"
            size="sm"
            variant="inspector"
            onClick={section.onRealign}
          >
            Realign
          </Button>
        );
        break;

      case "split":
        actions.push(
          <Button
            key="split"
            className="inspector-action"
            size="sm"
            variant="inspector"
            onClick={section.onSplit}
          >
            Keep both as separate {noun}s
          </Button>
        );
        break;

      case "keep-this-only":
        actions.push(
          <Button
            key="keep-this-only"
            className="inspector-action"
            size="sm"
            variant="inspector"
            onClick={section.onKeepThisOnly}
          >
            Keep this {noun} only
          </Button>
        );
        break;

      default: {
        // A tenth resolution must be a compile error here, not a state whose
        // control silently never renders.
        const exhaustive: never = resolution;
        void exhaustive;
        break;
      }
    }
  }

  const showPicker = picker && candidates.length > 0;
  if (message === null && actions.length === 0 && !showPicker) return null;

  return (
    <div className="opening-connection-section">
      {message === null ? null : (
        <InspectorNotice icon={<WarningIcon size={14} weight="fill" />} tone="caution">
          <span role="status">{message}</span>
        </InspectorNotice>
      )}

      {/* Stacked, not label-left: at inspector widths a label column leaves the
          trigger too narrow for "Door on East wall in Gallery 2". The label is a
          plain wrapping <label>, so the trigger keeps its own aria-label (a
          button is not labelable). */}
      {showPicker ? (
        <Field compact label="Resolve shared opening">
          <Select
            key={opening.id}
            // Always empty: this is a command, not a stored field. Nothing is
            // "currently selected" — an unresolved conflict has no answer yet —
            // and leaving it uncontrolled would let the trigger keep showing a
            // choice after the store has already acted on it.
            value=""
            onValueChange={(key) => {
              // Map back through `key`. The target is an object, so encoding one
              // into the option value by concatenation would need parsing back
              // out — and a wall id containing the delimiter would silently
              // resolve to the wrong wall.
              const chosen = candidates.find((candidate) => candidate.key === key);
              if (chosen) section.onResolve(chosen.target);
            }}
          >
            {/* h-8, not the trigger's default h-9: `.field-row.compact` sizes
                its inputs to 32px via min-height, which a Tailwind `height`
                utility silently wins over. */}
            <SelectTrigger aria-label="Resolve shared opening" className="h-8">
              <SelectValue
                className="min-w-0 truncate"
                placeholder={`Choose the other side of this ${noun}`}
              />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.key} value={candidate.key}>
                  {candidate.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {/* Below the notice rather than in its single trailing `action` slot:
          `boundary-lost` offers two verbs, and splitting one into the notice
          and one underneath would read as a hierarchy that does not exist. */}
      {actions.length > 0 ? <InspectorActionGroup>{actions}</InspectorActionGroup> : null}
    </div>
  );
}

// Plain-language account of how a request was adjusted to stay on the wall.
// Returns null when the committed result is exactly what was asked for — the
// overwhelmingly common case, which should stay silent.
function describeFit(fit: OpeningFit | null, displayUnit: DisplayUnit): string | null {
  if (!fit) return null;

  const length = (valueMm: number) => formatLength(valueMm, { unit: displayUnit });

  // Nothing was committed: the two faces of this shared opening have no run in
  // common, and half of one cannot move without the other.
  if (fit.noMutualSpan) {
    return "The facing wall leaves no room to resize this shared opening.";
  }

  // Nothing committed either: the far half of this shared opening could not
  // follow the request — the slot it would land in is taken, or the request
  // reached past the run the two rooms share.
  if (fit.partnerBlocked) {
    return "The other side of this shared opening can’t go there, so nothing moved.";
  }

  const byNeighbor = fit.constraint === "neighbor" || fit.constraint === "paired-neighbor";
  const byFacingWall = fit.constraint === "paired-wall" || fit.constraint === "paired-neighbor";

  if (fit.widthClamped) {
    const limit = length(fit.widthMm);
    if (byFacingWall) return `Limited to ${limit} by the facing wall.`;
    if (byNeighbor) return `Limited to ${limit} by the opening beside it.`;
    return `Limited to ${limit}, the maximum width for this wall.`;
  }

  if (fit.positionAdjusted) {
    return `Moved ${length(fit.movedByMm)} to fit the wall.`;
  }

  return null;
}

// Numeric position/size fields for a selected door/window/blocked zone,
// mirroring WallInspector's commit-on-blur/Enter pattern exactly — the
// tactile (drag) and numeric paths must always agree (docs/plan.md §2).
export function OpeningInspector({
  onCommitPosition,
  onCommitSize,
  onFitToWall,
  onDelete,
  onUpdateDoorLeaf,
  opening,
  sharedOpening,
  unit,
  wallLengthMm
}: {
  onCommitPosition: (xMm: number, yMm: number) => Promise<OpeningFit | null>;
  onCommitSize: (widthMm: number, heightMm: number) => Promise<OpeningFit | null>;
  onFitToWall: () => Promise<OpeningFit | null>;
  onDelete: () => void;
  // Mirrors updateDoorLeaf's own contract exactly (store.ts) — this component
  // never computes a handing, it only ever forwards one of three shapes:
  // `{}` (make it hinged, store picks the room-aware default), a one-flag
  // partial (flip just that side of the handing, store fills the other from
  // the door's CURRENT leaf), or `undefined` (back to a plain doorway). Only
  // reachable for a door (see the `door` narrowing below); App.tsx wires it
  // for every opening kind because the store itself already no-ops for a
  // non-door target, so there is no need to make the prop optional here.
  onUpdateDoorLeaf: (leaf: Partial<DoorLeaf> | undefined) => Promise<void>;
  opening: OpeningWallObject;
  /** null for a blocked zone, which never pairs. */
  sharedOpening: OpeningSharedSection | null;
  unit: DisplayUnit;
  /** Run of the wall this opening sits on, so the jamb clearances can be read
   * and edited from either end. 0 when the wall cannot be resolved, which
   * hides the far-side field rather than showing a nonsense negative. */
  wallLengthMm: number;
}) {
  const position = getScopedUnitContext(unit, "openingPosition");
  const size = getScopedUnitContext(unit, "openingSize");

  // Narrowed once so every read below is type-safe without repeating the
  // kind check: `leaf` does not exist on WindowWallObject/BlockedZoneWallObject
  // at all (domain/project.ts's DoorWallObject split), so `door` is the only
  // path that can reach it, and `leaf` truthy-narrows to a real DoorLeaf (an
  // object type, never falsy) for the flip handlers below.
  const door = opening.kind === "door" ? opening : null;
  const leaf = door?.leaf;
  const doorTypeLabelId = useId();

  // Every field here sets hideFocusHint. The focus-only accepted-formats hint
  // appears and disappears under the field, and "Fit wall" sits directly below
  // them: focusing Width pushed the button ~41px down, so a real click landed
  // past it (mousedown blurs the field, the hint vanishes, the button moves out
  // from under the pointer before mouseup). Same failure the dialog LengthFields
  // already guard against. The placeholders carry the format guidance.

  // An opening can only be made to fit by changing width, position, or both, so
  // a committed edit may quietly differ from what was typed. One note says what
  // happened, wherever the request came from — a width commit, a jamb commit,
  // or "Fit wall" — because the sentence describes the opening, not the field
  // that was touched (a Width edit routinely reports a *move*). It renders
  // full-width BELOW "Fit wall": in a half-width field cell it wrapped to three
  // lines, and placing it above the button would shift the button out from
  // under a pointer mid-click, the same trap hideFocusHint guards against.
  //
  // Its lifecycle is explicit and owned here: cleared when the next edit begins
  // (onEditStart) or the selection changes (keyed on opening.id), and set only
  // after the store action resolves — it must survive the value resync that
  // fires the moment the corrected value arrives.
  const [fitNote, setFitNote] = useState<string | null>(null);

  useEffect(() => {
    setFitNote(null);
  }, [opening.id]);

  const describe = (fit: OpeningFit | null) => describeFit(fit, size.displayUnit);
  const clearNote = () => setFitNote(null);

  // xMm is the opening's CENTRE on the wall, so the old "X (wall start)" label
  // was plainly wrong: a door filling a 28' wall reported 14'. Both jambs are
  // shown instead, the same left/right clearance pair the artwork inspector
  // already uses — and for a door it fills the row that used to sit half empty.
  const halfWidthMm = opening.widthMm / 2;
  const fromStartMm = opening.xMm - halfWidthMm;
  const fromEndMm = wallLengthMm - (opening.xMm + halfWidthMm);
  const hasWallRun = wallLengthMm > 0;

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {/* No "Kind" row for doorway vs. door-as-object: the panel's subject
          header directly above already names it (e.g. "Door / Opening").
          This IS a "Type" row, though — doorway vs. hinged is a real choice
          the panel header cannot make for the user, so it gets one, labeled
          "Type" rather than repeating "Door".
          STACKED (label above the control), not the label-left `inspector-row`
          this first copied from WallInspector's "Move endpoint". Two reasons,
          and they point the same way. Every other control in this panel —
          Width, Height, the jamb fields, Swing — puts its label above, so a
          lone label-left row broke the panel's own reading rhythm. And a
          label-left row leaves the control ~58% of a narrow panel, which
          "Hinged door" simply does not fit: `.seg-item` is `white-space:
          nowrap`, so the text spilled past the panel edge and was clipped —
          `min-width: 0` lets the CELL shrink but gives nowrap text nowhere to
          go. The same trade-off is already recorded a few hundred lines below
          for the shared-opening Resolve select ("Stacked, not label-left: at
          inspector widths a label column leaves the trigger too narrow").
          Reuses `inspector-action-group`, which is what "Swing" directly
          underneath uses, so the two rows share their spacing and label
          treatment for free. Wired through aria-labelledby rather than a
          native <label> — a Radix ToggleGroup.Item is a button, not
          labelable. */}
      {door ? (
        <div className="inspector-action-group">
          <span className="inspector-action-group-label" id={doorTypeLabelId}>
            Type
          </span>
          <SegmentedToggleGroup
            aria-labelledby={doorTypeLabelId}
            // Re-fits the topbar-tuned track for the inspector column: equal
            // half-width segments at the panel's own label type size, instead
            // of an inline-flex track demanding its content's width.
            className="inspector-seg-toggle"
            type="single"
            value={leaf ? "hinged" : "doorway"}
            onValueChange={(value) => {
              // Radix fires "" when the pressed item is clicked again
              // (single-select deselect); guarding on the two known values
              // rather than an else-branch means that no-op is simply
              // ignored, matching WallInspector's own guard.
              if (value === "doorway") {
                void onUpdateDoorLeaf(undefined);
              } else if (value === "hinged") {
                // {} — "make it hinged, you pick the default." The store is
                // where floor geometry lives to resolve a room-aware default
                // handing (defaultDoorLeaf); this component must never
                // compute one itself, per updateDoorLeaf's contract.
                void onUpdateDoorLeaf({});
              }
            }}
          >
            <SegmentedToggleGroupItem value="doorway">Doorway</SegmentedToggleGroupItem>
            <SegmentedToggleGroupItem value="hinged">Hinged door</SegmentedToggleGroupItem>
          </SegmentedToggleGroup>
        </div>
      ) : null}

      {/* Size leads, as it does in the artwork and wall-case inspectors: the
          opening's dimensions are what govern how it draws, and its position
          is read off them. */}
      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          hideFocusHint
          positiveOnly
          label="Width"
          valueMm={opening.widthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onEditStart={clearNote}
          onCommit={async (widthMm) => {
            setFitNote(describe(await onCommitSize(widthMm, opening.heightMm)));
          }}
        />
        <LengthField
          compact
          hideFocusHint
          positiveOnly
          label="Height"
          valueMm={opening.heightMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onEditStart={clearNote}
          onCommit={async (heightMm) => {
            setFitNote(describe(await onCommitSize(opening.widthMm, heightMm)));
          }}
        />
      </InspectorFieldGrid>

      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          hideFocusHint
          label="From wall start"
          valueMm={fromStartMm}
          displayUnit={position.displayUnit}
          parseUnit={position.parseUnit}
          placeholder={position.placeholder}
          onEditStart={clearNote}
          onCommit={async (edgeMm) => {
            setFitNote(describe(await onCommitPosition(edgeMm + halfWidthMm, opening.yMm)));
          }}
        />
        {hasWallRun ? (
          <LengthField
            compact
            hideFocusHint
            label="From wall end"
            valueMm={fromEndMm}
            displayUnit={position.displayUnit}
            parseUnit={position.parseUnit}
            placeholder={position.placeholder}
            onEditStart={clearNote}
            onCommit={async (edgeMm) => {
              setFitNote(
                describe(
                  await onCommitPosition(wallLengthMm - edgeMm - halfWidthMm, opening.yMm)
                )
              );
            }}
          />
        ) : null}
        {/* Doors are floor-anchored, so only a window or blocked zone carries a
            vertical position — and yMm is its centre, matching the "Center
            height" the artwork and wall-case inspectors already use. It lands
            alone on the grid's second row, exactly as Depth does under the
            artwork Width·Height pair. */}
        {opening.kind !== "door" ? (
          <LengthField
            compact
            hideFocusHint
            label="Center height"
            valueMm={opening.yMm}
            displayUnit={size.displayUnit}
            parseUnit={size.parseUnit}
            placeholder={size.placeholder}
            onEditStart={clearNote}
            onCommit={async (yMm) => {
              setFitNote(describe(await onCommitPosition(opening.xMm, yMm)));
            }}
          />
        ) : null}
      </InspectorFieldGrid>

      {/* Verbs, not "Left/Right": which side is "left" is ambiguous once the
          plan is rotated, but "flip the hinge" and "flip the swing" name the
          action unambiguously, and the arc redrawing live in plan is the
          real feedback. Only rendered once hinged (leaf narrowed above), so
          toggling Type is what reveals/hides this row — a deliberate click,
          not a focus side-effect, which is the case the hideFocusHint guard
          above is actually protecting against. Flipping itself never adds or
          removes a row (the leaf's flags change, hinged stays hinged), so
          "Fit wall" below never moves out from under a pointer mid-click.
          KNOWN AND ACCEPTED: "Flip swing" has no visible effect in 3D — a
          shut leaf is symmetric about the wall plane, only "Flip hinge"
          moves the knob there. Swing is a plan-view-only property and that
          is where its feedback lives; no notice about this is shown here,
          per the plan (docs/plan.md §7 / snappy-forging-horizon.md §7). */}
      {leaf ? (
        <InspectorActionGroup label="Swing">
          <Button
            className="inspector-action"
            size="sm"
            variant="inspector"
            onClick={() => void onUpdateDoorLeaf({ hingeAtStart: !leaf.hingeAtStart })}
          >
            <ArrowsClockwiseIcon aria-hidden="true" size={15} />
            Flip hinge
          </Button>
          <Button
            className="inspector-action"
            size="sm"
            variant="inspector"
            onClick={() => void onUpdateDoorLeaf({ swingsToLeft: !leaf.swingsToLeft })}
          >
            <ArrowsLeftRightIcon aria-hidden="true" size={15} />
            Flip swing
          </Button>
        </InspectorActionGroup>
      ) : null}

      {/* Wide passages and full-wall openings are legitimate, and reaching one
          by hand means coordinating Width against both jambs. "Fit wall" names
          the result rather than the mechanism ("Max width"): it fills the run
          the opening already sits in — bounded by its neighbours, else the
          wall — and widens in place rather than relocating to a larger gap. */}
      <Button
        className="inspector-action"
        size="sm"
        variant="inspector"
        onClick={async () => setFitNote(describe(await onFitToWall()))}
      >
        <ArrowsOutLineHorizontalIcon aria-hidden="true" size={15} />
        Fit wall
      </Button>

      {fitNote ? (
        <InspectorNotice
          icon={<InfoIcon size={14} />}
          tone="info"
        >
          {fitNote}
        </InspectorNotice>
      ) : null}

      {sharedOpening ? (
        <SharedOpeningSection opening={opening} section={sharedOpening} />
      ) : null}

      <div className="inspector-placement">
        <Button className="inspector-action inspector-danger" variant="destructive-ghost" onClick={onDelete}>
          <TrashIcon aria-hidden="true" size={15} />
          Delete {getOpeningKindLabel(opening.kind).toLowerCase()}
        </Button>
      </div>
    </form>
  );
}
