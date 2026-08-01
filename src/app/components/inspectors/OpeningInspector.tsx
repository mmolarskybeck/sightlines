import { useEffect, useState } from "react";
import { ArrowsOutLineHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutLineHorizontal";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import type { OpeningAlignment } from "../../../domain/geometry/openingConnections";
import { getOpeningKindLabel } from "../../../domain/placement/createOpening";
import type { OpeningFit } from "../../../domain/placement/fitOpeningOnWall";
import { formatLength } from "../../../domain/units/length";
import type { OpeningWallObject, DisplayUnit } from "../../../domain/project";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";
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

export type OpeningConnectionCandidate = {
  id: string;
  label: string;
  alignment: OpeningAlignment;
};

function alignmentLabel(alignment: OpeningAlignment): string {
  if (alignment.status === "aligned") return "Aligned";
  switch (alignment.reason) {
    case "angle":
      return "Misaligned: walls are not parallel";
    case "gap":
      return "Misaligned: walls are too far apart";
    case "no-overlap":
      return "Misaligned: openings do not overlap enough";
    case "height":
      return "Misaligned: heights do not overlap";
  }
}

// The one-word verdict for a candidate row. The full reason belongs to the
// status line under the picker, which has the whole pane width to say it in —
// repeating it inside every option only makes the trigger wrap.
function shortAlignmentLabel(alignment: OpeningAlignment): string {
  return alignment.status === "aligned" ? "Aligned" : "Misaligned";
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
  onConnect,
  onDisconnect,
  onDelete,
  connectionCandidates,
  opening,
  unit,
  wallLengthMm
}: {
  onCommitPosition: (xMm: number, yMm: number) => Promise<OpeningFit | null>;
  onCommitSize: (widthMm: number, heightMm: number) => Promise<OpeningFit | null>;
  onFitToWall: () => Promise<OpeningFit | null>;
  onConnect: (partnerId: string) => void;
  onDisconnect: () => void;
  onDelete: () => void;
  connectionCandidates: OpeningConnectionCandidate[];
  opening: OpeningWallObject;
  unit: DisplayUnit;
  /** Run of the wall this opening sits on, so the jamb clearances can be read
   * and edited from either end. 0 when the wall cannot be resolved, which
   * hides the far-side field rather than showing a nonsense negative. */
  wallLengthMm: number;
}) {
  const position = getScopedUnitContext(unit, "openingPosition");
  const size = getScopedUnitContext(unit, "openingSize");

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

  // Blocked zones never pair, so the field is absent from their union member.
  const connectsToObjectId =
    "connectsToObjectId" in opening ? opening.connectsToObjectId : undefined;
  const connected = connectionCandidates.find(
    (candidate) => candidate.id === connectsToObjectId
  );
  const disconnectButton = (
    <Button size="sm" variant="ghost" onClick={onDisconnect}>
      Disconnect
    </Button>
  );

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {/* No "Kind" row: the panel's subject header directly above already
          names it (e.g. "Door / Opening"). Size leads, as it does in the
          artwork and wall-case inspectors: the opening's dimensions are what
          govern how it draws, and its position is read off them. */}
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

      {opening.kind === "door" || opening.kind === "window" ? (
        <div className="opening-connection-section">
          {/* Stacked, not label-left: at inspector widths a label column left
              the trigger too narrow for "Gallery 1, West wall" and wrapped it
              to two lines. The label is a plain wrapping <label>, so the
              trigger keeps its own aria-label (a button is not labelable) —
              the same association ArtworkInspector's Finish select uses. */}
          {connectionCandidates.length > 0 ? (
            <Field compact label="Connects to">
              <Select
                key={opening.id}
                value={connectsToObjectId ?? ""}
                onValueChange={(partnerId) => onConnect(partnerId)}
              >
                {/* h-8, not the trigger's default h-9: `.field-row.compact`
                    sizes its inputs to 32px via min-height, which a Tailwind
                    `height` utility silently wins over — the select rendered
                    4px taller than every field above it. tailwind-merge drops
                    h-9 for this, so the override is deterministic. */}
                <SelectTrigger aria-label={`Connect ${opening.kind} to`} className="h-8">
                  {/* Explicit children override Radix's portalled item text, so
                      the trigger shows only where the partner is; its alignment
                      is already spelled out in the status line below. */}
                  <SelectValue
                    className="min-w-0 truncate"
                    placeholder={`Choose another ${opening.kind}`}
                  >
                    {connected?.label ?? "Unavailable opening"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {connectionCandidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.label} · {shortAlignmentLabel(candidate.alignment)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <div className="field-row compact">
              <span>Connects to</span>
              <p className="field-hint">
                No {opening.kind} on a facing wall to pair with.
              </p>
            </div>
          )}
          {connectsToObjectId ? (
            connected?.alignment.status === "aligned" ? (
              // A healthy pairing states itself once and stays quiet. The old
              // filled petrol bar gave the good state more weight than anything
              // else in the panel; only a misaligned pair earns a wash, so the
              // one that needs attention is the one that gets it.
              //
              // role="status" stays on an inner span, not the row, so its text
              // is exactly the alignment label — the Disconnect button's text
              // must not leak into the live-region readout the test asserts on.
              <div className="opening-connection-status">
                <CheckCircleIcon
                  aria-hidden="true"
                  className="opening-connection-status-icon"
                  size={14}
                  weight="fill"
                />
                <span className="opening-connection-status-text" role="status">
                  {alignmentLabel(connected.alignment)}
                </span>
                {disconnectButton}
              </div>
            ) : (
              <InspectorNotice
                action={disconnectButton}
                icon={<WarningIcon size={14} weight="fill" />}
                tone="caution"
              >
                <span role="status">
                  {connected
                    ? alignmentLabel(connected.alignment)
                    : "Connected opening is unavailable"}
                </span>
              </InspectorNotice>
            )
          ) : null}
        </div>
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
