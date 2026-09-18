import { useId } from "react";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { LockSimpleOpenIcon } from "@phosphor-icons/react/dist/csr/LockSimpleOpen";
import type {
  ArtworkFloorObject,
  DisplayUnit,
  FloorSupport
} from "../../../domain/project";
import {
  BONNET_HEADROOM_MM,
  normalizeFloorSupport
} from "../../../domain/geometry/supportGlyphs";
import { formatLength } from "../../../domain/units/length";
import { getScopedUnitContext } from "../shared/scopedUnits";
import { LengthField } from "../shared/LengthField";
import { InspectorFieldGrid } from "./InspectorFieldGrid";
import { InspectorNotice } from "./InspectorNotice";
import { InspectorRow } from "./InspectorRow";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// Larger than any gallery, so the normaliser has to clamp it: see
// offsetBoundsMm below.
const PROBE_OFFSET_MM = 1_000_000;

// How far the work may be displaced from the support's center on each axis,
// asked of THE normaliser rather than recomputed here.
//
// The bound depends on the overhang flag, on the bonnet's glass-and-clearance
// inset and on both footprints, and normalizeFloorSupport already decides all
// of that (supportGlyphs.ts, rules 2–3). Re-deriving it in the inspector is
// exactly the drift CLAUDE.md forbids — a field that greys out at a different
// number than the store clamps to is worse than no field. So the question is
// put to the normaliser as a normalise: offer it an absurd offset and read back
// what it allowed. A bound of 0 comes back as an absent key (the normaliser
// writes a clamped-to-zero offset as absent), which is why the `?? 0` here is a
// real answer and not a fallback.
function offsetBoundsMm(
  object: Pick<ArtworkFloorObject, "widthMm" | "depthMm" | "heightMm">,
  support: FloorSupport
): { xMm: number; yMm: number } {
  const { support: probed } = normalizeFloorSupport(object, {
    ...support,
    offsetXMm: PROBE_OFFSET_MM,
    offsetYMm: PROBE_OFFSET_MM
  });
  return { xMm: probed.offsetXMm ?? 0, yMm: probed.offsetYMm ?? 0 };
}

// The support BOX under a floor-placed work — its size, where the work sits on
// it, whether the work may overhang, and the optional plexi bonnet. Rendered
// under FloorPlacementFields (which sizes the WORK) only when a support is
// actually there; "Stands on" above is what puts one there.
//
// THE NEGATION BOUNDARY. `support.offsetXMm/offsetYMm` store the SUPPORT's
// center relative to the WORK's; a curator standing in the gallery moves the
// work on the pedestal, not the pedestal under the work. This component is the
// one place in the codebase that negates between the two readings (see
// FloorSupport in domain/project.ts) — it shows −offset and commits −typed.
//
// Every field reads back from the STORE, never from local state, so a clamped
// write shows what was actually stored: typing a support narrower than the work
// with overhang off snaps the number back up to the work's width, which is the
// honest report of what the document now holds.
export function FloorSupportFields({
  floorObject,
  support,
  unit,
  onChange
}: {
  floorObject: ArtworkFloorObject;
  // The RESOLVED support (resolveFloorSupport), so a box monitor's implicit
  // 800mm pedestal is editable too — the store materialises it on first write.
  support: FloorSupport;
  unit: DisplayUnit;
  // Partial support changes, straight to updateFloorArtworkSupport: an explicit
  // `undefined` deletes the key (that is how the bonnet turns off).
  onChange: (changes: Partial<FloorSupport>) => void;
}) {
  const overhangId = useId();
  const bonnetId = useId();
  const size = getScopedUnitContext(unit, "openingSize");
  const position = getScopedUnitContext(unit, "openingPosition");

  const hasBonnet = support.bonnetHeightMm !== undefined;
  const bonnetLocked = hasBonnet && support.bonnetHeightLocked === true;
  const bounds = offsetBoundsMm(floorObject, support);
  // The normaliser's own verdict on a locked bonnet the work has outgrown. It
  // deliberately does NOT grow the glass (USER DECISION 2026-09-17), so the
  // only honest thing left to do is say so here.
  const { bonnetTooShortByMm } = normalizeFloorSupport(floorObject, support);

  return (
    <div className="support-fields">
      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Support width"
          valueMm={support.widthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(widthMm) => onChange({ widthMm })}
        />
        <LengthField
          compact
          positiveOnly
          label="Support depth"
          valueMm={support.depthMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(depthMm) => onChange({ depthMm })}
        />
      </InspectorFieldGrid>

      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          positiveOnly
          label="Support height"
          valueMm={support.heightMm}
          displayUnit={size.displayUnit}
          parseUnit={size.parseUnit}
          placeholder={size.placeholder}
          onCommit={(heightMm) => onChange({ heightMm })}
        />
      </InspectorFieldGrid>

      {/* Work position on support. Disabled — not hidden — at a bound of 0:
          a work that exactly fills the support top has nowhere to slide, and
          a field that vanishes when the numbers happen to meet reads as a
          bug. Widening the support brings it back. */}
      <InspectorFieldGrid columns={2}>
        <LengthField
          compact
          disabled={bounds.xMm === 0}
          label="Work X (on support)"
          focusHint="Measured from the middle of the support."
          valueMm={-(support.offsetXMm ?? 0)}
          displayUnit={position.displayUnit}
          parseUnit={position.parseUnit}
          placeholder={position.placeholder}
          onCommit={(workXMm) => onChange({ offsetXMm: -workXMm })}
        />
        <LengthField
          compact
          disabled={bounds.yMm === 0}
          label="Work Y (on support)"
          focusHint="Measured from the middle of the support."
          valueMm={-(support.offsetYMm ?? 0)}
          displayUnit={position.displayUnit}
          parseUnit={position.parseUnit}
          placeholder={position.placeholder}
          onCommit={(workYMm) => onChange({ offsetYMm: -workYMm })}
        />
      </InspectorFieldGrid>

      {/* TRACK GEOMETRY IS MANDATORY for both switches below: the shared
          `Switch` primitive ships the thumb and the state machine but no track
          size, so without `.support-switch` the control renders 34px wide and
          ZERO tall — in the DOM, readable by assistive tech, invisible and
          unclickable on screen. */}
      <InspectorRow
        htmlFor={overhangId}
        hint={
          hasBonnet
            ? "A bonnet keeps the work inside the support."
            : undefined
        }
        label="Allow overhang"
      >
        <Switch
          aria-label="Allow overhang"
          checked={support.overhangAllowed === true}
          className="support-switch"
          // A bonnet CLEARS overhang (normaliser rule 1): you cannot hang the
          // work over the edge of a box you have also put glass around. The
          // switch is disabled rather than hidden so the rule is visible where
          // the curator would go looking for it.
          disabled={hasBonnet}
          id={overhangId}
          onCheckedChange={(checked) => onChange({ overhangAllowed: checked })}
        />
      </InspectorRow>

      <InspectorRow htmlFor={bonnetId} label="Plexi bonnet">
        <Switch
          aria-label="Plexi bonnet"
          checked={hasBonnet}
          className="support-switch"
          id={bonnetId}
          onCheckedChange={(checked) =>
            onChange(
              checked
                ? // Seeded at the derived height and deliberately left
                  // UNLOCKED, so it keeps tracking the work. The normaliser
                  // re-derives this exact number; sending it rather than a
                  // placeholder keeps the write honest if the rule ever moves.
                  { bonnetHeightMm: floorObject.heightMm + BONNET_HEADROOM_MM }
                : // Explicit undefined DELETES the height and its lock — see
                  // updateFloorArtworkSupport.
                  { bonnetHeightMm: undefined }
            )
          }
        />
      </InspectorRow>

      {hasBonnet ? (
        <>
          <div className="support-bonnet-row">
            <div
              className={
                bonnetLocked
                  ? "support-bonnet-height"
                  : "support-bonnet-height derived"
              }
            >
              <LengthField
                compact
                positiveOnly
                label="Bonnet height"
                // Muted while unlocked (the wrapper class) because the number
                // is DERIVED from the work rather than chosen: it is shown so
                // the curator can see how tall the glass is, and typing in it
                // is itself the act of taking it over (the store locks on a
                // typed number).
                focusHint={
                  bonnetLocked
                    ? undefined
                    : "Typing a height keeps it at that number."
                }
                valueMm={support.bonnetHeightMm}
                displayUnit={size.displayUnit}
                parseUnit={size.parseUnit}
                placeholder={size.placeholder}
                onCommit={(bonnetHeightMm) => onChange({ bonnetHeightMm })}
              />
            </div>
            {/* Same lock grammar as the artwork dimensions' keep-proportions
                toggle: a Toggle carrying the closed/open padlock, with the
                verb in a tooltip. Locked means the number is the curator's;
                unlocked hands it back to the work. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  aria-label="Lock the bonnet height"
                  className="support-bonnet-lock"
                  pressed={bonnetLocked}
                  size="sm"
                  variant="ghost"
                  onPressedChange={(pressed) =>
                    onChange({ bonnetHeightLocked: pressed })
                  }
                >
                  {bonnetLocked ? (
                    <LockSimpleIcon aria-hidden="true" size={14} />
                  ) : (
                    <LockSimpleOpenIcon aria-hidden="true" size={14} />
                  )}
                </Toggle>
              </TooltipTrigger>
              <TooltipContent className="toolbar-tooltip" side="bottom">
                {bonnetLocked ? "Let the height track the work" : "Keep this height"}
              </TooltipContent>
            </Tooltip>
          </div>

          {bonnetLocked ? (
            <Button
              className="support-bonnet-fit"
              variant="inspector"
              onClick={() => onChange({ bonnetHeightLocked: false })}
            >
              Fit to work
            </Button>
          ) : null}

          {bonnetTooShortByMm > 0 ? (
            <InspectorNotice tone="caution">
              {`Work is ${formatLength(bonnetTooShortByMm, {
                unit: size.displayUnit
              })} taller than the bonnet.`}
            </InspectorNotice>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
