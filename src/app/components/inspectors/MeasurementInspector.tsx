import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { LockSimpleOpenIcon } from "@phosphor-icons/react/dist/csr/LockSimpleOpen";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import type { DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import { InspectorActionGroup } from "./InspectorActionGroup";
import { InspectorNotice } from "./InspectorNotice";
import { InspectorSummaryRow } from "./InspectorSummaryRow";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Toggle } from "../ui/toggle";

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
      <InspectorActionGroup>
        <Button
          className="measurement-save-action"
          disabled={keepDisabled}
          variant="primary"
          onClick={onKeepAsReference}
        >
          Save reference
        </Button>
        <Button className="measurement-clear-action" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </InspectorActionGroup>
    </form>
  );
}

export function ReferenceMeasurementInspector({
  name = "",
  distanceMm,
  unit,
  visible,
  locked,
  outOfBounds = false,
  onChange,
  onDelete
}: {
  name?: string;
  distanceMm: number;
  unit: DisplayUnit;
  visible: boolean;
  locked: boolean;
  outOfBounds?: boolean;
  onChange: (changes: { name?: string; visible?: boolean; locked?: boolean }) => void;
  onDelete: () => void;
}) {
  return (
    <form
      aria-label="Measurement"
      className="inspector-form measurement-inspector"
      onSubmit={(event) => event.preventDefault()}
    >
      <Field label="Name">
        <Input
          defaultValue={name}
          placeholder="Reference measurement"
          onBlur={(event) => onChange({ name: event.currentTarget.value })}
        />
      </Field>
      <InspectorSummaryRow label="Distance" value={formatLength(distanceMm, { unit })} />
      {outOfBounds ? (
        <InspectorNotice icon={<WarningCircleIcon size={15} />} tone="caution">
          An endpoint is outside the current wall surface.
        </InspectorNotice>
      ) : null}
      <InspectorActionGroup label="Reference settings" split>
        <Toggle
          aria-label={visible ? "Hide measurement" : "Show measurement"}
          className="w-full justify-start"
          pressed={visible}
          variant="default"
          onPressedChange={(pressed) => onChange({ visible: pressed })}
        >
          {visible ? <EyeIcon aria-hidden="true" size={16} /> : <EyeSlashIcon aria-hidden="true" size={16} />}
          {visible ? "Visible" : "Hidden"}
        </Toggle>
        <Toggle
          aria-label={locked ? "Unlock measurement" : "Lock measurement"}
          className="w-full justify-start"
          pressed={locked}
          variant="default"
          onPressedChange={(pressed) => onChange({ locked: pressed })}
        >
          {locked ? (
            <LockSimpleIcon aria-hidden="true" size={16} />
          ) : (
            <LockSimpleOpenIcon aria-hidden="true" size={16} />
          )}
          {locked ? "Locked" : "Unlocked"}
        </Toggle>
      </InspectorActionGroup>
      <InspectorActionGroup>
        <Button className="inspector-action inspector-danger" variant="destructive-ghost" onClick={onDelete}>
          Delete measurement
        </Button>
      </InspectorActionGroup>
    </form>
  );
}
