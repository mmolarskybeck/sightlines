import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { OpeningAlignment } from "../../domain/geometry/openingConnections";
import { getOpeningKindLabel } from "../../domain/placement/createOpening";
import type { OpeningWallObject, DisplayUnit } from "../../domain/project";
import { getScopedUnitContext } from "./scopedUnits";
import { LengthField } from "./LengthField";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { InspectorRow } from "./InspectorRow";
import { InspectorNotice } from "./InspectorNotice";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";

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

// Numeric position/size fields for a selected door/window/blocked zone,
// mirroring WallInspector's commit-on-blur/Enter pattern exactly — the
// tactile (drag) and numeric paths must always agree (docs/plan.md §2).
export function OpeningInspector({
  onCommitPosition,
  onCommitSize,
  onConnect,
  onDisconnect,
  onDelete,
  connectionCandidates,
  opening,
  unit
}: {
  onCommitPosition: (xMm: number, yMm: number) => void;
  onCommitSize: (widthMm: number, heightMm: number) => void;
  onConnect: (partnerId: string) => void;
  onDisconnect: () => void;
  onDelete: () => void;
  connectionCandidates: OpeningConnectionCandidate[];
  opening: OpeningWallObject;
  unit: DisplayUnit;
}) {
  const position = getScopedUnitContext(unit, "openingPosition");
  const size = getScopedUnitContext(unit, "openingSize");

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {/* No "Kind" row: the panel's subject header directly above already
          names it (e.g. "Door / Opening"). */}
      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          label="X (wall start)"
          valueMm={opening.xMm}
          displayUnit={position.displayUnit}
          parseUnit={position.parseUnit}
          placeholder={position.placeholder}
          onCommit={(xMm) => onCommitPosition(xMm, opening.yMm)}
        />
        {opening.kind !== "door" && (
          <LengthField
            compact
            label="Y (from floor)"
            valueMm={opening.yMm}
            displayUnit={size.displayUnit}
            parseUnit={size.parseUnit}
            placeholder={size.placeholder}
            onCommit={(yMm) => onCommitPosition(opening.xMm, yMm)}
          />
        )}
      </InspectorFieldGrid>

      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Width"
          valueMm={opening.widthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(widthMm) => onCommitSize(widthMm, opening.heightMm)}
        />
        <LengthField
          compact
          positiveOnly
          label="Height"
          valueMm={opening.heightMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(heightMm) => onCommitSize(opening.widthMm, heightMm)}
        />
      </InspectorFieldGrid>

      {opening.kind === "door" || opening.kind === "window" ? (
        <div className="opening-connection-section">
          {/* The row's own label replaces the old "Connects to" <h3> —
              InspectorRow's label-wrapping-control association (no htmlFor,
              same pattern as ArtworkInspector's Finish select) is exactly the
              ArtworkInspector template for a Select with its own aria-label. */}
          <InspectorRow label="Connects to">
            {connectionCandidates.length > 0 ? (
              <Select
                value={opening.connectsToObjectId ?? ""}
                onValueChange={(partnerId) => onConnect(partnerId)}
              >
                <SelectTrigger aria-label={`Connect ${opening.kind} to`}>
                  <SelectValue placeholder={`Choose another ${opening.kind}`} />
                </SelectTrigger>
                <SelectContent>
                  {connectionCandidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.label} — {alignmentLabel(candidate.alignment)}
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
