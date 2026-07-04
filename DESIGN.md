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
  focus: "oklch(0.5 0.12 200)"
typography:
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.08rem"
    fontWeight: 720
    lineHeight: 1.3
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.95rem"
    fontWeight: 760
    lineHeight: 1.3
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.86rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.78rem"
    fontWeight: 680
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "8px"
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

Sightlines should feel like a clean exhibition drafting table: a white working surface where wall plans, object checklists, measurements, and placement decisions can sit together without visual noise. The interface is minimalist but not generic, precise but not cold, elegant without becoming decorative. Black linework, crisp typography, measured spacing, subtle grids, and restrained color make the workspace feel trustworthy, calm, and professional — a serious studio instrument, not a CAD program, not a SketchUp clone, not a generic SaaS dashboard, and not a collections-management database.

Color is functional before it is expressive. The surface is white; text is black and grey; a single petrol blue-green carries every routine interactive state (selection, focus, in-progress); a deep oxblood appears exactly once, on the brand mark, as the one deliberate flourish the system allows itself. A separate amber-caution color exists purely to make uncertain data visible without making it feel like an error — a distinct concern from both the interactive color and the alarm-red used for genuine invalid states.

**Key Characteristics:**
- Pure white canvas; near-black ink text; barely-tinted cool greys for panel separation
- One interactive hue (petrol) governs selection, focus, and active state everywhere
- Oxblood is rationed to a single component: the brand mark
- Selection is always a border + soft tint, never a solid filled button
- Uncertainty has its own amber-caution language, independent of both petrol and danger-red
- Flat by default; shadow appears only on the two genuinely floating elements in the whole app

## 2. Colors

Restrained by design: white bg, black/grey ink, one petrol accent for interaction, one oxblood accent for identity, plus the semantic caution/danger pair.

### Primary
- **Petrol** (oklch(0.42 0.07 200) / #04585c): the app's only interactive color. Selection borders, active tabs, pressed states, resize handles, snap guides, and the "in progress / saved" status badges all draw from this single hue at varying weight (`primary`, `primary-strong`, `primary-soft`).

### Secondary
- **Oxblood** (oklch(0.32 0.1 15) / #5b1622): the brand mark only. Nowhere else in the system. Its rarity is what makes it read as identity rather than decoration.

### Neutral
- **Ink** (oklch(0.16 0.004 240) / #0c0e0f): primary text, near-black with an almost imperceptible cool undertone.
- **Graphite** (oklch(0.42 0.006 240) / #4a4e50): secondary text — labels, section headers, field hints.
- **Fog** (oklch(0.55 0.008 240) / #6e7276): tertiary/meta text — timestamps, counts, de-emphasized captions.
- **Hairline** (oklch(0.87 0.007 240) / #d0d5d8): all borders and dividers.
- **Cool Fog / Cool Ash** (oklch(0.975 0.004 240) and oklch(0.935 0.006 240)): the two panel-background steps (sidebar/inspector fills, hover states) above the pure-white canvas.

### Semantic
- **Alarm Red** (oklch(0.53 0.18 28) / #be3029): invalid dimensions, save errors, "unknown" placement data. Reserved for genuine failure states.
- **Caution Amber** (oklch(0.5 0.13 75) / #8d5500, on oklch(0.94 0.045 75) / #fde8cb): "approximate" dimensions and placements, and advisory warnings. One tier below Alarm Red on the confidence ladder, and visually unrelated to Petrol so a user never confuses "this is selected" with "this is a guess."

### Named Rules
**The One Voice Rule.** Petrol is the only color used for routine interaction anywhere in the app. If a new component needs to signal "active" or "selected," it reaches for `primary`/`primary-soft`, never a new hue.

**The Rationed Accent Rule.** Oxblood appears in exactly one place: the brand mark. It is not a secondary button color, not a hover state, not a tag color. The moment it starts showing up twice, it has stopped being identity and started being decoration.

**The Tinted Selection Rule.** No component in this system uses a solid filled background for its default or selected state. Selection is always `border-color: var(--primary)` plus `background: var(--primary-soft)` — a border and a wash, never a block of color.

**The Caution Ladder Rule.** Confidence in placement/dimension data has exactly two visual tiers: Caution Amber for "approximate" and Alarm Red for "unknown/invalid." Both are independent of Petrol — a selected-and-approximate object must never be visually confusable with a selected-and-normal one.

## 3. Typography

**Body/UI Font:** Inter (with ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif fallback)

**Character:** One family, no display face. A product-register tool where the type disappears into the task — the only variation is weight and size, tuned in small increments rather than jumping between a few loud steps.

### Hierarchy
- **Title** (720, 1.08rem, line-height 1.3): the editable project name in the top bar — the single largest piece of text in the entire app.
- **Headline** (760, 0.95rem, line-height 1.3): panel section headers (Rooms, Checklist, Data).
- **Body** (400–680, 0.82–0.9rem, line-height 1.5): field values, checklist titles, property lists, general content. Caps at conversational widths where it appears as prose; most of it is compact UI text, not paragraphs.
- **Label** (650–760, 0.68–0.78rem, line-height 1.4): captions, tags, badges, field hints — almost always set in Graphite or Fog, never Ink.

### Named Rules
**The Fractional Weight Rule.** Weights are tuned per element along Inter's variable axis — 650, 680, 700, 720, 750, 760 — rather than snapped to the standard 400/500/600/700 steps. At this density, a 30-unit difference is the only signal separating "section header" from "field label," so the increments are deliberate, not arbitrary.

## 4. Elevation

Flat by default. Borders (Hairline) do the separating work everywhere; shadow is reserved for the two elements that are genuinely floating above the page rather than sitting flush within it.

### Shadow Vocabulary
- **Tight** (`box-shadow: 0 1px 2px oklch(0 0 0 / 0.08)`): the floating dimension-label chip that overlays the plan/elevation canvas.
- **Panel** (`box-shadow: 0 8px 24px oklch(0 0 0 / 0.12)`): the project-picker dropdown, the one true overlay menu in the app.

### Named Rules
**The Floating-Only Shadow Rule.** If an element sits in the normal document flow — a sidebar panel, a warning banner, a card — it is flat, bounded by a 1px Hairline border, never a shadow. Shadow exclusively marks "this is floating above everything else," so its rare appearance stays meaningful.

## 5. Components

### Buttons
- **Shape:** 6px radius (`radius-sm`) on nearly everything; 8px (`radius-md`) on containers and the brand mark.
- **Icon buttons:** 36px (32px compact) square, Hairline border, white fill at rest, Cool Fog fill on hover. No color until interaction.
- **Tab / view-option buttons:** transparent at rest, Graphite text; active state gets a Hairline border and Cool Fog fill with Ink text; a "pressed" toggle (e.g. Snap) gets the Tinted Selection treatment instead (Petrol border + Petrol-soft fill).
- **Text buttons** (`project-picker-new`, `inspector-action`): bordered, Cool Fog fill, Ink text, Cool Ash fill on hover.
- There is no solid-fill primary button anywhere in the system — see the Tinted Selection Rule.

### Badges & Pills
- **Style:** fully rounded (999px), compact padding, small Label-weight text.
- **Status badges:** saving/saved both live in the Petrol family (Petrol-soft fill, Petrol-strong text) — "in progress" and "complete" are treated as the same family of good news; only `error` breaks into Alarm Red.
- **Uncertainty badges** (signature component): "approximate" renders in Caution Amber, "unknown" in Alarm Red, and a fully-known dimension renders no badge at all — absence of a badge is itself the "trust this number" signal. The identical amber/red logic reappears on the elevation canvas as the artwork-outline stroke style, so a placement reads the same confidence level whether you're looking at the checklist or the wall.

### Inputs / Fields
- **Style:** Hairline border, 6px radius, white fill, Ink text.
- **Hover:** border shifts from Hairline to Fog.
- **Focus:** 2px Petrol-family outline ring, 2px offset.
- **Invalid:** border shifts to Alarm Red; an inline Label-sized error line appears below in the same red.
- **Readonly:** Cool Fog fill, Graphite text.

### Navigation
- **Top bar:** white background, Hairline bottom border, brand mark (Oxblood square) anchoring the left edge next to the editable project Title.
- **View tabs** (Plan / Elevation / Data): the tab-button treatment above; the active tab is the only wayfinding needed, no underline or additional accent.

### Panels & Containers
- **Corner style:** 8px radius.
- **Background:** Cool Fog for informative/quiet panels (storage note, next-step panel); white for the drawing/data surfaces themselves.
- **Border:** always Hairline, 1px — never a shadow (see Elevation).
- **Warning panels** use the Caution pair (Caution-soft fill, Caution text/icon, a slightly stronger amber border) to separate "here's something to double-check" from both ordinary panels and genuine errors.

### Brand Mark (signature)
38px rounded-square, Oxblood fill, white glyph. The one place in the entire interface where the rationed secondary color appears — see the Rationed Accent Rule.

## 6. Do's and Don'ts

### Do:
- **Do** keep Petrol as the only color used for selection, focus, and active state — one hue, three weights (`primary`, `primary-strong`, `primary-soft`).
- **Do** express selection as a border + soft-tint background, never a solid fill.
- **Do** keep the caution/danger pair independent of the interactive color family, so confidence-in-data and interaction-state never collide visually.
- **Do** default every panel to flat + Hairline border; reserve shadow for the dropdown menu and the floating dimension label only.
- **Do** tune type weight in small increments (650/680/700/720/750/760) rather than jumping between a few standard steps.

### Don't:
- **Don't** introduce a second decorative accent color. Oxblood is rationed to the brand mark; if a new component wants "warmth" or "identity," it doesn't get a new hue — it gets restraint.
- **Don't** fill a button with a solid brand color. This system has no filled-primary-button anywhere, by design.
- **Don't** let this look like a CAD program, a SketchUp clone, a generic SaaS dashboard, or a collections-management database — no decorative complexity, no marketing-page flourish, no dark-mode theatrics, no visual metaphor that makes the workspace feel less trustworthy than the measurements it displays.
- **Don't** reuse Caution Amber or Alarm Red for anything other than data-confidence and error states respectively — they are semantic, not decorative, colors.
- **Don't** add shadow to a panel that lives in normal document flow (sidebars, cards, banners). If it's not floating above the page, it's flat.
