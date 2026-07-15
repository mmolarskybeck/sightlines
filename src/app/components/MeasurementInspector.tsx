import type { DisplayUnit } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import { InspectorActionGroup } from "./InspectorActionGroup";
import { InspectorSummaryRow } from "./InspectorSummaryRow";
import { Button } from "./ui/button";

export function MeasurementInspector({
  distanceMm,
  unit,
  onKeepAsReference,
  onClear,
  keepDisabled = false
}: {
  distanceMm: number;
  unit: DisplayUnit;
  onKeepAsReference: () => void;
  onClear: () => void;
  keepDisabled?: boolean;
}) {
  const formattedDistance = formatLength(distanceMm, { unit });

  return (
    <form
      aria-label="Measurement"
      className="inspector-form measurement-inspector"
      onSubmit={(event) => event.preventDefault()}
    >
      <InspectorSummaryRow label="Distance" value={formattedDistance} />
      <InspectorActionGroup split>
        <Button
          className="inspector-action"
          disabled={keepDisabled}
          variant="primary"
          onClick={onKeepAsReference}
        >
          Keep as reference
        </Button>
        <Button className="inspector-action" variant="inspector" onClick={onClear}>
          Clear
        </Button>
      </InspectorActionGroup>
    </form>
  );
}
