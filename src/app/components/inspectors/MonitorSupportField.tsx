import { useId } from "react";
import type { MonitorSupport } from "../../../domain/project";
import { resolveMonitorSupport } from "../../../domain/geometry/monitorGlyphs";
import { InspectorRow } from "./InspectorRow";
import { Switch } from "../ui/switch";

// What a floor-placed BOX MONITOR stands on: a plain white pedestal (on) or the
// bare floor (off). A two-state either/or with a clear default, so it is a
// switch rather than a segmented track or a pair of toggles — the same grammar
// the export dialogs' one-line options use.
//
// Only ever mounted for a monitor work that HAS a floor placement: the value
// lives on that placement (ArtworkFloorObject.monitorSupport), so with nothing
// placed there is nothing to write to. An unplaced monitor simply gets the
// default when it lands, which is what "absent means pedestal" already says.
//
// ABSENT READS AS PEDESTAL, LIT. Resolved through the shared resolver rather
// than a local `?? "pedestal"`, exactly as FloorArtworkImageFacesField resolves
// its own absent default for display: an untouched placement is already showing
// a pedestal, so the control must show one too. The store's own write does the
// no-op check, so this component never needs to guard against a redundant
// commit.
export function MonitorSupportField({
  monitorSupport,
  onChange
}: {
  monitorSupport: MonitorSupport | undefined;
  onChange: (monitorSupport: MonitorSupport) => void;
}) {
  const switchId = useId();
  const onPedestal = resolveMonitorSupport(monitorSupport) === "pedestal";

  return (
    <InspectorRow htmlFor={switchId} label="On pedestal">
      {/* TRACK GEOMETRY IS MANDATORY. The shared `Switch` primitive ships the
          thumb and the state machine but NO track size — every consumer supplies
          its own (.export-switch-control, .settings-switch, .unit-switch-
          control). Without a class the control renders 34px wide and ZERO tall:
          present in the DOM, readable by assistive tech, and completely
          invisible and unclickable on screen. */}
      <Switch
        aria-label="On pedestal"
        checked={onPedestal}
        className="monitor-support-switch"
        id={switchId}
        onCheckedChange={(checked) => onChange(checked ? "pedestal" : "floor")}
      />
    </InspectorRow>
  );
}
