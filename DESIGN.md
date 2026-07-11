---
name: Sightlines
description: A private-by-design exhibition planning tool for room layouts, wall elevations, and artwork placement.
register: product
system:
  css: "Tailwind CSS 4 with @theme inline tokens in src/styles/global.css"
  primitives: "Local Radix/shadcn-style wrappers in src/app/components/ui"
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.155 0.004 240)"
  surface: "oklch(0.975 0.004 230)"
  surface-strong: "oklch(0.925 0.006 230)"
  border: "oklch(0.865 0.006 230)"
  input: "oklch(0.84 0.006 230)"
  muted-foreground: "oklch(0.39 0.007 230)"
  subtle: "oklch(0.55 0.008 230)"
  primary: "oklch(0.42 0.07 200)"
  primary-strong: "oklch(0.3 0.065 200)"
  primary-soft: "oklch(0.94 0.022 200)"
  selection: "oklch(0.55 0.11 200)"
  destructive: "oklch(0.53 0.18 28)"
  caution: "oklch(0.5 0.13 75)"
typography:
  display: '"Figtree Variable", Figtree, ui-sans-serif, system-ui, sans-serif'
  ui: '"Geist Variable", Geist, ui-sans-serif, system-ui, -apple-system, sans-serif'
radii:
  control: "8px"
  fill: "10px"
  panel: "0"
  overlay: "12px"
  seg: "7px"
  track: "10px"
---

# Design System: Sightlines

## North Star

Sightlines should feel like a crisp museum planning instrument: quiet, exact, and professional, with a white workspace, thin architectural borders, compact controls, and restrained petrol accents. It is not a CAD tool, a SaaS dashboard, or a marketing surface. The app should keep its current bones: left rail, topbar, central canvas, left checklist/rooms pane, and right inspector.

The workspace chrome is square and drafting-like, but surfaces that float above it — dialogs, wizards, menus, popovers — are deliberately softer: rounded, spacious, closer to a document tool like Notion than to the drafting canvas beneath. Heavyweight tasks (importing a checklist, mapping columns) should feel calm and approachable, not like filling in a form inside a spreadsheet.

## Implementation Baseline

The design system is now implemented through Tailwind CSS 4 and local shadcn-style primitives. `src/styles/global.css` owns CSS variables and an `@theme inline` bridge so Tailwind utilities can use semantic names like `background`, `foreground`, `border`, `input`, `ring`, `primary`, and `destructive`.

The local wrappers in `src/app/components/ui` are the preferred surface for new components:

- `Button` supports `default`, `primary`, `ghost`, `subtle`, `outline`, `destructive`, `rail`, `tab`, and `inspector` variants.
- `Toggle` and `ToggleGroupItem` support pressed petrol states (now with the `--shadow-pressed` depression) and underline-tab states.
- `SegmentedTabsList`/`SegmentedTabsTrigger` and `SegmentedToggleGroup`/`SegmentedToggleGroupItem` (`ui/segmented.tsx`) render the recessed-track/raised-chip pickers with the sliding chip.
- `Tabs`, `Select`, `DropdownMenu`, and `Switch` keep Radix semantics while carrying Sightlines visual defaults.
- `Collapsible` is a bare-behavior Radix wrapper (no baked-in look); `InspectorSection` composes it into the hairline-separated, summary-bearing disclosure rows the artwork inspector uses.
- `cn()` uses `clsx` and `tailwind-merge`; compose variants there rather than concatenating ad hoc class strings.

## Color

Use a restrained white, black, graphite, and petrol system.

- White (`--background`) is the workspace and panel ground.
- Near-black (`--foreground`) is primary text and structural drawing.
- Thin neutral borders (`--border`, `--input`) separate panes and controls.
- Petrol (`--primary`) is reserved for active modes, focus rings, snap guides, and high-commitment toggles — the chrome/interaction token.
- Petrol soft (`--primary-soft`) is the selected-row and pressed-toggle wash.
- Canvas selection strokes (plan objects, rooms, resize handles, marquee, elevation openings/artwork) use `--selection`, a lighter petrol lifted for contrast against ink walls at canvas stroke weights, rather than `--primary`.
- Caution amber and destructive red are semantic only: approximate data, invalid state, placement warnings, and failures.

Avoid decorative color. The UI should not become teal-themed; petrol is an interaction signal, not wallpaper.

## Shape And Elevation

Sightlines mixes square workspace structure with softer floating surfaces: rectangular where the app is a drafting instrument, rounded where it floats above the work.

- Major panes and layout divisions stay square and separated by 1px borders.
- Inputs, buttons, selects, and compact toolbar controls use an 8px radius.
- Borderless selected fills, rail buttons, and menu rows may use a 10px radius.
- Soft-control grammar (this branch's speculative reroll): mutually-exclusive
  pickers — topbar Plan/Elevation/3D, checklist filters, units, Insert,
  arrange modes, wall/floor placement — are recessed grey tracks
  (`--track`, `--radius-track`) holding quiet segments, with one raised
  white chip (`--chip`, `--shadow-chip`) marking the active choice and
  sliding between segments (220ms `--ease-soft`; suppressed under reduced
  motion). Latching toggles (Grid, Snap, Overlap, rail modes) do the
  opposite: they depress, keeping the petrol wash and adding
  `--shadow-pressed`. Raised = a choice within a set; pressed = a mode
  that's engaged. Underline tabs remain only for subordinate sub-choices
  (help-dialog groups, "Measured from").
- Overlays — dialogs, wizards, popovers, dropdown menus — use a 12px radius (`--radius-overlay`) with a soft, diffuse shadow and at most a whisper of border.
- Inside overlays, structure content with spacing and alignment rather than full-bleed hairline rules. Edge-to-edge bordered grids (tab strips, stat cells, per-field border boxes) read as spreadsheet chrome — the harsh look we are moving away from.
- Shadows are reserved for real overlays and canvas chips, not normal panels.

## Typography

Use one practical UI family plus a restrained display accent.

- Geist carries functional UI: labels, body text, rows, forms, metrics, menus, panel headings, and mode tabs.
- Figtree is limited to the Sightlines wordmark and rail monogram.
- Numeric values should use tabular numerals where alignment matters.
- UI labels should stay compact and readable; do not introduce large display type inside panes.

## Navigation And Layout

The product grammar is stable:

- Left rail chooses the left-side work context: checklist, rooms, issues, or data.
- Topbar owns project identity, view mode, persistence state, and import/export.
- Canvas toolbar has two zones: insertion tools on the left (a segmented Insert control — door, window, blocked zone — shared by Plan and Elevation, disabled only when Elevation has no selected wall), view options on the right (grid, snap, precision, overlap, units). It stays a single row at comfortable widths, then becomes two explicit rows in a narrow canvas column rather than relying on accidental wrapping. Toggle labels drop to icon-only, Insert becomes a caret menu (then a plus button at the smallest width), Precision keeps its current value while dropping only the redundant label, and Units becomes a compact two-segment control with the active system filled in petrol. Plan labels the governing scale as `ft / m`; Elevation labels its detail scale as `in / cm`.
- Left pane is task inventory.
- Right pane is inspection and numeric editing.

Keep panels flat. Improve polish through spacing, alignment, focus states, and component consistency rather than by adding cards.

## Component Rules

Use the primitive variants first. Add bespoke CSS only when the component is canvas-specific or has a domain-specific layout.

- Use icon buttons for compact tools and include accessible labels.
- Use soft segmented tracks (`SegmentedTabsList` / `SegmentedToggleGroup` in `ui/segmented.tsx`) for view modes, checklist filters, and other mutually-exclusive pickers; underline tabs only for subordinate sub-choices.
- Use Radix Select for option sets.
- Use Radix Switch only when the binary state benefits from a switch; the unit selector is intentionally a two-label segmented switch.
- Use petrol-filled primary buttons sparingly. `Import` is currently the main solid CTA in the workspace.
- Every interactive control needs hover, pressed/active, disabled, and focus-visible states.
- Dialogs and wizards follow the overlay grammar: rounded 12px shell, soft shadow, a compact inline stepper or breadcrumb for multi-step flows (never a full-width bordered tab grid), centered rounded drop targets for uploads, and a single subtle top rule grounding the footer actions. Section structure inside the body comes from spacing, not rules.

## Canvas Grid

The plan and elevation grids use a refined two-tier line hierarchy with no dots. Minor gridlines are pale 1px hairlines (`--grid-minor: oklch(0.78 0.008 240 / 0.42)`); major gridlines are heavier 1.3px strokes (`--grid-major: oklch(0.62 0.01 240 / 0.5)`). The grid always reads quieter than walls and objects, serving as an alignment reference without competing for attention.

Plan view grids fill the entire visible workspace to maintain coordinate continuity edge-to-edge. Elevation view grids are clipped to the wall rectangle, with y=0 anchored at the floor — the wall reads as a figure against bare canvas, not a viewport into an infinite space.

Grid intervals are semantic minor/major pairs (per §5.5 of plan.md): each major is a round human value and a 4–12× multiple of its minor. Selection is zoom-adaptive within the pair ladder, automatically stepping to coarser intervals as you zoom out and finer intervals as you zoom in. Per-view density targets keep the grid readable without overwhelming: plan view reads in whole feet/meters at default zoom (1' / 5' imperial, 20cm / 1m metric); elevation reads finer for hang-height work (6" / 2' imperial, 10cm / 1m metric).

## Custom Surfaces

Some parts should remain custom because they are domain tools, not generic shadcn components:

- Plan and elevation SVG canvases, grid rendering, snap guides, resize handles, wall/object strokes.
- Checklist row drag/drop behavior and thumbnail geometry.
- Length fields with unit parsing, conversion hints, and commit-on-blur behavior.
- Warning, uncertainty, and placement confidence indicators.

These custom surfaces should still consume the same tokens and focus rules.

## Next Migration Targets

Continue migrating in this order:

1. `LengthField` and inspector field rows into a reusable `Field`/`Input` primitive.
2. `UncertaintyIndicator`, warning panels, and status copy into semantic alert/badge primitives.
3. Checklist and wall rows into shared selectable-row styles.
4. Canvas chips and toolbar groups into reusable overlay/toolbar primitives.
5. Responsive pane behavior and mobile toolbar density.
