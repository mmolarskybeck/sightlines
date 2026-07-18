import type { ReactNode } from "react";
import { DoorIcon } from "@phosphor-icons/react/dist/csr/Door";
import { PolygonIcon } from "@phosphor-icons/react/dist/csr/Polygon";
import { RectangleDashedIcon } from "@phosphor-icons/react/dist/csr/RectangleDashed";
import { TextAlignLeftIcon } from "@phosphor-icons/react/dist/csr/TextAlignLeft";
import type { InsertToolKind } from "../../../domain/placement/createOpening";
import { CaseGlyph, PartitionGlyph, RectangleRoomGlyph, WindowGlyph } from "./toolbarGlyphs";

// Shared descriptors for the insert tools, so the full segmented picker and
// the compact menu/trigger agree on every icon, label, resting hint, and
// keyboard accelerator. Icons are the two custom glyphs (window as a mullioned
// pane, partition as a solid wall bar) plus phosphor for the rest; the resting
// hint and the armed phrase feed the tooltips: unpressed reads "Insert door"
// with the D key hint, while pressed reads "Click to place door" with the
// escape hint.
export type InsertToolMeta = {
  key: string;
  label: string;
  hint: string;
  armed: string;
  kbd: string;
  icon: ReactNode;
};

export const OPENING_TOOL_ORDER: InsertToolKind[] = [
  "door",
  "window",
  "blocked-zone",
  "wall-text",
  "case"
];

export const OPENING_TOOL_META: Record<InsertToolKind, InsertToolMeta> = {
  door: {
    key: "door",
    label: "Door",
    hint: "Insert door",
    armed: "Click to place door",
    kbd: "D",
    icon: <DoorIcon aria-hidden="true" size={16} />
  },
  window: {
    key: "window",
    label: "Window",
    hint: "Insert window",
    armed: "Click to place window",
    kbd: "W",
    icon: <WindowGlyph aria-hidden="true" size={16} />
  },
  "blocked-zone": {
    key: "blocked-zone",
    label: "Blocked zone",
    hint: "Mark blocked zone",
    armed: "Click to place blocked zone",
    kbd: "B",
    icon: <RectangleDashedIcon aria-hidden="true" size={16} />
  },
  "wall-text": {
    key: "wall-text",
    label: "Wall text",
    hint: "Insert wall text",
    armed: "Click to place wall text",
    kbd: "T",
    icon: <TextAlignLeftIcon aria-hidden="true" size={16} />
  },
  case: {
    key: "case",
    label: "Case",
    hint: "Insert a display case",
    armed: "Placing a display case",
    kbd: "C",
    icon: <CaseGlyph aria-hidden="true" size={16} />
  }
};

// The three Draw-cluster tools. Each armed phrase names its gesture verb (Drag…
// / Click…), so the deliberate per-tool gesture differences — drag corner to
// corner for the rectangle, click-to-place corners for the outline, drag for
// the partition, are self-documenting in the tooltip.
export const RECT_ROOM_TOOL_META: InsertToolMeta = {
  key: "rect-room",
  label: "Rectangle room",
  hint: "Draw a rectangular room",
  armed: "Drag to draw a room",
  kbd: "R",
  icon: <RectangleRoomGlyph aria-hidden="true" size={16} />
};

export const OUTLINE_ROOM_TOOL_META: InsertToolMeta = {
  key: "outline-room",
  label: "Room outline",
  hint: "Draw room outline",
  armed: "Click to place corners",
  kbd: "⇧R",
  icon: <PolygonIcon aria-hidden="true" size={16} />
};

export const PARTITION_TOOL_META: InsertToolMeta = {
  key: "partition",
  label: "Partition",
  hint: "Draw partition",
  armed: "Drag to draw a partition",
  kbd: "P",
  icon: <PartitionGlyph aria-hidden="true" size={16} />
};

// The descriptor for whatever insert tool is armed, or null when idle — drives
// the compact trigger's icon/name swap and its armed tooltip.
export function armedInsertMeta(activeTool: InsertToolKind | null): InsertToolMeta | null {
  return activeTool ? OPENING_TOOL_META[activeTool] : null;
}

// The descriptor for whatever Draw tool is armed, or null when idle — the same
// role armedInsertMeta plays for the Insert cluster.
export function armedDrawMeta(
  rectActive: boolean,
  outlineActive: boolean,
  partitionActive: boolean
): InsertToolMeta | null {
  if (rectActive) return RECT_ROOM_TOOL_META;
  if (outlineActive) return OUTLINE_ROOM_TOOL_META;
  if (partitionActive) return PARTITION_TOOL_META;
  return null;
}
