import { useId } from "react";
import type { ArtworkFloorObject } from "../../../domain/project";
import type { DisplayAsSource } from "../../../domain/placement/artworkForm";
import { resolveStandsOn } from "../../../domain/geometry/supportGlyphs";
import type { FloorArtworkStandsOn } from "../../store/floorObjectSlice";
import { InspectorRow } from "./InspectorRow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";

// The four mutually exclusive things a floor-placed work can be standing on.
// Ordered from the ground up — floor, plinth's-worth of lift, pedestal, air —
// except that Pedestal leads Plinth because it is the far commoner choice for a
// single sculpture and a plinth is the specialised low-wide case.
const STANDS_ON_OPTIONS: { value: FloorArtworkStandsOn; label: string }[] = [
  { value: "floor", label: "Floor" },
  { value: "pedestal", label: "Pedestal" },
  { value: "plinth", label: "Plinth" },
  { value: "suspended", label: "Suspended" }
];

// What a floor-placed artwork stands on, as ONE select rather than a switch per
// state. Four states that exclude each other is exactly what a select is for
// (the same grammar as the Display select in ArtworkInspector): a pair of
// switches for "on a pedestal" and "suspended" would let a curator ask for both
// and then have to be told no.
//
// Replaces MonitorSupportField, whose two-state "On pedestal" switch was this
// same question asked only of box monitors. A monitor keeps its own reading of
// the answer — absent monitorSupport still resolves to its 800mm cabinet-width
// pedestal, so this control shows "Pedestal" for an untouched monitor — and
// simply loses the option it never had: a CRT does not hang on wires (see
// resolveStandsOn, which refuses to report a monitor as suspended, and the
// store action, which refuses to write it).
//
// Only ever mounted from App's `placedFloorArtwork` branch: the value lives on
// that placement (ArtworkFloorObject.support / .baseHeightMm / .monitorSupport),
// so with nothing placed on the floor there is nothing to write to.
//
// THE VALUE IS RESOLVED, not read off the stored keys — the same rule
// FloorArtworkImageFacesField and the old MonitorSupportField followed. A work
// with a stale baseHeightMm under a pedestal stands on the pedestal, and the
// control must say so; the store's own write does the no-op check, so nothing
// here has to guard against re-choosing what is already shown.
export function StandsOnField({
  artwork,
  floorObject,
  isMonitor,
  onChange
}: {
  // The work's display record, for the monitor reading inside resolveStandsOn.
  // Undefined is tolerated (a placement whose artwork is still loading) and
  // simply reads as a non-monitor, exactly as the resolvers do.
  artwork: DisplayAsSource | undefined;
  floorObject: ArtworkFloorObject;
  // Passed in rather than re-derived so App's one answer to "is this a monitor"
  // drives the option list and the withheld fields alike.
  isMonitor: boolean;
  onChange: (standsOn: FloorArtworkStandsOn) => void;
}) {
  const selectId = useId();
  const value = resolveStandsOn(floorObject, artwork);
  const options = isMonitor
    ? STANDS_ON_OPTIONS.filter((option) => option.value !== "suspended")
    : STANDS_ON_OPTIONS;

  return (
    <InspectorRow htmlFor={selectId} label="Stands on">
      <Select
        value={value}
        onValueChange={(next) => onChange(next as FloorArtworkStandsOn)}
      >
        <SelectTrigger aria-label="Stands on" id={selectId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </InspectorRow>
  );
}
