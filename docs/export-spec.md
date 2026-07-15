# PDF and Image Export — Behavior Spec

Status: Draft for review · Written: 2026-07-14

Decisions reviewed with Marina 2026-07-14 (three rounds, incorporating
Sol's review): image export (PNG/JPG) captures exactly one view per file and
is a lightweight "snapshot" action — in 3D it captures the current camera
pose and performs a clean export-resolution render, independent of the
Saved-views list; PDF export composes a multi-page document from selectable
sections; floorplans that exceed one page get a fit-to-page overview plus
optional per-room detail pages; elevations are chosen from a per-room wall
list that defaults to walls holding work; 3D pages come from **Saved views**
— first-class camera bookmarks with editable titles and a live-resolved room
label, destined for a left-pane collection; **automatic dimension lines are
included by default** behind a single off-switch, using horizontal and
vertical gaps between directly visible neighboring wall objects, exposed outer
horizontal margins, and consolidated center heights for every arrangement from a row
to a salon hang; the grid is excludable/includable with default off; PDF
drawing output is vector with embedded raster artwork images; document
settings are workspace preferences keyed by project id, not project data;
paper sizes are A4, Letter, A3, and Tabloid 11×17. Remaining open items are
in §16.

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
- In 3D, Export image **captures the current camera pose and performs a
  clean render at export resolution** — it does not read back the live
  WebGL buffer, whose device-pixel ratio is capped for interactive
  performance and which carries selection tinting and ghosted walls. The
  user experiences it as immediate ("save what I'm looking at"); the
  implementation is a one-off offscreen render from the same pose. It is
  fully independent of Saved views (§8): grabbing a quick 3D image never
  creates a Saved view, never dirties the project, and never requires
  visiting the Export dialog.
- PNG is the default. JPG is offered for 3D snapshots where photographic
  content makes JPG's smaller files worthwhile; line drawings (Plan and
  Elevation) export as PNG only, because JPG artifacts visibly degrade
  hairline geometry for no meaningful size win.

### 2.3 Document (PDF)

Meaning: **Assemble a printable description of this exhibition.**

- One PDF, composed of sections the user includes or excludes:
  - **Overview** — the whole floorplan, fit to one page.
  - **Room plans** — one cropped, fit-to-page plan per included room.
  - **Elevations** — one page per included wall.
  - **3D views** — one page per included Saved view (§8).
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
- Overview page, per-room plan pages, per-wall elevation pages, Saved-view
  3D pages, each optional.
- Per-room and per-wall inclusion (§7); defaults per §7.3.
- Saved views: create in the 3D view; include/exclude, retitle, and delete
  in the Export dialog (§8). Saved views persist with the project and
  round-trip through `.sightlines` packages; thumbnails are a derived cache
  outside the project.
- Document settings (contents selection, Options switches, paper size)
  stored as workspace preferences keyed by project id (§6.3).
- Page headers, labels, and scale notes per §9.
- Client-side PDF assembly (pdf-lib or equivalent — engineering's choice).

### 3.3 Non-goals

- No true-scale / print-ratio output and no multi-sheet tiling of one
  drawing. That is the separate "scale-accurate printed export" roadmap item
  and demands its own spec (calibration, paper handling, tick marks).
- No PDF checklist / works-list section in these slices. The roadmap's
  checklist PDF is a sibling feature; the Document's section model (§6) must
  leave room for it, but its content is not designed here. The division of
  labor is deliberate: **elevation pages explain where things go; the
  checklist explains what the things are** (thumbnails, full dimensions,
  metadata). Installers work primarily from reference images plus spatial
  dimensions, so per-work identification does not block this export; an
  optional per-work label/key joins the Options group only once the
  checklist establishes the shared labeling model (§16).
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
- No left-pane **Saved views collection** in these slices. It is the
  planned eventual home for browsing saved views by thumbnail, opening one
  at full resolution, renaming, downloading, and deleting — the Export
  dialog's management surface (§8.4) is deliberately minimal so it can
  shrink to inclusion-only once that collection exists. The data model in
  §8 is designed for that future, not just for PDF assembly.

## 4. Vocabulary and copy

| Concept | User-facing term | Avoid |
|---|---|---|
| Raster export of the current view | Export image | Screenshot, snapshot (internal name only), capture |
| Composed multi-page PDF | Export PDF | Print, report, packet, deck |
| `.sightlines` package | Backup | Export (unqualified), save file |
| Saved 3D viewpoint | Saved view (verb: **Save view**) | Camera, bookmark, capture, perspective, view for export |
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
- In the 3D view, **Save view** lives alongside Export image; it is the
  bookmark action for §8 and gives immediate feedback (§8.2) rather than
  opening the Export dialog.
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
  - **3D views** — checkbox plus the Saved views list: thumbnail,
    room label + title, and a **per-view include checkbox** (§8.4).
    Excluding a view from today's document must never require deleting
    project data.
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
- Contents choices persist per project (§6.3). The next export starts from
  the last configuration, because the second export of a packet is almost
  always a revision of the first.
- **Export PDF** shows determinate progress if assembly exceeds the app's
  standard immediate-feedback threshold, and the dialog remains cancelable
  until the file is delivered.
- Assembly consumes an **immutable snapshot of project state taken at the
  moment Export PDF is clicked**. Edits, undo, or redo that land while
  assembly runs affect the project, never the in-flight document — the
  delivered PDF always describes exactly one coherent state.
- If every section is unchecked, the primary action is disabled with inline
  text: **Choose at least one section.**

### 6.3 Persistence boundary

Two different kinds of state live near this dialog, with deliberately
different semantics:

- **Document settings** — contents selection, per-view include flags, the
  Dimensions and Grid switches, paper size — are **workspace preferences
  keyed by project id**. They never dirty the project, never enter undo
  history, and never travel through `.sightlines` backups. They describe
  how *this user on this machine* last assembled a document, not what the
  exhibition is. A collaborator opening the same package starts from §7.3's
  defaults.
- Persisted document settings reconcile against the current project by id:
  explicit choices are preserved for rooms, walls, and Saved views that
  still exist; deleted ids are dropped; genuinely new ids receive §7.3's
  normal defaults (new room plans included when appropriate, new walls with
  work included, new empty walls unchecked, new Saved views included). A
  pre-existing wall gaining or losing work keeps its explicit choice. When
  a project is deleted, its workspace-preference record is deleted too.
- **Saved views** (§8) are **project data**: they dirty, undo, and
  round-trip through backups, because a composed viewpoint is part of the
  exhibition's description.
- **Thumbnails** are a **derived cache outside the project** — never stored
  in project JSON, undo history, or packages; regenerated lazily after
  relevant project changes (§8.2).

## 7. Choosing rooms and walls

### 7.1 The tree

Elevations are listed as a two-level tree: room → walls, using the app's
existing room names and wall labels so the export dialog and the canvas
speak identically. Partition faces that can hold work appear under their
room with their existing labels. Rooms and walls list in the app's existing
room and wall order (the same order §9.1 uses for pages).

**Shared walls:** a shared (coincident twin) wall appears under each of its
rooms as that room's own face, exactly as the canvas models it, and each
face can be included independently. Doors and windows linked across the
pair render on **both** elevations — an opening in a shared wall belongs to
both rooms, and either room's packet must stand alone. Exporting both faces
of one physical wall is therefore intentional, not duplication.

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
- **3D views:** the section is included when at least one Saved view
  exists, and new Saved views default to included; the section is present
  but visibly empty otherwise, with the hint **Save views from the 3D
  window to include them here.**

Defaults apply on first export and to genuinely new ids thereafter; §6.3's
reconciliation preserves explicit choices for everything that already
exists. Walls that gain or lose work after the user has customized the
selection do not silently join or leave it — the user's explicit choice is
never overridden.

## 8. 3D views

### 8.1 Why user-captured, not auto-generated

Auto-generated viewpoints (room corners, orbit angles) require the app to
guess what matters — which sightline, which grouping, which doorway reveal.
Those guesses would be wrong often enough to erode trust in the whole
document. Composing a 3D view is curatorial judgment, and the 3D navigation
work (cursor-directed dolly, WASD, double-click focus) already makes
composing one cheap. The export feature's job is to keep what the curator
composed.

### 8.2 Save view

From the 3D view, **Save view**:

1. Records the current camera pose (position, target, lens parameters) in
   model space — never pixels.
2. Resolves and stores the **stable id of the room** containing the camera
   (or, when the camera is outside every room, the room containing the
   camera target), when one is identifiable. Optionally stores derived wall
   context (which wall face the camera predominantly faces) as
   supplementary data, never as part of the title.
3. Assigns the default editable title **Saved view *n***, where *n* is an
   immutable, monotonically increasing creation ordinal. Deleting a view
   never renumbers the survivors or causes a later view to reuse its number.
4. Confirms with lightweight feedback (**Saved "Gallery 2 · Saved view
   3"**) without leaving the 3D view or opening a dialog.
5. Appends to the project's Saved views list. Saved views are project data
   per §6.3: they dirty the project, participate in undo, and round-trip
   through `.sightlines` packages.

A Saved view is a **camera bookmark, not a picture**. Its thumbnail is a
derived cache outside the project, regenerated lazily after relevant
project changes, and every consumer — the dialog thumbnail, the PDF page,
the future collection's full-resolution open and download — renders the
*current* exhibition from the stored pose. The document describes the show
as it is now, never a stale moment of capture.

### 8.3 Room label and title

A Saved view displays as **room label · title**, e.g. **Gallery 2 ·
Entrance sightline**:

- The **room label** is resolved live from the stored room id at display
  and export time, so renaming a room can never strand a stale name on a
  printed page. It uses the room's current name exactly as it appears
  everywhere else in the app — no invented numbering. If the stored room id
  no longer resolves (room deleted), the label is simply omitted.
- The **title** is user-editable, defaulting to **Saved view *n***. The
  default is deliberately unambitious: inferring a descriptive name from
  the camera frustum ("toward north wall") adds guessing risk out of
  proportion to its value, and an editable title plus a live room label
  carries real packets. Frustum-derived naming may return as a *suggested*
  title later if demand appears (§16).

The PDF page title uses the same composed form.

### 8.4 Managing Saved views

The Export dialog's 3D section lists Saved views in creation order, each
row showing thumbnail, room label · title, and an **include checkbox**
(§6.1) — inclusion is a document setting; the view itself stays project
data either way. Rows also offer retitle and delete; deletion is undoable
through the standard project undo path. This management surface is
intentionally minimal: the left-pane Saved views collection (§3.3) is the
planned primary home for browsing, opening at full resolution, renaming,
downloading, and deleting, and when it lands the dialog keeps only
inclusion.

A stored pose is degenerate only when its camera data is numerically invalid:
non-finite position, target, or lens values; camera and target effectively
coincident; or invalid field-of-view/clipping parameters. Geometry edits and
room deletion do not themselves invalidate a pose — a valid bookmark always
renders the current project from its stored camera, even if the resulting
view is now sparse or empty. The thumbnail makes that result visible so the
user can exclude or delete it. A numerically invalid pose carries an
advisory and is excluded from export, consistent with the app's "flag, don't
silently fix" rule.

## 9. Page composition

### 9.1 Shared rules

- Every page carries a small, consistent header: project name, page title,
  and export date, plus a page number (**3 of 9**) so a printed packet
  survives being shuffled on a table. Nothing else — no logos, no watermark.
- Pages follow §6.1's section order; within a section, rooms follow the
  app's existing room order and walls follow each room's existing wall
  order, so the document and the canvas agree about sequence. 3D pages
  follow Saved-view creation order (§8.4). The page manifest is therefore
  fully deterministic for a given contents selection.
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

One page per included Saved view, the render fit to page, titled per §8.3.
Rendered with the canvas's standard lighting and materials — no export-only
stylization.

### 9.6 Dimensions on document pages

The canvas's dimension lines are selection-driven: they annotate what the
user is currently arranging. A document has no selection, and its reader's
question is broader — "where does everything go?" Document pages therefore
get their own dimension pass, sharing `GroupDimensionLines`' visual family
(end ticks, formatted labels, staggered rows, the "0" touching readout).

Every elevation uses one unified **orthogonal visibility-neighbor** rule;
there is no row/salon classification and no guessed lane grouping:

- Two wall objects are **horizontal neighbors** when their vertical spans
  overlap by more than the geometry tolerance and at least one unobstructed
  horizontal line can connect their facing edges. Their edge-to-edge
  horizontal gap is dimensioned.
- Two wall objects are **vertical neighbors** when their horizontal spans
  overlap by more than the tolerance and at least one unobstructed vertical
  line can connect their facing edges. Their edge-to-edge vertical gap is
  dimensioned.
- Another wall object blocks the relationship only when it blocks every
  possible connecting corridor through the shared span. When several clear
  corridors remain, the dimension uses the widest one. Sliver corridors at
  or below the tolerance do not create unstable neighbor relationships.
- Each unordered object pair receives at most one dimension per visible
  axis. Touching neighbors receive the existing **0** readout; actually
  overlapping objects receive no gap dimension because overlap is already
  an in-app advisory, not a negative distance to print.
- Works, doors, windows, and blocked zones all participate with their true
  rendered footprints: an opening between two works prevents those works
  from being direct neighbors and can itself be dimensioned to an adjacent
  work.
- The wall's left and right boundaries act as virtual horizontal neighbors
  for works exposed directly to them, preserving useful outer margins.
  Coincident exterior dimensions may consolidate when their meaning stays
  unambiguous. The floor and ceiling do not create additional edge-gap
  dimensions: center height supplies the vertical anchor, and a
  bottom-edge-to-floor alternative remains deferred.
- Dimension lines sit inside the widest clear corridor between the objects.
  When the gap is too narrow for its label, the ticks remain on the measured
  edges and the existing stagger/leader treatment moves the label into clear
  space.
- The wall's overall width and height render as dimension lines along its
  boundary. Per-work width/height labels inside artwork footprints are not
  part of v1; optional labels and the checklist PDF own that content.

A conventional single-row hang naturally collapses to the familiar
left-to-right gap chain. A salon hang gains vertical gaps between stacked
works and horizontal gaps between side-by-side works, but never jumps across
an intervening object.

In addition to neighbor gaps, the hang is annotated with **center height
from the floor**: one common centerline dimension when multiple works share
a center height (the app's own centerline model), and individual center
heights otherwise. This absolute vertical datum anchors the relative gap
network on the wall.

Center height is the default vertical datum because it is the app's
existing centerline model and the number installers' hang math starts
from; a bottom-edge-to-floor alternative is a possible later option, not a
v1 switch (§16).

For the other drawing pages:

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

The app has a single drawing style today, and exports render it as a
**fixed print appearance**. If canvas theming or appearance modes ever
arrive, export output does not follow them — the printed page keeps one
stable, light-background editorial style.

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

### 10.3 Images and missing images

Exports draw artwork images from the **display tier**, consistent with
`docs/plan.md` §4.5. Full-resolution originals are not touched by these
slices; an "archival quality" export using originals is a possible later
option, not a default. PDF cannot embed WebP, so display-tier images are
transcoded to JPEG or PNG at embed time — a per-image conversion, never a
reason to rasterize the surrounding page.

Sightlines deliberately supports image-less artwork, and a stored image
blob can also be missing or unreadable at export time. Either way, the
work renders as a **vector placeholder**: the correct framed footprint,
neutral fill and border, the text **Image unavailable** (omitted for
deliberately image-less works — nothing is "unavailable"), and the work's
best identifying metadata (title, accession number, then artist). When no
identifying metadata exists, placeholders receive deterministic page-local
labels in wall order (**Untitled work 1**, **Untitled work 2**, …) so two
anonymous works remain distinguishable. These labels are shown even though
per-work labels are otherwise off. A missing-blob export
completes with a non-blocking warning naming the affected works, matching
the backup flow's behavior; it never fails the export.

### 10.4 Vector output and resolution

PDF drawing pages are **vector**: wall outlines, frames, dimension lines,
labels, and scale bars are drawn as paths and text, with raster artwork
images positioned and clipped inside the vector frames — a standard hybrid
page. This is a decision, not an open question: a fixed-resolution raster
that survives 400% zoom across A3/Tabloid pages would be large and
memory-heavy, especially on iPad. Linework and text therefore stay crisp
at any zoom; artwork images may reveal pixels at extreme zoom, which is
expected and harmless since a work occupies only part of a page.

Snapshots (§2.2) remain raster by nature and render at a fixed export
scale factor chosen for crisp output well above screen resolution — an
editorial constant, not a user option.

## 11. Files and naming

- Snapshot: `<project> — <view>.png` (e.g. `Summer Rotation — North wall
  elevation.png`), with the platform's standard collision handling.
  `<view>` is **Plan** in the plan view, the canvas's elevation heading
  (room and wall label) in the elevation view, and **3D view** in the 3D
  view — a quick 3D image has no Saved-view identity to name.
- Document: `<project>.pdf`.
- Project names are user-entered Unicode; filename construction
  **sanitizes** them by replacing filesystem-reserved characters (`/ \ : *
  ? " < > |` and control characters) with a hyphen, collapsing repeats,
  trimming leading/trailing dots and spaces, and falling back to
  `Sightlines project` if nothing printable survives. Sanitization affects
  only filenames — the PDF title metadata and page headers carry the name
  verbatim.
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
- **All Saved views numerically invalid or excluded:** the 3D section behaves as
  empty (§8.4).
- **Very large export (10 rooms, 40 walls, many Saved views):** progress and
  cancel per §6.2; cancellation delivers nothing rather than a partial file.
- **Assembly failure:** one plain-language error (**Couldn't create the
  PDF. Your project is unchanged.**) — never a corrupt file, never a
  half-written download.
- **Extreme aspect ratios (a 40 m corridor wall):** fit-to-page holds;
  the drawing gets small, the scale bar and dimensions stay legible at
  fixed sizes. This is the accepted cost of refusing tiling in this mode.

## 13. Accessibility

- The Export dialog is fully keyboard-operable: tree traversal, checkbox
  toggling, Saved-view management, and the primary action, following the app's
  existing dialog focus conventions.
- Saved-view thumbnails carry accessible names (room label · title); state
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
- In 3D, Export image renders cleanly from the current pose at export
  resolution — no selection tinting, no ghosted walls, resolution above the
  live canvas's capped device-pixel ratio — creates no Saved view, and does
  not dirty the project.
- A selection's dimension lines appear in the snapshot while its outline
  and handles do not; canvas grid visibility carries through.
- Output resolution exceeds screen resolution per §10.4; hairlines are
  crisp.
- Filenames follow §11; delivery works on desktop and iPad paths.
- Exporting never mutates the project.

### 14.2 Slice 2 — Document

- The Export dialog presents exactly the §6.1 structure; a 10-room / 40-wall
  project remains navigable.
- Defaults follow §7.3 on first export and for genuinely new ids; persisted
  settings preserve explicit choices, drop deleted ids, apply §7.3's defaults
  to new rooms/walls/views, and are removed with the project.
- Tri-state section checkboxes; sub-selection survives section toggling.
- Save view records pose and room id in model space, confirms without a
  dialog, dirties the project, participates in undo, and round-trips
  through `.sightlines` — with thumbnails absent from project JSON, undo
  entries, and packages.
- Room labels resolve live: renaming a room updates every affected Saved
  view's displayed and exported label; deleting the room omits the label.
  Titles are editable; the default is **Saved view *n***.
- Per-view include checkboxes exclude a view from the document without
  touching project data; document settings live in workspace preferences
  keyed by project id and never dirty, undo, or travel through backups.
- With Dimensions on (default): every elevation carries horizontal and
  vertical gaps between orthogonally visible neighbors, exposed outer
  horizontal margins, consolidated center heights, and overall wall width/
  height.
  Intervening works/openings block farther relationships; each pair/axis is
  dimensioned once; touching gaps read **0**; overlaps never print as
  negative gaps. Room plan pages carry wall lengths; the Overview carries
  neither.
- With Dimensions off, and with Grid on/off, pages render accordingly.
- Works with missing or absent images render the §10.3 vector placeholder
  with identifying metadata or a deterministic **Untitled work n** fallback;
  a missing blob yields a non-blocking warning, never a failed export.
- Drawing pages are vector (text selectable, linework crisp at any zoom)
  with embedded raster artwork images.
- All four paper sizes lay out correctly with auto-orientation.
- Saved views re-render current project state at export time. Geometry edits
  never invalidate a pose; only numerically invalid camera data carries an
  advisory and is excluded.
- The PDF contains exactly the chosen pages in §6.1 section order, with
  rooms and walls in the app's existing order and Saved views in creation
  order; every page has header, title, page number (**n of N** matching the
  delivered total), and (for drawings) scale bar; orientation is auto-chosen
  per page; nothing is stretched or tiled.
- A shared wall's linked doors and windows appear on both twin faces'
  elevation pages; each face is independently includable in the tree.
- Edits or undo landing during assembly never alter the in-flight document;
  the delivered PDF matches the project state at the moment Export PDF was
  clicked.
- Filenames are sanitized per §11 for reserved characters while headers and
  PDF title metadata keep the project name verbatim.
- Plan/elevation pages are geometry-equivalent to the canvas's static
  drawing because they consume the same scene primitives. Rasterized visual
  comparisons at a defined DPI pass within a documented tolerance.
- Page count in the footer matches the delivered PDF.
- Cancel delivers nothing; failure delivers the §12 error and no file.

## 15. Verification plan

### Domain tests

- Page-list derivation: contents selection → ordered page manifest (pure
  function; the assembly step consumes the manifest), including §9.1
  ordering (section → app room order → app wall order → Saved-view
  creation order) and correct **n of N** numbering.
- Filename sanitization: reserved characters, control characters, dot/space
  trimming, repeat collapsing, and the all-unprintable fallback.
- Fit-to-page math: scale, centering, auto-orientation, and room-crop bounds
  for representative and extreme aspect ratios.
- Scale-bar length selection produces round model lengths across scales and
  both unit systems.
- Defaults and reconciliation (§6.3/§7.3): preserve explicit choices for
  existing ids, drop deleted ids, apply defaults to new rooms/walls/Saved
  views, retain choices when an existing wall gains or loses work, and
  delete preferences with the project.
- Saved-view schema: validation, migration, package round-trip (thumbnail
  absent), immutable monotonic creation ordinals, numeric pose validity,
  and room-id resolution (camera inside a room, outside all rooms, room
  since deleted but pose still renderable).
- Orthogonal neighbor graph: horizontal and vertical adjacency; complete
  obstruction versus a partially open corridor; widest-corridor choice;
  one dimension per pair/axis; tolerance-stable slivers; touching **0**;
  overlaps omitted; and farther pairs blocked by intervening objects.
- Mixed works/openings: true rendered footprints, openings acting as both
  blockers and dimension neighbors, and exposed left/right wall boundaries
  acting as virtual neighbors for exterior margins.
- Center-height consolidation for shared versus differing center heights,
  plus deterministic wall-order fallback labels for metadata-free missing-
  image placeholders.

### Component and store tests

- Dialog tree selection, tri-state, persistence, and disabled states.
- Save view: undo entry, dirty flag, feedback; retitle and delete paths.
- Snapshot action produces a clean render (no chrome) with selection active.
- Progress, cancel, and failure paths deliver per §12.

### Browser and device verification

- Print the PDF from Preview/Acrobat at "actual size" and "fit": headers,
  scale bars, and hairlines legible in both.
- Snapshot and PDF export on iPad via share sheet.
- A 10-room stress project: dialog usability, export time, file size, and
  400% zoom crispness.
- Toleranced visual diff at a defined DPI: canvas static drawing versus
  exported plan/elevation page for the same project.

### UX validation

Task-based, with curators and one installer if possible:

1. "Send a colleague an image of this wall." (Do they find Export image or
   screenshot the app?)
2. "Make a printout an installer could work from for rooms 2 and 3."
   (Do the defaults land close? Do they understand the wall tree?)
3. "Include two 3D views that show the sightline from the entrance."
   (Does Save view read as the path into the PDF?)
4. Observe whether anyone attempts to measure from the printed page — if
   so, the scale-accurate export mode's priority rises and the scale bar's
   honesty framing needs review.

## 16. Decision gates before implementation

### Resolved product decisions (reviewed 2026-07-14, three rounds)

1. Two doors: snapshot (current view, no dialog) versus document (composed
   PDF). No batch image export. Quick 3D image = Export image: capture
   pose, clean export-resolution render, independent of Saved views.
2. Pagination by composition — Overview + room plan pages — with no tiling
   and no ratio claims; scale bars instead.
3. Elevation defaults: walls with works checked, empty walls listed
   unchecked.
4. 3D pages only from **Saved views**: project data (pose + room id +
   editable title, default **Saved view n** with an immutable monotonic
   ordinal), re-rendered at export time, displayed as live-resolved room
   label · title; thumbnails are a derived
   cache outside the project; per-view include checkboxes separate
   inclusion from deletion; a left-pane Saved views collection is the
   planned future management home. No frustum-derived naming in v1.
5. Dimension lines on by default with a single off-switch. Every elevation
   dimensions **horizontal and vertical gaps between orthogonally visible
   neighbors**, exposed horizontal outer margins, overall wall size, and
   center height from the floor (shared centerlines consolidated).
   Intervening objects block farther relationships; touching reads **0**;
   overlaps never print
   as negative gaps. This one rule covers rows and salon hangs without lane
   classification. Room plans carry wall lengths; the Overview carries no
   dimension lines. Center height, not bottom-to-floor, is the v1 vertical
   datum.
6. Grid excludable/includable in documents, default off; snapshots follow
   canvas grid visibility.
7. Paper sizes: A4, Letter, A3, Tabloid 11×17. Orientation, margins,
   resolution, and quality are fixed.
8. Neighboring-room interiors omitted from room plan pages (no faint
   context rendering).
9. Reference measurements join the Options group in a later slice, after
   the Measure tool's annotation-export behavior is specified.
10. Document settings are workspace preferences keyed by project id;
    Saved views are project data. Preferences preserve surviving explicit
    choices, drop deleted ids, apply defaults to new ids, and are removed
    when their project is deleted (§6.3).
11. PDF drawing pages are vector with embedded raster artwork images;
    missing/absent images render the §10.3 placeholder with identifying
    metadata plus a non-blocking warning.
12. Per-work labels/keys are deferred to the checklist-PDF labeling model;
    elevations explain where, the checklist explains what.
13. Reviewed 2026-07-14 (fourth round): pages carry **n of N** numbers;
    page/tree ordering follows the app's existing room and wall order
    (Saved views by creation order); assembly consumes an immutable
    project snapshot taken at Export click; filenames are sanitized while
    headers/metadata keep the verbatim name; exports keep one fixed print
    style regardless of any future canvas theming; a shared wall's linked
    doors and windows render on both twin elevations.

### Design questions

- Snapshot in 3D: is the format choice (PNG/JPG) a small inline choice at
  export time or a remembered preference? (Smallest possible surface wins.)
- Does the plan-page wall-length dimensioning read clearly on non-rectilinear
  rooms, or does it need per-shape placement rules before shipping?
- Bottom-edge-to-floor as an additional vertical datum option: revisit
  after installer feedback on center-height-only pages.
- Frustum-derived title *suggestions* ("toward north wall"): revisit only
  if default titles prove insufficient in real packets.

### Engineering questions

- Orthogonal-neighbor tolerance and widest-corridor selection: stable under
  sub-millimeter nudges, deterministic when a blocker leaves several clear
  intervals, and never emits negative gaps or duplicate pair/axis readings.
- Dense-wall dimension layout: corridor placement, leader lines, staggering,
  consolidation of coincident exterior margins, and label-collision rules —
  design against real salon-wall output before freezing.
- A pure, caller-agnostic elevation-dimension derivation that consumes the
  same rendered footprints as `buildElevationScene`; reuse
  `GroupDimensionLines`' formatting and visual language without forcing its
  one-dimensional selection-segment model onto the two-axis neighbor graph.
- 3D offscreen rendering: render target sizing, render-on-demand into an
  offscreen target (not `preserveDrawingBuffer` on the live canvas), and
  memory behavior on iPad for multiple Saved views.
- Thumbnail cache: storage location, keying, and the "relevant project
  changes" invalidation signal for lazy regeneration.
- Workspace-preference storage for document settings keyed by project id.
- Where the shared "static scene → drawing commands" layer lives so SVG
  canvas, PNG rasterizer, and PDF writer consume one painter rather than
  three (the scene2d builders were built for exactly this seam).
- Font strategy for PDF text (embedded subset vs. standard fonts) given
  project names may contain arbitrary Unicode.
- WebP → JPEG/PNG transcode path for embedded artwork images (§10.3).
- Saved-view schema shape (pose, room id, title, creation order/date) and
  its `.sightlines` migration.

## 17. Ethical review

The feature produces artifacts the user explicitly composes and triggers; it
introduces no deceptive, coercive, or attention-extractive pattern. The
principal trust risks are honesty risks: an export that differs from the
canvas (§10.1 forbids second derivations), a page that invites tape-measure
use it cannot support (§9.2 uses scale bars and refuses ratio claims), and a
stale 3D view presented as current (§8.2 re-renders at export time, and
room labels resolve live per §8.3).
Privacy posture is preserved: everything renders client-side, files go only
where the user puts them, and PDF metadata carries nothing personal.
