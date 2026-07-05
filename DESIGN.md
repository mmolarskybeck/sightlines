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
  destructive: "oklch(0.53 0.18 28)"
  caution: "oklch(0.5 0.13 75)"
typography:
  display: '"Montserrat Variable", ui-sans-serif, system-ui, sans-serif'
  ui: '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, sans-serif'
radii:
  control: "6px"
  fill: "8px"
  panel: "0"
---

# Design System: Sightlines

## North Star

Sightlines should feel like a crisp museum planning instrument: quiet, exact, and professional, with a white workspace, thin architectural borders, compact controls, and restrained petrol accents. It is not a CAD tool, a SaaS dashboard, or a marketing surface. The app should keep its current bones: left rail, topbar, central canvas, left checklist/rooms pane, and right inspector.

## Implementation Baseline

The design system is now implemented through Tailwind CSS 4 and local shadcn-style primitives. `src/styles/global.css` owns CSS variables and an `@theme inline` bridge so Tailwind utilities can use semantic names like `background`, `foreground`, `border`, `input`, `ring`, `primary`, and `destructive`.

The local wrappers in `src/app/components/ui` are the preferred surface for new components:

- `Button` supports `default`, `primary`, `ghost`, `subtle`, `outline`, `destructive`, `rail`, `tab`, and `inspector` variants.
- `Toggle` and `ToggleGroupItem` support pressed petrol states and underline-tab states.
- `Tabs`, `Select`, `DropdownMenu`, and `Switch` keep Radix semantics while carrying Sightlines visual defaults.
- `cn()` uses `clsx` and `tailwind-merge`; compose variants there rather than concatenating ad hoc class strings.

## Color

Use a restrained white, black, graphite, and petrol system.

- White (`--background`) is the workspace and panel ground.
- Near-black (`--foreground`) is primary text and structural drawing.
- Thin neutral borders (`--border`, `--input`) separate panes and controls.
- Petrol (`--primary`) is reserved for active modes, selected objects, focus rings, snap guides, and high-commitment toggles.
- Petrol soft (`--primary-soft`) is the selected-row and pressed-toggle wash.
- Caution amber and destructive red are semantic only: approximate data, invalid state, placement warnings, and failures.

Avoid decorative color. The UI should not become teal-themed; petrol is an interaction signal, not wallpaper.

## Shape And Elevation

Sightlines is rectangular before rounded.

- Major panes and layout divisions stay square and separated by 1px borders.
- Inputs, buttons, selects, and compact toolbar controls use a 6px radius.
- Borderless selected fills, rail buttons, and menu rows may use an 8px radius.
- Shadows are reserved for real overlays and canvas chips, not normal panels.

## Typography

Use one practical UI family plus a restrained display accent.

- Inter carries labels, body text, rows, forms, metrics, and menus.
- Montserrat is limited to the wordmark, panel headings, and top-level mode tabs.
- Numeric values should use tabular numerals where alignment matters.
- UI labels should stay compact and readable; do not introduce large display type inside panes.

## Navigation And Layout

The product grammar is stable:

- Left rail chooses the left-side work context: checklist, rooms, issues, or data.
- Topbar owns project identity, view mode, persistence state, and import/export.
- Canvas toolbar owns view options: grid, snap, precision, overlap, and units.
- Left pane is task inventory.
- Right pane is inspection and numeric editing.

Keep panels flat. Improve polish through spacing, alignment, focus states, and component consistency rather than by adding cards.

## Component Rules

Use the primitive variants first. Add bespoke CSS only when the component is canvas-specific or has a domain-specific layout.

- Use icon buttons for compact tools and include accessible labels.
- Use underline tabs for view modes and checklist filters.
- Use Radix Select for option sets.
- Use Radix Switch only when the binary state benefits from a switch; the unit selector is intentionally a two-label segmented switch.
- Use petrol-filled primary buttons sparingly. `Add Artwork` is currently the main solid CTA in the workspace.
- Every interactive control needs hover, pressed/active, disabled, and focus-visible states.

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
