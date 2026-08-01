import { useEffect, useState } from "react";
import { ArrowsOutLineHorizontalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutLineHorizontal";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { OpeningAlignment } from "../../../domain/geometry/openingConnections";
import { getOpeningKindLabel } from "../../../domain/placement/createOpening";
import type { OpeningFit } from "../../../domain/placement/fitOpeningOnWall";
import { formatLength } from "../../../domain/units/length";
import type { OpeningWallObject, DisplayUnit } from "../../../domain/project";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { InspectorRow } from "./InspectorRow";
import { InspectorNotice } from "./InspectorNotice";
import { Button } from "../ui/button";
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
  unit
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
  // a committed edit may quietly differ from what was typed. The note says what
  // happened. Its lifecycle is explicit and owned here: cleared when the next
  // edit begins (onEditStart) or the selection changes (keyed on opening.id),
  // and set only after the store action resolves — it must survive the value
  // resync that fires the moment the corrected value arrives.
  const [widthNote, setWidthNote] = useState<string | null>(null);
  const [positionNote, setPositionNote] = useState<string | null>(null);

  useEffect(() => {
    setWidthNote(null);
    setPositionNote(null);
  }, [opening.id]);

  const describe = (fit: OpeningFit | null) => describeFit(fit, size.displayUnit);

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {/* No "Kind" row: the panel's subject header directly above already
          names it (e.g. "Door / Opening"). */}
      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          hideFocusHint
          label="X (wall start)"
          valueMm={opening.xMm}
          displayUnit={position.displayUnit}
          parseUnit={position.parseUnit}
          placeholder={position.placeholder}
          note={positionNote ?? undefined}
          onEditStart={() => setPositionNote(null)}
          onCommit={async (xMm) => {
            setPositionNote(describe(await onCommitPosition(xMm, opening.yMm)));
          }}
        />
        {opening.kind !== "door" && (
          <LengthField
            compact
            hideFocusHint
            label="Y (from floor)"
            valueMm={opening.yMm}
            displayUnit={size.displayUnit}
            parseUnit={size.parseUnit}
            placeholder={size.placeholder}
            onCommit={(yMm) => void onCommitPosition(opening.xMm, yMm)}
          />
        )}
      </InspectorFieldGrid>

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
          note={widthNote ?? undefined}
          onEditStart={() => setWidthNote(null)}
          onCommit={async (widthMm) => {
            setWidthNote(describe(await onCommitSize(widthMm, opening.heightMm)));
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
          onCommit={(heightMm) => void onCommitSize(opening.widthMm, heightMm)}
        />
      </InspectorFieldGrid>

      {/* Wide passages and full-wall openings are legitimate, and reaching one
          by hand means coordinating Width against X. "Fit wall" names the
          result rather than the mechanism ("Max width"): it fills the run the
          opening already sits in — bounded by its neighbours, else the wall —
          and widens in place rather than relocating to a larger gap. */}
      <Button
        className="inspector-action"
        size="sm"
        variant="inspector"
        onClick={async () => setWidthNote(describe(await onFitToWall()))}
      >
        <ArrowsOutLineHorizontalIcon aria-hidden="true" size={15} />
        Fit wall
      </Button>

      {opening.kind === "door" || opening.kind === "window" ? (
        <div className="opening-connection-section">
          {/* The row's own label replaces the old "Connects to" <h3> —
              InspectorRow's label-wrapping-control association (no htmlFor,
              same pattern as ArtworkInspector's Finish select) is exactly the
              ArtworkInspector template for a Select with its own aria-label. */}
          <InspectorRow label="Connects to">
            {connectionCandidates.length > 0 ? (
              <Select
                key={opening.id}
                value={opening.connectsToObjectId ?? ""}
                onValueChange={(partnerId) => onConnect(partnerId)}
              >
                <SelectTrigger aria-label={`Connect ${opening.kind} to`}>
                  <SelectValue placeholder={`Choose another ${opening.kind}`} />
                </SelectTrigger>
                <SelectContent>
                  {connectionCandidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.label}, {alignmentLabel(candidate.alignment)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="field-hint">
                No nearby {opening.kind}s on a facing wall.
              </p>
            )}
          </InspectorRow>
          {opening.connectsToObjectId ? (() => {
            const connected = connectionCandidates.find(
              (candidate) => candidate.id === opening.connectsToObjectId
            );
            // InspectorNotice generalizes .opening-connection-status (aligned
            // -> positive, misaligned -> caution); Disconnect rides its
            // trailing `action` slot since both only ever show together (the
            // old heading-row button had the same connectsToObjectId gate).
            // role="status" stays on an inner span, not the notice's own div,
            // so its text is exactly the alignment label — the Disconnect
            // button's text must not leak into the live-region readout the
            // test asserts on.
            return (
              <InspectorNotice
                tone={connected?.alignment.status === "aligned" ? "positive" : "caution"}
                action={
                  <Button size="sm" variant="ghost" onClick={onDisconnect}>
                    Disconnect
                  </Button>
                }
              >
                <span role="status">
                  {connected
                    ? alignmentLabel(connected.alignment)
                    : "Connected opening is unavailable"}
                </span>
              </InspectorNotice>
            );
          })() : null}
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
