---
name: Sightlines
description: A private-by-design exhibition planning tool for room layouts, wall elevations, and artwork placement.
colors:
  bg: "oklch(1 0 0)"
  surface: "oklch(0.975 0.004 240)"
  surface-strong: "oklch(0.935 0.006 240)"
  ink: "oklch(0.16 0.004 240)"
  muted: "oklch(0.42 0.006 240)"
  subtle: "oklch(0.55 0.008 240)"
  line: "oklch(0.87 0.007 240)"
  primary: "oklch(0.42 0.07 200)"
  primary-strong: "oklch(0.3 0.065 200)"
  primary-soft: "oklch(0.93 0.025 200)"
  accent: "oklch(0.32 0.1 15)"
  danger: "oklch(0.53 0.18 28)"
  caution: "oklch(0.5 0.13 75)"
  caution-soft: "oklch(0.94 0.045 75)"
  danger-soft: "oklch(0.94 0.052 28)"
  danger-line: "oklch(0.82 0.08 28)"
  caution-line: "oklch(0.8 0.09 75)"
  grid-minor: "oklch(0.78 0.008 240 / 0.42)"
  grid-major: "oklch(0.62 0.01 240 / 0.5)"
  grid-dot: "oklch(0.72 0.008 240 / 0.55)"
  focus: "oklch(0.5 0.12 200)"
typography:
  title:
    fontFamily: '"Montserrat Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: "1.08rem"
    fontWeight: 720
    lineHeight: 1.3
  headline:
    fontFamily: '"Montserrat Variable", ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.95rem"
    fontWeight: 760
    lineHeight: 1.3
  body:
    fontFamily: '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, sans-serif'
    fontSize: "0.86rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, sans-serif'
    fontSize: "0.78rem"
    fontWeight: 680
    lineHeight: 1.4
rounded:
  sm: "3px"
  md: "3px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
components:
  button-icon:
    backgroundColor: "{colors.bg}"
    rounded: "{rounded.sm}"
    width: "36px"
    height: "36px"
  button-icon-hover:
    backgroundColor: "{colors.surface}"
  tab-button-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  badge-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "999px"
  brand-mark:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg}"
    rounded: "{rounded.md}"
    width: "38px"
    height: "38px"
---

# Design System: Sightlines

## 1. Overview

**Creative North Star: "The Curator's Desk"**

Sightlines is a calm exhibition-planning surface for rooms, walls, measurements, and artwork placement. It should feel like a museum workroom tool: exact, legible, composed, and durable. The interface is not decorative, but it is not generic. It earns elegance through proportion, alignment, typography, and restraint.

The visual language is built from line, measure, spacing, and quiet contrast. The canvas is white. The plan is drawn in black, graphite, and petrol. Panels are fixed work surfaces, not floating cards. Controls feel drawn and fitted into the grid, not inflated.

Sightlines should not look like a CAD program, a SketchUp clone, a startup dashboard, or a collections-management database. It should borrow seriousness from drafting tools, clarity from productivity software, and restraint from museum print materials.

**Key Characteristics:**
- White canvas, near-black linework, graphite secondary text
- Petrol used sparingly for active tools, selected geometry, focus, and measurement guides
- Rectangular before rounded
- Line-based before filled
- Fixed panels rather than card stacks
- Semantic color only for uncertainty and error
- Shadow reserved for true overlays

## 2. Colors

The palette is restrained: white, cool greys, near-black ink, one petrol interaction hue, and a separate caution/danger pair for data confidence.

### Primary Interaction

**Petrol** (`oklch(0.42 0.07 200)`) is the only routine interaction hue.

Use petrol for:

- Active drawing tools
- Selected room, wall, artwork, or handle
- Focus rings
- Measurement guides
- Snap guides
- Active view indicators
- Confirmed successful states, when a status indicator is necessary

Petrol should usually appear as a line, rule, outline, or soft wash. A solid petrol fill is reserved for global toggles or high-commitment actions.

### Neutral

- **Ink** (`oklch(0.16 0.004 240)`): primary text and the strongest plan linework
- **Graphite** (`oklch(0.38 0.006 240)`): labels, secondary text, inspector metadata
- **Fog** (`oklch(0.56 0.008 240)`): captions, counts, quiet helper text
- **Hairline** (`oklch(0.87 0.007 240)`): borders, dividers, grid-adjacent UI lines
- **Line Strong** (`oklch(0.72 0.009 240)`): hover borders, inactive but visible strokes, door swings
- **Surface / Surface Quiet**: panel backgrounds and hover fills, used lightly above the white canvas

### Brand

The brand mark should be typographic or line-based, not a generic colored app tile. The current monogram-on-white direction is stronger than an oxblood square.

Use the brand color only if the mark itself needs warmth or distinction. Do not use brand color for product interactions, badges, selected states, or buttons.

### Semantic

**Caution Amber** marks approximate data or advisory warnings.

Examples:

- approximate artwork dimensions
- approximate placement
- advisory spacing warning
- uncertain checklist metadata

**Alarm Red** marks invalid, missing, or failed states.

Examples:

- invalid dimensions
- artwork cannot fit
- save failed
- unknown critical metadata

Approximate and invalid states must not be confused with selection. A selected approximate artwork should show both states: petrol for selection, amber for confidence.

### Named Rules
**The One Voice Rule.** Petrol is the primary color used for routine interaction anywhere in the app. If a new component needs to signal "active" or "selected," it reaches for `primary`/`primary-soft`, never a new hue.

**The Rationed Accent Rule.** Oxblood (`--accent`) is reserved for a future custom SVG logotype and currently appears nowhere in the product UI — the token remains defined, but unused. It is not a secondary button color, not a hover state, not a tag color, not a decoration. The moment a custom brand mark is designed, this rule will move oxblood into exactly one place: that mark. If it ever starts showing up elsewhere, it has stopped being identity and started being decoration.

**The Tinted Selection Rule.** Selection is a petrol-soft wash with no border — `.wall-row.active` and `.checklist-row.selected` carry only `background: var(--primary-soft)`, never a petrol border. (Older revisions of this rule paired the wash with a border; that border is gone — see the Square Architecture Rule's `--radius-fill` addendum below for why.) The system still allows exactly ONE solid petrol CTA per screen — currently "Add Artwork" in the checklist (solid --primary, white text). All other interactions use outlined or tinted buttons.

**The Square Architecture Rule.** Panels, containers, and all major layout divisions are square (radius 0), separated by 1px hairlines. Small controls that keep a border (buttons, inputs, tags) carry a subtle 3px radius (`--radius-sm`). Interactive **fills** — list-row selection/hover (`.wall-row`, `.checklist-row`), rail buttons, and the topbar's icon buttons — are a different case: they're borderless washes, not boxed controls, so they round further to `--radius-fill` (6px) instead. Rounding a fill reads as "this whole shape is one soft surface"; rounding a bordered control would look like a mistake. There are no 999px pills anywhere. Badge count is deliberately minimal: the uncertainty badge is the only remaining soft-fill badge (2px radius); placement status is plain text (petrol wall name / subtle "Unplaced"); save status is a dot + text.

**The Caution Ladder Rule.** Confidence in placement/dimension data has exactly two visual tiers: Caution Amber for "approximate" and Alarm Red for "unknown/invalid." Both are independent of Petrol — a selected-and-approximate object must never be visually confusable with a selected-and-normal one.

## 3. Typography

**Two-family system:** Montserrat Variable (display roles) and Inter Variable (body/UI). Both self-hosted via @fontsource-variable packages — no external font requests, per privacy positioning.

**Montserrat Variable** (`"Montserrat Variable", ui-sans-serif, system-ui, sans-serif`): the display voice. Used only for the SIGHTLINES wordmark, panel headings, mode tabs, and the rail monogram, at weights 600–700.

**Inter Variable** (`"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, sans-serif`): carries everything else — body, forms, labels, data. Genuinely supports fractional weights now that it ships as a live font file (previously no font file was loaded; the app silently fell back to system fonts).

### Hierarchy
- **Title** (Montserrat, 680, 1.02rem, line-height 1.3): the editable project name in the top bar — the single largest piece of text in the entire app.
- **Headline** (Montserrat, 600, 0.95rem, line-height 1.3): panel section headers (Rooms, Checklist, Data) and the inspector's subject heading (1.02rem — a notch above the others so the selected wall/artwork/opening outranks a plain section label).
- **Body** (Inter, 500–550, 0.78–0.88rem, line-height 1.5): field values (500), row/list titles — checklist title, wall-row name, project-picker title (550). Caps at conversational widths where it appears as prose; most of it is compact UI text, not paragraphs.
- **Label** (Inter, 450–600, 0.68–0.78rem, line-height 1.4): captions, tags, badges, field hints — almost always set in Graphite or Fog, never Ink. Meta/caption text sits at 450, field labels and badges at 600.

### Named Rules
**The Weight Ladder Rule.** A hierarchy pass replaced the old fractional-weight tuning (which had drifted to 650–700 almost everywhere, so nothing actually ranked against anything else) with a small, deliberate ladder used consistently across the app:
- **450** — quiet meta text (checklist artist/dimensions line).
- **500** — field values (input/select text, the thing the curator typed).
- **550** — row/list titles (checklist title, wall-row name, project-picker title, checklist tag, view-option controls) and inactive filter/tab labels.
- **600** — field labels, buttons (`.inspector-action`, `.topbar-button`, `.checklist-add`, `.project-picker-new`), Montserrat panel headings, active filter tabs, the uncertainty badge, `dt`/`dd` labels.
- **700** — the SIGHTLINES wordmark and rail monogram only (Montserrat) — the two elements that are allowed to outrank everything.

Montserrat stays on standard weights 600 (headings, tabs) and 700 (wordmark/monogram) only — never the old 650/760 in-between values. Every measurement value in the app (wall length, property-list values, checklist dimensions, the elevation chip's dims line, field inputs) also carries `font-variant-numeric: tabular-nums`, so numbers align column-for-column instead of jittering as digits change width.

## 4. Elevation

Flat by default. Borders (Hairline) do the separating work everywhere; shadow is reserved for the two elements that are genuinely floating above the page rather than sitting flush within it.

### Shadow Vocabulary
- **Tight** (`box-shadow: 0 1px 2px oklch(0 0 0 / 0.08)`): the floating dimension-label chip that overlays the plan/elevation canvas.
- **Panel** (`box-shadow: 0 8px 24px oklch(0 0 0 / 0.12)`): the project-picker dropdown, the one true overlay menu in the app.

### Named Rules
**The Floating-Only Shadow Rule.** If an element sits in the normal document flow — a sidebar panel, a warning banner, a card — it is flat, bounded by a 1px Hairline border, never a shadow. Shadow exclusively marks "this is floating above everything else," so its rare appearance stays meaningful.

## 5. Components

### Buttons
- **Shape:** 3px radius (`--radius-sm`) on small bordered controls; interactive fills (list rows, rail buttons, topbar icon buttons) use the rounder borderless `--radius-fill` (6px); panels and containers use radius 0 (see the Square Architecture Rule).
- **Topbar utility icons** (`.icon-button` — undo, redo, import, the project-picker chevron): borderless, transparent at rest, Cool Fog fill on hover, Graphite icon that shifts to Ink on hover. `.topbar-button` (Export) is the one exception: it keeps a Hairline border and white fill, since it's the single labeled/outlined action in the topbar rather than a bare utility icon. The checklist's remove-× keeps an explicit white-fill-plus-border look (it overlays row content and needs its own ground to stay legible), even though it shares the `.icon-button` base class.
- **Tab / view-option buttons:** transparent at rest, Graphite text; active state gets a Cool Fog fill with Ink text; a "pressed" toggle (e.g. Snap) gets the Tinted Selection treatment instead (Petrol-soft fill, no border, `--radius-sm` since it's a control, not a row).
- **Text buttons** (`project-picker-new`, `inspector-action`): outlined or tinted, never solid fills. Bordered, Cool Fog fill, Ink text, Cool Ash fill on hover.
- **CTA (Add Artwork in checklist):** solid petrol fill, white text — the one solid primary CTA per screen. Everything else outlined or tinted.

### Badges & Pills
- **Style:** fully rounded (999px), compact padding, small Label-weight text.
- **Status badges:** saving/saved both live in the Petrol family (Petrol-soft fill, Petrol-strong text) — "in progress" and "complete" are treated as the same family of good news; only `error` breaks into Alarm Red.
- **Uncertainty badges** (signature component): "approximate" renders in Caution Amber, "unknown" in Alarm Red, and a fully-known dimension renders no badge at all — absence of a badge is itself the "trust this number" signal. The identical amber/red logic reappears on the elevation canvas as the artwork-outline stroke style, so a placement reads the same confidence level whether you're looking at the checklist or the wall.

### Inputs / Fields
- **Style:** Hairline border, 3px radius, white fill, Ink text.
- **Hover:** border shifts from Hairline to Fog.
- **Focus:** 2px Petrol-family outline ring, 2px offset.
- **Format hints:** appear only while the field is focused (e.g., "Accepts 28', 336""). 
- **Invalid:** border shifts to Alarm Red; an inline Label-sized error line appears below in the same red — errors always show regardless of focus state.
- **Readonly:** Cool Fog fill, Graphite text.

### Navigation

**The Workspace Grammar.** The rail (left, 80px) selects which left panel is open: the Checklist, the Rooms & Walls inventory, or null (both hidden). The topbar (top, 80px) owns the central view mode: Plan or Elevation; 3D will be a future mode tab. The right panel (300px) is a pure inspector: warnings first (when present), then the selected subject (wall / artwork / opening), its editable fields, actions, and read-only properties. Selection state is mutually exclusive within each region — one wall, one artwork, one opening, or none.

**The 80px Module Rule.** One 80px module governs the shell geometry: the rail is 80px wide, the topbar 80px tall, and the brand cell (top-left corner) is 80×80 where the rail's right hairline and the topbar's bottom hairline visibly cross, forming an intersecting cross that anchors the frame. Rail buttons are 48px square (22px icons, 3px radius, centered). At ≤760px the module drops to 56px (rail), 40px buttons (18px icons), matching the responsive grid step-down across the whole interface.

**Monogram.** A bare petrol (--primary) Montserrat 700 "S" letterform, no tile, no background, no fill — an explicit placeholder for a future custom SVG logotype. Type-based and dense, not an icon shape or an app-icon tile. The moment a custom mark ships, this text will disappear and the SVG will center in the same 80×80 cell using the exact same baseline centering math.

- **Rail order:** Brand cell (S monogram) / Checklist toggle (ListChecksIcon) / Rooms & Walls toggle (BoundingBoxIcon) / Issues (WarningIcon with live count badge) / spacer / Data view (FileCodeIcon, dev slot) / Settings placeholder (SlidersHorizontalIcon, disabled) / Help placeholder (QuestionIcon, disabled). Buttons: 48px, borderless, muted text at rest, Cool Fog fill on hover, petrol-soft fill + petrol-strong text when active/pressed. Issues button disabled when no placement warnings exist; clicking it jumps selection to the first offending wall object.

- **Topbar.** Three-zone grid on white background with Hairline bottom border. Left zone: SIGHTLINES wordmark (Montserrat, uppercase, 0.12em tracking, 0.8rem) + hairline divider + project title (editable, 1.02rem, weight 680, max ~320px). Center zone: Plan / Elevation tabs only, styled as underline tabs (muted → ink on hover; active = ink + 2px petrol underline); Montserrat 600, 0.95rem. Plan uses `MapTrifoldIcon`; Elevation keeps `RulerIcon`. Right zone: dot+text save status + undo/redo group (two adjacent borderless icon buttons, 2px gap — no seam to collapse since neither carries a border) + hairline divider + borderless import button + labeled Export button (the one bordered/outlined action in the group, Cool Fog fill on hover, never solid).

- **Elevation wall switcher.** The floating canvas chip in the top-left corner of the elevation surface now owns wall navigation: two compact 24px chevron buttons (prev/next) flanking a borderless wall `<select>` grouped by room name (never just flat wall names). Chevrons wrap the select, both borderless with hover-fog treatment. The select itself is borderless like the Units control (Montserrat 700, 0.95rem, ink text). Chip background white, 1px hairline border, box-shadow tight, positioned absolutely at 14px from both edges. Wall hopping in elevation no longer requires leaving the Checklist panel — the two workflows are now independent.

- **Left panels:** Checklist (when open) or Rooms & Walls (when open) — never both, always one or neither (toggled via rail). Both are 320px wide (collapsing at ≤1200px), white background, hairline toward canvas, scrollable flex columns. The rail preference persisted as `leftPanel: "checklist" | "rooms" | null` (workspace preference, not project data). Grid template responds: `grid-template-columns: 320px minmax(0, 1fr) 300px;` when left panel open, or `grid-template-columns: minmax(0, 1fr) 300px;` when collapsed.

- **Right panel (Inspector).** Always 300px wide (collapsing at ≤1200px), white background, hairline toward canvas, scrollable flex column. Heading names the selected subject (wall name / artwork title / opening kind) with a small kind label. Layout order: placement warnings (when present, in a Caution-soft panel) → subject heading → editable fields (commit on blur/Enter or via dedicated action buttons) → action buttons ("Add door", "Remove from wall", etc.) → read-only properties (wall/object info). Storage note pinned to bottom with `margin-top: auto`. No Rooms list here — rooms are now in the left Rooms & Walls panel with Width/Depth fields and wall rows.

### Canvas
- **Background:** pure white throughout. Backgrounds are white, not Cool Fog — --surface is demoted to hover fills and readonly inputs only.
- **No inner border:** canvas floats flush within its viewport.
- **Stroke hierarchy:** all strokes use screen-px via non-scaling strokes (SVG `vector-effect: non-scaling-stroke`). Walls are the heaviest: 5px ink normally, 7px petrol when selected. Elevation floor line 3px ink. Wall boundaries, artwork/opening outlines 1.5px (2.5px selected). Centerline and snap guides are thin dashed petrol 1.5px — reference lines never outweigh geometry.
- **Grid:** defaults ON as a workspace preference (persisted in local preferences, not project data). The minor grid renders as small dots at grid intersections (--grid-dot) with quiet 1px major lines. Visible grid reflects the active minor interval; major landmarks use the major interval from the precision table.

### Panels & Containers
- **Corner style:** 8px radius.
- **Background:** Cool Fog for informative/quiet panels (storage note, next-step panel); white for the drawing/data surfaces themselves.
- **Border:** always Hairline, 1px — never a shadow (see Elevation).
- **Warning panels** use the Caution pair (Caution-soft fill, Caution text/icon, a slightly stronger amber border) to separate "here's something to double-check" from both ordinary panels and genuine errors.

### Checklist
- **Filter tabs:** All / Placed / Unplaced. Ink text at rest; active tab gets a 2px petrol underline and Ink text.
- **Thumbnails:** 48px square slots, white fill, hairline border, radius 0. Object-fit: contain so uncropped image shows true proportions (portrait vs landscape reads at a glance).
- **Rows:** two-line layout (48px thumbnail on left), title line with placement status (wall name as plain text when placed, subtle "Unplaced" tag otherwise), meta line with artist · dimensions and uncertainty badge where applicable.
- **Remove button:** in-flow, hidden at rest, reveals on hover/focus/selection. Always visible on coarse pointers (touch).
- **Bottom:** full-width solid petrol CTA "Add Artwork" button (the one solid primary CTA per screen, white text).
- **Empty state:** dashed-border dropzone with hint copy.

### Brand Mark (signature)
Bare petrol "S" monogram (Montserrat 700, no background, no decoration) — a placeholder for a future custom SVG logotype. Type-based and text-dense, echoing measurement tools and drafting conventions. The moment a custom mark is designed, this letterform will disappear and the SVG will use the exact same centered positioning in the 80×80 rail brand cell. Optionally paired with "Sightlines" textmark in marketing contexts, never in the product itself.

## 6. Do's and Don'ts

### Do:
- Use petrol as the single routine interaction color.
- Use line, underline, rule, outline, and wash before filled color.
- Keep panels flat and architectural with square corners (radius 0).
- Use 3px radius for small interactive controls only (buttons, inputs, tags).
- Reserve badges for semantic data confidence or errors (uncertainty badge is the one remaining soft-fill badge).
- Make dimensions and numeric values feel precise through alignment and tabular numerals.
- Let the canvas carry the visual identity.
- **Do** use one solid petrol CTA per screen (Add Artwork); everything else outlined or tinted.
- **Do** hold Inter to the weight ladder (450 meta / 500 values / 550 row titles / 600 labels+buttons) so weight actually ranks content instead of clustering at one value.

### Don’t:
- Don’t scatter solid fills — exactly one solid primary CTA per screen.
- Don’t turn ordinary metadata into pills.
- Don’t make every selected state a rounded capsule.
- Don’t use oxblood as a product interaction color.
- Don’t add shadows to panels in the normal layout.
- Don’t use filled petrol buttons for routine actions.
- Don’t overdecorate with cards, gradients, oversized radius, or soft SaaS affordances.
- Don’t let warning/error color collide with selection color.
- **Don’t** reuse Caution Amber or Alarm Red for anything other than data-confidence and error states respectively — they are semantic, not decorative, colors.
