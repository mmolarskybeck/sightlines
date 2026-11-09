import { useId } from "react";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { LockSimpleOpenIcon } from "@phosphor-icons/react/dist/csr/LockSimpleOpen";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type {
  DisplayUnit,
  FloorSupportKind,
  SupportFloorObject
} from "../../../domain/project";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";
import { FloorPlacementFields } from "./FloorObjectInspector";
import { InspectorActionGroup } from "./InspectorActionGroup";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { InspectorNotice } from "./InspectorNotice";
import { InspectorRow } from "./InspectorRow";
import { InspectorSummaryRow } from "./InspectorSummaryRow";
import { PedestalGlyph } from "../toolbar/toolbarGlyphs";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";
import { Switch } from "../ui/switch";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// A pedestal or plinth as its own floor object (floor-supports spec §7). The
// floor twin of ShelfInspector, down to the state-aware "Holds" row: a teaching
// notice while nothing stands on it, a live count and a way back to those works
// once something does.
//
// TWO DIFFERENCES from the floor case beside it, both about what a support IS.
//
// 1. TOP HEIGHT, not Height. `heightMm` is the height of the face a work stands
//    on — the number a rider's `baseHeightMm` matches exactly — so the field
//    says so, the same way the shelf's does. Changing it re-seats the works
//    standing on it (the store carries their baseHeightMm along).
// 2. IT CARRIES THINGS. "Allow overhang", the bonnet and "Fit to works" are all
//    promises about the works on the top face, and the store makes each one TRUE
//    by growing the footprint rather than by refusing the edit. Every field here
//    therefore reads back from the STORE, never from local state, so a clamped
//    write shows what the document actually holds.
//
// Riders are derived at every read (getSupportRiders) and never stored, so
// `riderCount` is a live readout, not a membership the support remembers. The
// words "rider" and "seat" stay out of the copy.
export function SupportInspector({
  support,
  riderCount,
  unit,
  onSelectRiders,
  onCommitKind,
  onCommitPosition,
  onCommitSize,
  onCommitTop,
  onCommitRotation,
  onCommitOverhangAllowed,
  onCommitBonnet,
  onFitToWorks,
  onDelete
}: {
  support: SupportFloorObject;
  // How many works are standing on this support right now.
  riderCount: number;
  unit: DisplayUnit;
  onSelectRiders: () => void;
  onCommitKind: (kind: FloorSupportKind) => void;
  onCommitPosition: (xMm: number, yMm: number) => void;
  onCommitSize: (widthMm: number, depthMm: number) => void;
  // The TOP FACE height above the floor.
  onCommitTop: (heightMm: number) => void;
  onCommitRotation: (rotationDeg: number) => void;
  onCommitOverhangAllowed: (allowed: boolean) => void;
  // Straight to setSupportBonnet: `enabled` switches the glass on or off,
  // `heightMm` types a height (which locks it), `locked` sets the lock.
  onCommitBonnet: (changes: {
    enabled?: boolean;
    heightMm?: number;
    locked?: boolean;
  }) => void;
  onFitToWorks: () => void;
  onDelete: () => void;
}) {
  const kindId = useId();
  const overhangId = useId();
  const bonnetId = useId();
  const size = getScopedUnitContext(unit, "openingSize");

  const noun = support.supportKind === "plinth" ? "plinth" : "pedestal";
  const hasBonnet = support.bonnetHeightMm !== undefined;
  const bonnetLocked = hasBonnet && support.bonnetHeightLocked === true;

  return (
    <form className="inspector-form" onSubmit={(event) => event.preventDefault()}>
      {/* Pedestal ⇄ plinth is a RELABEL with a default height attached, not a
          different object — two mutually exclusive answers to one question, so
          a select, the same grammar as the Display select in ArtworkInspector. */}
      <InspectorRow htmlFor={kindId} label="Kind">
        <Select
          value={support.supportKind}
          onValueChange={(value) => onCommitKind(value as FloorSupportKind)}
        >
          <SelectTrigger aria-label="Kind" id={kindId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pedestal">Pedestal</SelectItem>
            <SelectItem value="plinth">Plinth</SelectItem>
          </SelectContent>
        </Select>
      </InspectorRow>

      {/* An empty pedestal is a blank box of numbers unless something teaches
          the gesture; once works are standing on it, "Holds" is the way back to
          them from the pedestal's own inspector. */}
      {riderCount === 0 ? (
        <InspectorNotice tone="info" icon={<PedestalGlyph aria-hidden="true" size={15} />}>
          Nothing stands on it yet. Drag a work onto it in plan or 3D.
        </InspectorNotice>
      ) : (
        <InspectorSummaryRow
          label="Holds"
          value={`${riderCount} work${riderCount === 1 ? "" : "s"}`}
          action={
            <Button
              className="inspector-action"
              size="sm"
              variant="ghost"
              onClick={onSelectRiders}
            >
              Select works
            </Button>
          }
        />
      )}

      {/* X / Y / Angle from the shared fields; the top height is this
          component's own, for the reason above. No "Height off floor": a
          pedestal stands on the floor and never hangs (createSupport never
          writes baseHeightMm). */}
      <FloorPlacementFields
        floorObject={support}
        unit={unit}
        onCommitPosition={onCommitPosition}
        onCommitSize={onCommitSize}
        onCommitRotation={onCommitRotation}
      />

      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Top height"
          valueMm={support.heightMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={onCommitTop}
        />
      </InspectorFieldGrid>

      {/* TRACK GEOMETRY IS MANDATORY for both switches: the shared `Switch`
          primitive ships the thumb and the state machine but no track size, so
          without `.support-switch` the control renders 34px wide and ZERO tall
          — in the DOM, readable by assistive tech, invisible and unclickable on
          screen. */}
      <InspectorRow
        htmlFor={overhangId}
        hint="Off keeps every work inside the top face."
        label="Allow overhang"
      >
        <Switch
          aria-label="Allow overhang"
          checked={support.overhangAllowed === true}
          className="support-switch"
          // Glass CLEARS overhang: you cannot hang a work over the edge of a
          // box you have also put a bonnet around. Disabled rather than hidden
          // so the rule is visible where a curator goes looking for it.
          disabled={hasBonnet}
          id={overhangId}
          onCheckedChange={onCommitOverhangAllowed}
        />
      </InspectorRow>

      <InspectorRow htmlFor={bonnetId} label="Plexi bonnet">
        <Switch
          aria-label="Plexi bonnet"
          checked={hasBonnet}
          className="support-switch"
          id={bonnetId}
          onCheckedChange={(checked) => onCommitBonnet({ enabled: checked })}
        />
      </InspectorRow>

      {hasBonnet ? (
        <div className="support-bonnet-row">
          <div
            className={
              bonnetLocked ? "support-bonnet-height" : "support-bonnet-height derived"
            }
          >
            <LengthField
              compact
              positiveOnly
              label="Bonnet height"
              // Muted while unlocked (the wrapper class) because the number is
              // DERIVED from the works rather than chosen: it is shown so the
              // curator can see how tall the glass is, and typing in it is
              // itself the act of taking it over (the store locks on a typed
              // number).
              focusHint={
                bonnetLocked ? undefined : "Typing a height keeps it at that number."
              }
              valueMm={support.bonnetHeightMm}
              displayUnit={size.displayUnit}
              parseUnit={size.parseUnit}
              placeholder={size.placeholder}
              onCommit={(heightMm) => onCommitBonnet({ heightMm })}
            />
          </div>
          {/* Same lock grammar as the artwork dimensions' keep-proportions
              toggle: a Toggle carrying the closed/open padlock, with the verb
              in a tooltip. Locked means the number is the curator's; unlocked
              hands it back to the works. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                aria-label="Lock the bonnet height"
                className="support-bonnet-lock"
                pressed={bonnetLocked}
                size="sm"
                variant="ghost"
                onPressedChange={(locked) => onCommitBonnet({ locked })}
              >
                {bonnetLocked ? (
                  <LockSimpleIcon aria-hidden="true" size={14} />
                ) : (
                  <LockSimpleOpenIcon aria-hidden="true" size={14} />
                )}
              </Toggle>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              {bonnetLocked ? "Let the height track the works" : "Keep this height"}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}

      {/* Disabled, not hidden, at zero: the verb is what this box is FOR, and a
          button that appears the moment a work lands on it would read as a new
          feature rather than as one that was waiting. The store no-ops here
          too — this is the honest report of that. */}
      <InspectorActionGroup>
        <Button
          className="inspector-action"
          disabled={riderCount === 0}
          size="sm"
          variant="ghost"
          onClick={onFitToWorks}
        >
          Fit to works
        </Button>
      </InspectorActionGroup>

      <div className="inspector-placement">
        <Button
          className="inspector-action inspector-danger"
          variant="destructive-ghost"
          onClick={onDelete}
        >
          <TrashIcon aria-hidden="true" size={15} />
          Delete {noun}
        </Button>
      </div>
    </form>
  );
}
