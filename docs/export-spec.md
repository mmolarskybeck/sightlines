# PDF and Image Export — Behavior Spec

Status: Draft for review · Written: 2026-07-14

Decisions reviewed with Marina 2026-07-14: image export (PNG/JPG) captures
exactly one view per file and is a lightweight "snapshot" action — in 3D it
saves the current render directly and never touches the saved-capture list;
PDF export composes a multi-page document from selectable sections;
floorplans that exceed one page get a fit-to-page overview plus optional
per-room detail pages; elevations are chosen from a per-room wall list that
defaults to walls holding work; 3D pages come from viewpoints the user
deliberately captures in the 3D view, not from auto-generated orbit angles,
and are auto-named from what the camera is looking at; **automatic dimension
lines are included by default** on plan and elevation pages behind a single
off-switch; the grid is excludable/includable with default off; paper sizes
include A4, Letter, A3, and Tabloid 11×17. Remaining open items are in §16.

## 1. Goal

Let a curator turn a Sightlines project into something they can print, email,
drop into a deck, or hand to an installer — without a server, without an
account, and without an options screen that reads like a print driver.

The elegance strategy is **two doors, not one giant door**:

1. **Snapshot** — "give me this view as an image, now." One click, one file,
   near-zero options. Serves the deck slide, the group chat, the quick
   side-by-side.
2. **Document** — "assemble the pages that describe this exhibition." A
   composed PDF with an overview plan, room details, wall elevations, and 3D
   views, chosen from a short, legible contents list. Serves the walkthrough
   packet, the installer handoff, the studio visit printout.

Splitting the two keeps each simple. A snapshot never asks which walls to
include; a document never asks about image formats. Users get control over
*what is included* (the document's contents) without control being smeared
across every export as a wall of checkboxes.

## 2. Product model

### 2.1 Export versus backup

`.sightlines` packages (Settings → **Export backup**) are the project's own
data — lossless, re-importable, machine-readable. This feature is different:
it produces **presentation artifacts** — flattened, human-readable, not
re-importable. The two must never share a button, a dialog, or a name.
Vocabulary in §4 enforces the split.

### 2.2 Snapshot (PNG/JPG)

Meaning: **Save what I'm looking at as an image.**

- Captures the active view — Plan, Elevation, or 3D — as one raster file.
- Framing follows the current viewport: the user composes by panning and
  zooming, exactly as they would compose a screenshot, but the output is
  clean (§10) and rendered at export resolution rather than screen pixels.
- No content selection. Choosing what's in frame *is* the interface.
  Static display state carries through as currently shown: the grid
  exports if it is visible on the canvas, and the selection's automatic
  dimension lines export exactly as displayed — the selection *outline and
  handles* are stripped as gesture chrome, but its dimension lines are kept
  because they are informational drawing. This makes "select a grouping,
  export image" the fast path to an annotated spacing image.
- In 3D, Export image saves the current render **directly and
  immediately**. It is fully independent of the saved-capture list (§8):
  grabbing a quick 3D image never creates a capture, never dirties the
  project, and never requires visiting the Export dialog.
- PNG is the default. JPG is offered for 3D captures where photographic
  content makes JPG's smaller files worthwhile; line drawings (Plan and
  Elevation) export as PNG only, because JPG artifacts visibly degrade
  hairline geometry for no meaningful size win.

### 2.3 Document (PDF)

Meaning: **Assemble a printable description of this exhibition.**

- One PDF, composed of sections the user includes or excludes:
  - **Overview** — the whole floorplan, fit to one page.
  - **Room plans** — one cropped, fit-to-page plan per included room.
  - **Elevations** — one page per included wall.
  - **3D views** — one page per saved capture (§8).
- Contents choices are per-section and per-room/per-wall, not per-property.
  There is no font picker, no margin control, no color theme.
- The document is paginated for reading, not measuring. True-scale output
  (1:50 at correct paper size, tiled across sheets) is a distinct future
  export mode already named in `docs/plan.md` §9 and is out of scope here —
  see §3.3.

### 2.4 What "clean" means

Both doors draw from the same pure scene derivations the canvas uses
(`buildPlanScene`, `buildElevationScene`, the 3D scene graph), so an export
can never disagree with what the app displays. But exports render the
**static drawing only**: no selection chrome, no hover states, no snap
guides, no drag ghosts, no toolbar cursors, no advisory glyphs that exist to
prompt in-app action. §10 defines the exact inclusion table.

## 3. Scope

### 3.1 Slice 1 — Snapshot

- **Export image** action available in Plan, Elevation, and 3D views.
- Current-viewport framing; clean rendering per §10; export-resolution
  rasterization (§10.4).
- PNG for Plan/Elevation; PNG or JPG for 3D.
- Sensible default filename (§11); standard save/share path per platform.
- No dialog beyond the minimal format choice in 3D; no persistence, schema,
  or package changes.

### 3.2 Slice 2 — Document

- **Export PDF** action opening the Export dialog (§6).
- Overview page, per-room plan pages, per-wall elevation pages, 3D capture
  pages, each optional.
- Per-room and per-wall inclusion (§7); defaults per §7.3.
- Saved 3D captures: create in the 3D view, review and remove in the Export
  dialog (§8). Captures persist with the project and round-trip through
  `.sightlines` packages.
- Page headers, labels, and scale notes per §9.
- Client-side PDF assembly (pdf-lib or equivalent — engineering's choice).

### 3.3 Non-goals

- No true-scale / print-ratio output and no multi-sheet tiling of one
  drawing. That is the separate "scale-accurate printed export" roadmap item
  and demands its own spec (calibration, paper handling, tick marks).
- No PDF checklist / works-list section in these slices. The roadmap's
  checklist PDF is a sibling feature; the Document's section model (§6) must
  leave room for it, but its content is not designed here.
- No batch image export ("every wall as a PNG zip"). The Document covers the
  many-pages need; revisit only on demonstrated demand.
- No annotation, comment, or markup layer on exports.
- No server rendering, no cloud storage, no share links. Files land on the
  user's device; sharing stays file-based, per the app's privacy posture.
- No inclusion of reference measurements yet. The Measure tool now being
  implemented (`docs/measurement-tool-spec.md`) is expected to feed exports
  eventually — a curator's kept references belong on the printed page — but
  that spec (§15 there) explicitly defers annotation-export behavior. When
  it lands, a reference-measurements switch joins §6.1's Options group
  beside Dimensions and Grid; the content model here leaves that seat open.
- No custom page templates, branding, fonts, or cover-page editors.

## 4. Vocabulary and copy

| Concept | User-facing term | Avoid |
|---|---|---|
| Raster export of the current view | Export image | Screenshot, snapshot (internal name only), capture |
| Composed multi-page PDF | Export PDF | Print, report, packet, deck |
| `.sightlines` package | Backup | Export (unqualified), save file |
| Saved 3D viewpoint | 3D view (verb: **Save view for export**) | Camera, bookmark, perspective |
| The whole-plan PDF page | Overview | Site plan, master plan |
| Per-room cropped plan page | Room plan | Detail, zoom, crop |

"Export" alone is now ambiguous in the app; every surface must say **Export
image**, **Export PDF**, or **Export backup**. The Settings dialog's existing
**Export backup** label already conforms.

## 5. Entry points

- A single **Export** affordance in the workspace chrome opens a small menu:
  **Export image** (with the current view named, e.g. "Export image of
  elevation") and **Export PDF…**. The ellipsis signals that only the PDF
  path opens a dialog.
- In the 3D view, **Save view for export** lives alongside Export image; it
  is the capture action for §8 and gives immediate feedback (§8.2) rather
  than opening the Export dialog.
- Export actions are disabled with an explanatory tooltip when the project
  has no rooms; an empty project has nothing to draw.
- No keyboard shortcut ships in these slices. Export is not a repetitive
  in-flow action, and single-key real estate is scarce; revisit on demand.

## 6. The Export dialog (Document)

One dialog, one job: choose contents, then export. It follows the app's
existing overlay conventions (rounded 12px overlay, shadcn/ui primitives).

### 6.1 Structure

- **Contents** — a vertical list of the four sections, each with a
  checkbox and, where applicable, an expandable sub-list:
  - **Overview** — checkbox only.
  - **Room plans** — checkbox plus a per-room checklist (room names).
  - **Elevations** — checkbox plus a per-room, per-wall tree (§7).
  - **3D views** — checkbox plus the saved-capture list with thumbnails
    and per-capture remove (§8.4).
- **Options** — exactly two switches, applying to all plan and elevation
  pages in the document:
  - **Dimensions** — default **on**. Includes the app's automatic dimension
    lines (§9.6). Most exports exist to answer "how big, how far apart" —
    the default assumes that; the switch exists for the clean
    presentation-deck case.
  - **Grid** — default **off**. Print noise for most documents, but
    genuinely useful for installers who lay out by module; one switch, not
    a spacing editor.
- **Page setup** — one control: paper size (**A4** / **Letter** / **A3** /
  **Tabloid 11×17**), defaulting from locale to A4 or Letter, remembered
  per project. The two large sizes serve printed working documents for
  installation; US Legal is deliberately omitted (wrong aspect for
  drawings) unless demand appears. Orientation is chosen automatically per
  page (§9.1); margins, DPI, and quality are fixed editorial decisions, not
  options.
- **Footer** — a live page count ("Exports 9 pages"), **Cancel**, and the
  primary action **Export PDF**.

The dialog must read comfortably at its default size with a 4-room project
and degrade gracefully (scrolling sub-lists) at 10 rooms / 40 walls.

### 6.2 Behavior

- Section checkboxes use the standard tri-state convention when a sub-list
  is partially selected.
- Unchecking a section preserves its sub-selection for the session, so
  toggling a section off and on is non-destructive.
- Contents choices persist per project. The next export starts from the last
  configuration, because the second export of a packet is almost always a
  revision of the first.
- **Export PDF** shows determinate progress if assembly exceeds the app's
  standard immediate-feedback threshold, and the dialog remains cancelable
  until the file is delivered.
- If every section is unchecked, the primary action is disabled with inline
  text: **Choose at least one section.**

## 7. Choosing rooms and walls

### 7.1 The tree

Elevations are listed as a two-level tree: room → walls, using the app's
existing room names and wall labels so the export dialog and the canvas
speak identically. Partition faces that can hold work appear under their
room with their existing labels.

### 7.2 Room plans and elevations select independently

Including a room's plan page does not force its elevations, and vice versa.
An installer packet might be all elevations and no room plans; a landlord
conversation might be the opposite. The tree's room rows act as
select/deselect-all conveniences for their walls, nothing more.

### 7.3 Defaults

- **Overview:** included.
- **Room plans:** included for all rooms when the project has more than one
  room; excluded (redundant with the Overview) for single-room projects.
- **Elevations:** included for every wall **that currently holds at least
  one placed work**; empty walls are listed but unchecked. This is the
  strongest default lever against overwhelming output: a 10-room show
  exports the walls that matter, and adding an empty wall back is one click.
- **3D views:** included when at least one saved capture exists; the section
  is present but visibly empty otherwise, with the hint **Save views from
  the 3D window to include them here.**

Defaults apply on first export; thereafter §6.2's persistence wins. Walls
that gain or lose work after the user has customized the selection do not
silently join or leave it — the user's explicit choice is never overridden.

## 8. 3D views

### 8.1 Why user-captured, not auto-generated

Auto-generated viewpoints (room corners, orbit angles) require the app to
guess what matters — which sightline, which grouping, which doorway reveal.
Those guesses would be wrong often enough to erode trust in the whole
document. Composing a 3D view is curatorial judgment, and the 3D navigation
work (cursor-directed dolly, WASD, double-click focus) already makes
composing one cheap. The export feature's job is to keep what the curator
composed.

### 8.2 Save view for export

From the 3D view, **Save view for export**:

1. Records the current camera pose (position, target, lens parameters) in
   model space — never pixels — plus a rendered thumbnail.
2. Derives an auto-name from what the camera is looking at (§8.3).
3. Confirms with lightweight feedback naming the result (**Saved "Gallery 2
   — toward north wall"**) without leaving the 3D view or opening a dialog.
4. Appends to the project's capture list. Captures are project data: they
   dirty the project, participate in undo, and round-trip through
   `.sightlines` packages (thumbnail excluded from the package;
   re-renderable from the pose).

Captures are re-rendered from the stored pose at export time, at export
resolution — the stored thumbnail is dialog UI only. A capture therefore
always reflects the *current* state of the exhibition, not the moment of
capture. This is deliberate: the document describes the show as it is now.

### 8.3 Auto-naming from camera context

A capture's name is derived, not typed. The naming rule uses geometry the
app already owns:

- **Room:** the room whose floor polygon contains the camera position (or,
  when the camera is outside every room, the room containing the camera
  target). Contributes the room's existing name.
- **Facing:** the wall that dominates the view — the wall face with the
  largest visible presence in the camera frustum, using the walls' existing
  labels. Contributes "toward *wall label*".

Result: **Gallery 2 — toward north wall**. When no wall clearly dominates
(a corner view, a long axial sightline through openings), the name degrades
gracefully to just the room (**Gallery 2**), and when even the room is
ambiguous, to **3D view *n***. The name must never guess confidently: a
wrong "toward north wall" on a printed page is worse than a plain fallback.
The dominance threshold and frustum test are an engineering decision (§16);
the behavioral bar is that the auto-name is either right or absent, and it
matches the room and wall labels used everywhere else in the app.

The auto-name is stored at capture time (renaming rooms/walls later does
not silently rewrite existing capture names) and the page title uses it
verbatim. A user-editable name field is deferred until demand appears —
auto-names should carry most packets.

### 8.4 Managing captures

The Export dialog's 3D section lists captures in capture order with
thumbnail, auto-name, and remove. Renaming and reordering are deferred
until demand appears; removal is undoable through the standard project undo
path. If geometry changes have
made a stored pose degenerate (e.g., its room was deleted), the capture
row carries an advisory state and is excluded from export rather than
rendering a void — consistent with the app's "flag, don't silently fix"
rule.

## 9. Page composition

### 9.1 Shared rules

- Every page carries a small, consistent header: project name, page title,
  and export date. Nothing else — no logos, no watermark.
- Orientation is chosen per page to maximize drawing area for that page's
  aspect ratio (a long wall's elevation goes landscape; a tall room plan
  goes portrait). Users never choose orientation.
- Drawings are centered in the content area with fixed margins, scaled
  uniformly — never stretched, never cropped except as §9.3 defines.
- Text on pages uses the project's unit and precision settings via the
  existing formatters.

### 9.2 Overview page

The complete floorplan — all rooms, partitions, openings, placed objects —
fit to one page. Because fit-to-page scale is arbitrary, the page carries a
**scale bar** (a drawn bar labeled with a round model length, e.g. "2 m"),
not a ratio claim. A ratio like "1:63" invites tape-measure use that this
document explicitly does not support; a scale bar communicates size honestly
at any reproduction size, even after the PDF is printed "shrink to fit."

### 9.3 Room plan pages

One page per included room: that room's polygon and contents fit to page,
cropped to the room's bounds plus a fixed model-space margin so doorways and
immediately adjacent geometry remain legible at the edges. Neighboring
rooms' interiors are omitted rather than drawn faintly — a partial neighbor
invites misreading, and the Overview page already provides context. Each
page is titled with the room name and carries its own scale bar. Room plan
pages exist precisely to answer §1's pagination problem: the Overview shows
everything small; room plans show each space large. No drawing is ever
tiled across sheets in this mode.

### 9.4 Elevation pages

One page per included wall, titled with room and wall label (matching the
canvas's elevation heading). The drawing is the same static elevation the
canvas paints: wall boundary, floorline, openings, placed works at framed
footprint. Each page carries a scale bar and the wall's overall width and
height. Dimension lines follow §9.6.

### 9.5 3D pages

One page per capture, the render fit to page, titled with the capture name.
Rendered with the canvas's standard lighting and materials — no export-only
stylization.

### 9.6 Dimensions on document pages

The canvas's dimension lines are selection-driven: they annotate what the
user is currently arranging. A document has no selection, and its reader's
question is broader — "how far apart is everything?" So document pages get
a **full dimension pass**: the same segment derivation and visual family as
`GroupDimensionLines` (end ticks, formatted labels, staggered rows, the
"0" touching readout), applied to everything rather than to a selection.
Export must reuse the existing spacing-segment math, not reimplement it.

With **Dimensions** on (the default):

- **Elevation pages:** one dimension row per wall covering every placed
  object in wall order — outer segment from each wall end to the nearest
  object, and every interior gap between adjacent objects (openings
  included as neighbors, exactly as the neighbor-aware canvas segments
  already treat them). The wall's overall width and height render as
  dimension lines along the wall boundary rather than only as header text.
- **Room plan pages:** each wall's overall length, drawn outside the room
  polygon along its wall. Object-to-object plan spacing is *not* drawn —
  on a floorplan it produces a web of crossing lines that buries the
  drawing; wall-to-wall and elevation spacing carry the working numbers.
- **Overview page:** no dimension lines regardless of the switch. At
  whole-plan scale the labels cannot stay legible, and the room plan and
  elevation pages own the numbers. The Overview keeps only its scale bar.

With **Dimensions** off, pages keep the scale bar and the header text only.
Labels use the project's units and precision via the existing formatters,
at fixed print sizes independent of drawing scale (the same
constant-screen-size principle the canvas dimension row uses).

## 10. Rendering fidelity

### 10.1 One derivation

Plan and elevation pages must be drawn from `buildPlanScene` /
`buildElevationScene` output — the same pure derivations the interactive
views consume. Export code must not re-derive geometry from the project, so
the canvas and the export cannot disagree. 3D pages render the same scene
graph as the 3D view at the stored pose.

### 10.2 Inclusion table

| Canvas element | In exports |
|---|---|
| Rooms, walls, partitions, openings | Yes |
| Placed works at framed footprint (per `docs/framing-dimension-contract.md`) | Yes |
| Floor objects | Yes |
| Dimension lines | Document: full pass per §9.6, **Dimensions** switch default on. Snapshot: as currently displayed (selection-driven) |
| Per-work text labels (titles) | No in v1 — a labeled-elevation/checklist-key page is a design gate (§16) |
| Opening connection advisory glyphs | No — they prompt in-app action |
| Selection outline, hover, snap guides, drag ghosts, handles | No |
| Grid | Document: **Grid** switch, default off. Snapshot: as currently visible on canvas |
| Temporary measurement | No |
| Reference measurements | No — deferred by the measurement spec until annotation-export behavior is specified |

### 10.3 Image tiers

Exports draw artwork images from the **display tier**, consistent with
`docs/plan.md` §4.5. Full-resolution originals are not touched by these
slices; an "archival quality" export using originals is a possible later
option, not a default.

### 10.4 Resolution

Raster output (snapshots, and rasterized drawings inside the PDF if
engineering chooses raster embedding over vector) renders at a fixed
export scale factor chosen for crisp print at the fit-to-page sizes in §9
— an editorial constant, not a user option. Whether PDF drawings embed as
vectors or high-resolution rasters is an engineering decision (§16); the
behavioral requirement is that hairline geometry stays crisp when the PDF
is zoomed to 400%.

## 11. Files and naming

- Snapshot: `<project> — <view>.png` (e.g. `Summer Rotation — North wall
  elevation.png`), with the platform's standard collision handling.
- Document: `<project>.pdf`.
- PDF document metadata sets title (project name) and creator
  ("Sightlines"). No metadata beyond that — no author name, no location —
  consistent with the app's privacy posture.
- Delivery uses the platform-appropriate path already established for
  `.sightlines` backups: File System Access API where available, download /
  share sheet elsewhere (iOS has no FS Access API).

## 12. Errors and edge cases

- **Empty project:** entry points disabled (§5).
- **Room with no works:** its room plan page still exports if included —
  an empty room is honest information in a planning document.
- **Wall with no works, explicitly included:** exports as an empty
  elevation; never silently skipped once chosen.
- **All captures degenerate:** the 3D section behaves as empty (§8.4).
- **Very large export (10 rooms, 40 walls, many captures):** progress and
  cancel per §6.2; cancellation delivers nothing rather than a partial file.
- **Assembly failure:** one plain-language error (**Couldn't create the
  PDF. Your project is unchanged.**) — never a corrupt file, never a
  half-written download.
- **Extreme aspect ratios (a 40 m corridor wall):** fit-to-page holds;
  the drawing gets small, the scale bar and dimensions stay legible at
  fixed sizes. This is the accepted cost of refusing tiling in this mode.

## 13. Accessibility

- The Export dialog is fully keyboard-operable: tree traversal, checkbox
  toggling, capture removal, and the primary action, following the app's
  existing dialog focus conventions.
- Capture thumbnails carry accessible names (their capture names); state
  (included, advisory) is never conveyed by color alone.
- Progress and completion are announced to assistive technology; the
  completion announcement names the file delivered.
- Exported PDFs set the document title and language. Full tagged-PDF
  structure is out of scope for v1 but the assembly library choice should
  not preclude it.

## 14. Acceptance criteria

### 14.1 Slice 1 — Snapshot

- Export image is available in Plan, Elevation, and 3D, and disabled with
  explanation on an empty project.
- Output framing matches the current viewport; output contains only §10.2
  "Yes" rows — verified against a canvas with active selection, hover, and
  an armed tool, none of which appear.
- Plan/Elevation deliver PNG; 3D offers PNG and JPG.
- In 3D, Export image delivers the current render immediately, creates no
  capture, and does not dirty the project.
- A selection's dimension lines appear in the snapshot while its outline
  and handles do not; canvas grid visibility carries through.
- Output resolution exceeds screen resolution per §10.4; hairlines are
  crisp.
- Filenames follow §11; delivery works on desktop and iPad paths.
- Exporting never mutates the project.

### 14.2 Slice 2 — Document

- The Export dialog presents exactly the §6.1 structure; a 10-room / 40-wall
  project remains navigable.
- Defaults follow §7.3 on first export; user selections persist per project
  and are never silently overridden by later placement changes.
- Tri-state section checkboxes; sub-selection survives section toggling.
- Save view for export records pose in model space, confirms without a
  dialog, dirties the project, participates in undo, and round-trips through
  `.sightlines`.
- Auto-names match the app's room and wall labels, degrade to room-only and
  then to **3D view *n*** rather than guessing, and are stored at capture
  time.
- With Dimensions on (default): elevation pages carry the full per-wall
  dimension row (outer segments + every interior gap, openings as
  neighbors) plus overall wall width/height; room plan pages carry wall
  lengths; the Overview carries neither. Values match the canvas's
  selection-driven readings for identical geometry, because the segment
  derivation is shared.
- With Dimensions off, and with Grid on/off, pages render accordingly; the
  switches persist per project.
- All four paper sizes lay out correctly with auto-orientation.
- Captures re-render current project state at export time; degenerate
  captures carry an advisory and are excluded.
- The PDF contains exactly the chosen pages in §6.1 order; every page has
  header, title, and (for drawings) scale bar; orientation is auto-chosen
  per page; nothing is stretched or tiled.
- Plan/elevation pages are pixel-comparable to the canvas's static drawing
  for identical geometry (same scene derivation).
- Page count in the footer matches the delivered PDF.
- Cancel delivers nothing; failure delivers the §12 error and no file.

## 15. Verification plan

### Domain tests

- Page-list derivation: contents selection → ordered page manifest (pure
  function; the assembly step consumes the manifest).
- Fit-to-page math: scale, centering, auto-orientation, and room-crop bounds
  for representative and extreme aspect ratios.
- Scale-bar length selection produces round model lengths across scales and
  both unit systems.
- Defaults derivation (§7.3) against projects with 1 room, empty walls, and
  mixed placement.
- Capture schema: validation, migration, package round-trip, degenerate-pose
  detection.
- Auto-name derivation: camera inside a room, outside all rooms, corner
  views and axial sightlines degrading per §8.3, and label agreement with
  room/wall naming.
- Full dimension pass: segment coverage for walls with 0, 1, and many
  objects, openings as neighbors, touching works ("0" readout), and value
  agreement with the selection-driven canvas segments for identical
  geometry.

### Component and store tests

- Dialog tree selection, tri-state, persistence, and disabled states.
- Save view for export: undo entry, dirty flag, feedback.
- Snapshot action produces a clean render (no chrome) with selection active.
- Progress, cancel, and failure paths deliver per §12.

### Browser and device verification

- Print the PDF from Preview/Acrobat at "actual size" and "fit": headers,
  scale bars, and hairlines legible in both.
- Snapshot and PDF export on iPad via share sheet.
- A 10-room stress project: dialog usability, export time, file size, and
  400% zoom crispness.
- Visual diff: canvas static drawing versus exported plan/elevation page
  for the same project.

### UX validation

Task-based, with curators and one installer if possible:

1. "Send a colleague an image of this wall." (Do they find Export image or
   screenshot the app?)
2. "Make a printout an installer could work from for rooms 2 and 3."
   (Do the defaults land close? Do they understand the wall tree?)
3. "Include two 3D views that show the sightline from the entrance."
   (Does Save view for export read as the path into the PDF?)
4. Observe whether anyone attempts to measure from the printed page — if
   so, the scale-accurate export mode's priority rises and the scale bar's
   honesty framing needs review.

## 16. Decision gates before implementation

### Resolved product decisions (reviewed 2026-07-14)

1. Two doors: snapshot (current view, no dialog) versus document (composed
   PDF). No batch image export. Quick 3D image = Export image, direct,
   independent of the capture list.
2. Pagination by composition — Overview + room plan pages — with no tiling
   and no ratio claims; scale bars instead.
3. Elevation defaults: walls with works checked, empty walls listed
   unchecked.
4. 3D pages only from user-saved captures; captures are project data,
   re-rendered at export time, auto-named from camera room/facing context.
5. Dimension lines on by default with a single off-switch; full per-wall
   pass on elevation pages, wall lengths on room plans, none on the
   Overview.
6. Grid excludable/includable in documents, default off; snapshots follow
   canvas grid visibility.
7. Paper sizes: A4, Letter, A3, Tabloid 11×17. Orientation, margins,
   resolution, and quality are fixed.
8. Neighboring-room interiors omitted from room plan pages (no faint
   context rendering).
9. Reference measurements join the Options group in a later slice, after
   the Measure tool's annotation-export behavior is specified.

### Design questions

- Per-work text labels: does a labeled elevation (numbered works keyed to a
  small list, or titles under each work) ship as part of the future
  checklist-PDF work or as an elevation-page option? Decide against real
  output; excluded from v1 (§10.2).
- Snapshot in 3D: is the format choice (PNG/JPG) a small inline choice at
  export time or a remembered preference? (Smallest possible surface wins.)
- Does the plan-page wall-length dimensioning read clearly on non-rectilinear
  rooms, or does it need per-shape placement rules before shipping?

### Engineering questions

- Vector versus high-resolution raster embedding for plan/elevation pages
  in the PDF (pdf-lib path drawing vs. canvas rasterization). Behavioral
  bar: §10.4's 400% crispness and reasonable file size.
- Camera-context inference for auto-names (§8.3): the point-in-polygon room
  test is cheap; the "dominant wall" frustum test needs a definition and a
  conservative threshold. Behavioral bar: right or absent, never a
  confident wrong name.
- Extracting the spacing-segment derivation used by `GroupDimensionLines`
  into a caller-agnostic form the export pass can feed with "all objects on
  the wall" instead of a selection — reuse, not reimplementation (§9.6).
- 3D offscreen rendering: render target sizing, `preserveDrawingBuffer`
  versus render-on-demand into an offscreen target, and memory behavior on
  iPad for multiple captures.
- Where the shared "static scene → drawing commands" layer lives so SVG
  canvas, PNG rasterizer, and PDF writer consume one painter rather than
  three (the scene2d builders were built for exactly this seam).
- Font strategy for PDF text (embedded subset vs. standard fonts) given
  project names may contain arbitrary Unicode.
- Capture schema shape (pose + stored auto-name) and its `.sightlines`
  migration.

## 17. Ethical review

The feature produces artifacts the user explicitly composes and triggers; it
introduces no deceptive, coercive, or attention-extractive pattern. The
principal trust risks are honesty risks: an export that differs from the
canvas (§10.1 forbids second derivations), a page that invites tape-measure
use it cannot support (§9.2 uses scale bars and refuses ratio claims), and a
stale 3D capture presented as current (§8.2 re-renders at export time).
Privacy posture is preserved: everything renders client-side, files go only
where the user puts them, and PDF metadata carries nothing personal.
