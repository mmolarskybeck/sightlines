// The dimmed, tabular key hint that trails a toolbar tooltip's phrase — e.g.
// "Show grid — G" or "Placing a door — Esc cancels". A quiet suffix span, not
// a heavy kbd chip; the "— " separator lives in CSS so callers pass only the
// hint text. Shared by the cluster pickers and the view-option controls.
export function ToolbarTooltipKbd({ hint }: { hint: string }) {
  return <span className="toolbar-tooltip-kbd">{hint}</span>;
}
