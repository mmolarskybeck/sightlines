import { DoorIcon } from "@phosphor-icons/react/dist/csr/Door";
import { RectangleDashedIcon } from "@phosphor-icons/react/dist/csr/RectangleDashed";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";
import type { OpeningKind } from "../../domain/placement/createOpening";
import { Button } from "./ui/button";

// The armed tool is exactly an OpeningKind — plan click-to-place produces
// the same three kinds WallInspector's "Add to this wall" row does, just
// with a wall/floor position chosen by pointer + resolvePlanPlacement
// instead of always centering on the currently selected wall.
export type PlanTool = OpeningKind;

// Floating palette inside the plan drawing surface (mirrors ElevationView's
// .surface-label chip positioning, just anchored to the opposite corner so
// the two never collide). Same three insertion kinds as WallInspector's "Add
// to this wall" row, same Phosphor icons, so a curator recognizes the tool
// regardless of which surface they reach for it from. Toggle semantics: the
// currently armed tool reads pressed; clicking it again (or PlanView's own
// Escape/click-to-place handling) disarms it — this component only reports
// intent, PlanView owns the actual armed state.
export function PlanToolbar({
  activeTool,
  onToolChange
}: {
  activeTool: PlanTool | null;
  onToolChange: (tool: PlanTool | null) => void;
}) {
  const tools: { kind: PlanTool; label: string; icon: React.ReactNode }[] = [
    { kind: "door", label: "Door", icon: <DoorIcon aria-hidden="true" size={16} /> },
    { kind: "window", label: "Window", icon: <SquareIcon aria-hidden="true" size={16} /> },
    {
      kind: "blocked-zone",
      label: "Blocked zone",
      icon: <RectangleDashedIcon aria-hidden="true" size={16} />
    }
  ];

  return (
    <div className="plan-toolbar" role="toolbar" aria-label="Add to plan">
      {tools.map((tool) => (
        <Button
          aria-pressed={activeTool === tool.kind}
          className="plan-toolbar-button"
          key={tool.kind}
          variant="inspector"
          onClick={() => onToolChange(activeTool === tool.kind ? null : tool.kind)}
        >
          {tool.icon}
          {tool.label}
        </Button>
      ))}
    </div>
  );
}
