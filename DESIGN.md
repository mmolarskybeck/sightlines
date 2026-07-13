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
  destructive: "oklch(0.47 0.15 22)"
  destructive-strong: "oklch(0.4 0.13 22)"
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
- `SegmentedTabsList`/`SegmentedTabsTrigger` and `SegmentedToggleGroup`/`SegmentedToggleGroupItem` (`ui/segmented.tsx`) render the recessed-track/raised-chip pickers with the sliding chip; `UnderlineTabsList`/`UnderlineTabsTrigger` and `UnderlineToggleGroup`/`UnderlineToggleGroupItem` render tabs with the sliding petrol underline (3px, pill caps) off the same measuring hook.
- `Tabs`, `Select`, `DropdownMenu`, and `Switch` keep Radix semantics while carrying Sightlines visual defaults.
- `Checkbox` and `Tooltip` are the standard primitives for boolean data qualifiers and contextual help. Do not introduce native checkbox styling or browser `title` tooltips when these wrappers apply.
- `Field` composes labels, controls, transient guidance, and errors in stacked or inspector-row layouts; `Input` supplies the shared text-control states and sizing. Measurement-specific parsing and conversion behavior remains in `LengthField`, which composes both primitives.
- `Collapsible` is a bare-behavior Radix wrapper (no baked-in look); `InspectorSection` composes it into the hairline-separated, summary-bearing disclosure rows the artwork inspector uses.
- `cn()` uses `clsx` and `tailwind-merge`; compose variants there rather than concatenating ad hoc class strings.

## Color

Use a restrained white, black, graphite, and petrol system.

- White (`--background`) is the workspace and panel ground.
- Near-black (`--foreground`) is primary text and structural drawing.
- Thin neutral borders (`--border`, `--input`) separate panes and controls.
- Petrol (`--primary`) is reserved for active modes, focus rings, snap guides, and high-commitment toggles — the chrome/interaction token.
- Solid petrol controls always use `--primary-foreground` (white/light text). Never place black, foreground, or inherited dark text on a petrol fill; this applies to default, hover, active, and disabled states.
- Petrol soft (`--primary-soft`) is the selected-row and pressed-toggle wash.
- Canvas selection strokes (plan objects, rooms, resize handles, marquee, elevation openings/artwork) use `--selection`, a lighter petrol lifted for contrast against ink walls at canvas stroke weights, rather than `--primary`.
- Caution amber and destructive red are semantic only: approximate data, invalid state, placement warnings, and failures.

Avoid decorative color. The UI should not become teal-themed; petrol is an interaction signal, not wallpaper.

## Shape And Elevation

Sightlines mixes square workspace structure with softer floating surfaces: rectangular where the app is a drafting instrument, rounded where it floats above the work.

- Major panes and layout divisions stay square and separated by 1px borders.
- Inputs, buttons, selects, and compact toolbar controls use an 8px radius.
- Borderless selected fills, rail buttons, and menu rows may use a 10px radius.
- Soft-control grammar (this branch's speculative reroll):
  - **Navigation** — the topbar Plan/Elevation/3D tabs — uses transparent
    underline tabs whose 2px petrol underline *slides* between tabs (220ms
    `--ease-soft`, suppressed under reduced motion): the original petrol
    identity plus the sliding motion.
  - **Value pickers** — checklist filters, units, arrange modes,
    wall/floor placement — are recessed grey tracks (`--track`,
    `--radius-track`) holding quiet segments, with one raised white chip
    (`--chip`, `--shadow-chip`) marking the active choice and sliding
    between segments. Tracks are only for sets where something is always
    chosen — a control that is usually empty (like tool arming) must not
    be a track. Auxiliary controls may dock inside a track behind a
    hairline divider (the checklist's sort trigger is the reference case)
    rather than floating beside it.
  - **Latching toggles and armed tools** (Grid, Snap, Overlap, rail
    modes, the Insert door/window/zone tools) do the opposite: they
    depress, keeping the petrol wash and adding `--shadow-pressed`
    (a deepened inset with a faint full-perimeter inner ring, so the
    depression survives a grayscale read). Raised = a choice within a
    set; pressed = a mode that's engaged. Armed tools — the Insert
    segments (door, window, blocked zone), the Draw segments (rectangle
    room, room outline, partition), and either cluster's compact trigger
    while a tool is armed — additionally carry `--ring-armed`, a 1px
    translucent-petrol inner ring: a mode that changes what the next
    canvas click does reads one step stronger than a resting display
    toggle.
  - **Sub-choice tabs** ("Measured from", the help dialog's view groups)
    use the same sliding underline at smaller sizing, riding their row's
    hairline. **Controls floating over the canvas** (the zoom cluster,
    the inspector toggle) are borderless raised chips: white ground +
    `--shadow-chip`. A floating chip that is also a latching toggle (the
    inspector toggle is the reference case) depresses like any other
    engaged mode — petrol-soft wash + `--shadow-pressed` — and pops back
    to the raised chip when off; the raised/pressed flip is what
    distinguishes its two states. The inspector toggle is the panel's
    *only* affordance: it hugs the seam (sliding to the workspace corner
    when collapsed), the rail governs the left pane exclusively, and the
    inspector pane itself carries no collapse chrome.
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
- Canvas toolbar has two zones: creation tools on the left, view options on the right (grid, snap, precision, overlap, units). The left zone holds up to two captioned clusters that split along one line — **Insert decorates existing geometry, Draw creates new structure** (refining commit `7cb0fef`'s outcome-based grouping, which a two-tool draw family was too thin to justify). **Draw leads**: creating structure precedes decorating it, and the plan workflow starts by drawing a room. Each cluster renders as one **joined soft group** — a single `--surface` fill holding the quiet caption docked as a leading cell behind a hairline (the checklist sort trigger's dock-inside move) plus a flush icon segment per tool, split by interior hairlines — so the word and its three tools read as one object, not a floating label beside three floating buttons. Still not a recessed track: tool arming is usually empty, and states carve segments out of the shared fill — an armed segment keeps the shared chip radius so it presses in as the same rounded petrol chip as every other pressed toolbar control, the hairlines beside it yielding; segment focus rings draw inset so the group's clipping never strands an outline fragment. The plan-only **Draw** cluster (rectangle room → room outline → partition) is never disabled. The **Insert** cluster (door, window, blocked zone) has identical membership in Plan and Elevation, each segment pressing in when armed, disabled only when Elevation has no selected wall — where Insert stands alone at the zone's start. A hairline divider separates the two clusters so each caption reads as labeling its own three tools, not the neighbors, and every toolbar control carries a compact styled tooltip. The whole row shares **one 30px control lane** (the touch container query lifts everything to 40px together), and docked labels follow one voice: a label that names a control (the cluster captions, "Precision") sits one size below the 13px semibold button labels — 12px medium in muted ink — so caption vs action survives a squint on size + weight, not weight alone. It never wraps or gains a second row: a measuring hook picks one of five density tiers from the rendered controls' actual widths (`comfortable → trimmed → condensed → compact → tight`, `toolbarDensity.ts`). Comfortable keeps every label. Trimmed — the tier a 1440px laptop with both panes open actually lives in — drops Grid, Snap, and Eyeline to icon-only while keeping the Overlap and Precision labels (the weakest icons) and the Units words. Condensed drops all descriptive labels; compact swaps both clusters for caret menus; tight collapses those to icon-only triggers and removes the flexible inter-zone spacer. Precision keeps its current value at every tier, and Units stays a compact two-segment control with the active system filled in petrol. Plan labels the governing scale as `ft / m`; Elevation labels its detail scale as `in / cm`.
- Left pane is task inventory.
- Right pane is inspection and numeric editing.

Keep panels flat. Improve polish through spacing, alignment, focus states, and component consistency rather than by adding cards.

## Inspector System

Inspectors use state-aware density rather than giving every field equal weight. Stable identity and metadata compact after completion; active spatial controls remain easy to reach; incomplete records expand enough to explain what is missing and why it matters.

- A selected artwork keeps a persistent tombstone near the top with thumbnail, title, artist/date, dimensions, and an edit affordance. The tombstone remains visible while details are edited so context is never replaced by a generic form.
- Artwork dimensions stay near the top because they govern rendered scale. Width and height remain a paired row with enough room for common fractional-inch values; depth may occupy the next row rather than forcing three narrow columns.
- Missing width or height is derived automatically as a missing-scale state. Once both dimensions exist, users may qualify them as approximate with a checkbox; unchecked complete dimensions are treated as known. Do not expose this as a three-option status menu.
- Scale language distinguishes input quality from spatial consequence: users enter **approximate dimensions**, which produce **estimated scale**; complete known dimensions produce **true scale**. Missing and estimated states may use compact semantic icons with accessible shadcn tooltips. The healthy true-scale state should not consume scarce section-header space.
- Proportion locking changes field behavior, so it uses a pressed toggle. In dense layouts it may be icon-only with an accessible name and a brief tooltip. Approximate remains a labeled checkbox because it qualifies the data rather than enabling behavior.
- Conversion previews are transient help. Show them only while relevant, do not reserve blank message rows, and do not let one field's preview push its paired input out of alignment.
- Collapsed section headers prioritize recognizable values, especially dimension summaries. Status decoration must yield before the summary truncates.
- Derived measurements read as summaries rather than editable fields. Use a familiar edit icon with an accessible label to reveal an inline editor; avoid ambiguous actions such as “Set…” or “Done” when edits already save on blur.
- Inspector layout follows the pane's actual width through intrinsic sizing and container-responsive reflow. All controls, focus rings, labels, and long values must remain reachable at the 260px minimum, with no horizontal scrolling or clipped content.
- Inspector microcopy is brief and literal. Prefer short sentences in tooltips and notices; avoid em dashes when a period or separate phrase is clearer.

## Component Rules

Use the primitive variants first. Add bespoke CSS only when the component is canvas-specific or has a domain-specific layout.

- Use icon buttons for compact tools and include accessible labels.
- Use sliding-underline tabs (`UnderlineTabsList` in `ui/segmented.tsx`) for navigation (view modes); soft segmented tracks (`SegmentedTabsList` / `SegmentedToggleGroup`) for value pickers like the checklist filters; static underline tabs only for subordinate sub-choices.
- Use Radix Select for option sets.
- Use Radix Checkbox for persistent boolean data attributes; use Toggle for pressed behaviors or modes.
- Use the shared shadcn-style Tooltip for icon-only controls and contextual explanations. Never rely on a native `title` as the only explanation.
- Use Radix Switch only when the binary state benefits from a switch; the unit selector is intentionally a two-label segmented switch.
- Use petrol-filled primary buttons sparingly. `Import` is currently the main solid CTA in the workspace.
- Every interactive control needs hover, pressed/active, disabled, and focus-visible states.
- Toolbar verbs carry single-key shortcuts in the 2D views (never 3D, where WASD travels): D door, W window, B blocked zone, P partition, R rectangle room and ⇧R room outline (Plan), G grid, S snap, O overlap, E eyeline (Elevation) — `useToolbarShortcuts.ts`, suppressed while typing or while a dialog is open. Every toolbar tooltip echoes its key as a dimmed suffix ("Insert a door — D"); an armed tool's tooltip teaches its gesture and exit instead ("Drag to draw a room — Esc cancels").
- Toolbar controls that disable use `aria-disabled`, staying focusable with clicks inert, and the reason rides the same styled toolbar tooltip on hover and focus — never a native `title`. Either cluster's compact trigger shows the armed tool's own glyph and name ("Rectangle room") so armed identity survives the narrow tiers.
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

1. `UncertaintyIndicator`, warning panels, and status copy into semantic alert/badge primitives.
2. Checklist and wall rows into shared selectable-row styles.
3. Canvas chips and toolbar groups into reusable overlay/toolbar primitives.
4. Responsive pane behavior and mobile toolbar density.
