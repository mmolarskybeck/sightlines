import type { ArtworkDisplayAs } from "../../../domain/project";

// The "Display" dropdown's options. Every one of them is a storable value now:
// the control shows the RESOLVED type (effectiveDisplayAs, which answers the
// medium-derived or framed default when the record states nothing), and picking
// any entry writes it explicitly. There is deliberately no "Auto" row — a
// curator reading this panel wants to know what the work IS in the room, and
// pinning the answer they can already see is the harmless case.
export const DISPLAY_AS_OPTIONS: { value: ArtworkDisplayAs; label: string }[] = [
  { value: "framed", label: "Wall work" },
  { value: "projection", label: "Wall projection" },
  { value: "monitor", label: "Box monitor" },
  { value: "sculpture", label: "Sculpture" }
];
