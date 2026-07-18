# Sightlines

**Sightlines** is a private-by-design exhibition planning tool for scaled room layouts, wall elevations, artwork placement, and simple 3D preview.

It is built for curators, exhibition planners, preparators, artists, and small gallery or museum teams who need to move between checklist thinking and spatial thinking without giving up privacy, precision, or speed.

Sightlines is not a CAD program, a SketchUp clone, a generic room planner, or a collections-management database. It is a calm, focused layout instrument for planning how artworks, labels, architectural constraints, and visitor sightlines relate in space.

## Current Status

Sightlines is in active rebuild.

The current direction is **browser-first and local-first**:

* No account required in v1.
* No hosted project data in v1.
* Artwork images and project data stay on the user’s device.
* Projects autosave locally in the browser.
* Explicit export/backup paths are part of the product, not an afterthought.

Cloud accounts, hosted collaboration, public snapshot links, subscriptions, and admin tooling are intentionally deferred until there is real demand.

## Product Goals

Sightlines should let a user:

* Start from a room layout or from an artwork checklist.
* Draw rectangular or irregular polygon gallery rooms.
* Work with real wall dimensions and wall heights.
* Add free-standing partition walls as double-sided placement surfaces.
* Upload artwork images and enter dimensions later.
* Import image batches, spreadsheet metadata, or both through a reviewable import wizard.
* Mark dimensions as known, approximate, or unknown.
* Drag artworks onto scaled wall elevations.
* Snap works to a configurable centerline.
* Add doors, windows, and blocked wall zones.
* See warnings when works overlap architectural constraints or fall outside wall bounds.
* Edit measurements either tactically by dragging or precisely through numeric fields.
* Move between plan view, elevation view, checklist, and simple 3D preview without losing context.
* Export portable project files for backup or manual sharing.
* Save/sync using services like Dropbox, Drive, OneDrive, etc. (stretch goal)

## Core Workflow

Sightlines is deliberately non-linear.

A user can:

1. Create a project.
2. Add a room first, or skip straight to the checklist.
3. Draw a rectangle quickly, or switch into polygon drawing/reshape for an irregular room.
4. Upload artwork images at any time, with or without spreadsheet metadata.
5. Place works on wall elevations, even with approximate or placeholder dimensions.
6. Refine wall dimensions, artwork placement, openings, and constraints.
7. Review the installation spatially.
8. Export a backup or shareable project package.

The app should support early sketching without hiding uncertainty. Approximate dimensions and missing metadata should remain visible so a rough plan never masquerades as a final installation drawing.

## Design Direction

Sightlines should feel:

* Precise
* Calm
* Professional
* Legible
* Dense without feeling cluttered
* More like a museum workroom tool than a startup dashboard

The visual language should favor line, measure, alignment, and restraint:

* White canvas
* Near-black and graphite linework
* Sparse accent color for selection, guides, and active tools
* Rectangular panels before rounded cards
* Thin borders before heavy fills
* Semantic color only for uncertainty, warnings, and errors

Icons use **Phosphor** as the default icon family, using quiet line-style icons and avoiding mixed icon systems inside the same surface.

## Architecture Principles

### Project data is the source of truth

The layout is stored as plain project data. Rendering layers are projections of that data.

```txt
project data
→ plan view
→ elevation view
→ 3D preview
→ export renderer
```

Canvas, SVG, React components, and future 3D objects should never become the canonical layout state.

### Local-first, but cloud-ready

Persistence sits behind repository interfaces so the current local implementation can later be joined or replaced by cloud-backed repositories without rewriting the editor.

Current persistence:

* IndexedDB for project documents, metadata, artwork records, and thumbnails.
* Browser storage messaging that reminds users to export backups.
* JSON import/export for early development and debugging.
* Static public info pages and trust/security metadata served from `public/`.

Planned persistence/export:

* `.sightlines` project package format.
* Self-contained zip package containing project JSON plus the relevant artwork/image assets.
* Future Dropbox-folder sync without hosting user projects on Sightlines servers.

### Snapping and collision are separate

Snapping suggests good positions.

Collision validation reports invalid positions.

These systems stay separate so a work can snap cleanly to a centerline or grid while still being checked against doors, windows, blocked zones, wall bounds, and other constraints.

### Tactile and numeric editing must agree

Every important geometry edit should have both:

* A tactile path: drag handles, pointer movement, direct manipulation.
* A numeric path: precise fields using the shared units parser/formatter.

Neither path is secondary. A curator should be able to drag a room edge roughly into place, then type `8'4"` and get the same underlying geometry model.

### Uncertainty stays visible

Sightlines should let people work before every detail is known, but it should never hide missing or approximate information.

Examples:

* Unknown dimensions use placeholder scale.
* Approximate dimensions are visually marked.
* Missing images or metadata degrade gracefully.
* Invalid placements produce warnings rather than silently clipping or moving objects.

## Current Feature Set

Implemented or substantially underway:

* Vite + React + TypeScript app shell.
* Local-first project repository.
* IndexedDB-backed project storage.
* Versioned project schema validation with Zod.
* Project-level undo/redo.
* Plan view and wall elevation view.
* Rectangle room creation and wall navigation.
* Irregular polygon room drawing, vertex reshape, wall split/delete, and wall-slide reshaping.
* Free-standing partition walls with double-sided faces.
* Numeric wall and room dimension editing.
* Tactile rectangle resize handles.
* Shared units parser and formatter.
* Imperial and metric display units.
* Precision grid system with show/snap preferences.
* Pure snapping system with snap priorities and hysteresis.
* Artwork library and project checklist membership.
* Image intake with thumbnail and display derivatives.
* Artwork metadata and dimensions editing.
* Import wizard for images-only, spreadsheet-only metadata, or matched image + metadata import.
* Known / approximate / unknown dimension status.
* Drag artwork from checklist to wall elevation.
* Centerline, neighbor, floor, and grid snapping for wall objects.
* Transaction-bounded drag commits.
* Door, window, and blocked-zone wall objects.
* Paired door/window connections across rooms with advisory alignment status.
* Framing and matting previews with adjustable band widths and finishes.
* Neighbor-aware dimension lines between placed works.
* Placement warnings for overlaps and out-of-bounds works.
* Floor objects in plan view with snapping and drag-to-wall conversion.
* Multi-select, group drag, and equal wall distribution.
* Checklist filtering and sorting.
* Stable measurement-field conversion hints.
* More legible plan-view placement markers.
* Read-only derived 3D preview with artwork textures, door/window cutouts (see-through when aligned pairs connect rooms), partition slabs, and camera presets.
* 3D navigation: cursor-directed wheel dolly, WASD travel, double-click focus flights, and touch pan.
* Touch drag-and-drop artwork placement for iPad/iPhone.
* Cross-project artwork library view and a settings dialog with durable-storage request.
* Focus-aware keyboard guards so text fields, selects, SVG workspace focus, and panel resize handles keep their own shortcuts.
* Static About, Privacy, Security, IT, `security.txt`, sitemap, robots, manifest, and `llms.txt` trust surfaces.
* `.sightlines` project package export/import with schema versioning and content-addressed assets.
* Saved views collection with editable titles, live room labels, and thumbnail caching.
* PNG/JPG image snapshots (one-click export of the current view).
* PDF document export with configurable contents (overview plan, room details, wall elevations, 3D views), automatic dimension lines, and vector output with embedded artwork.
* Bulk mat/frame editing for artwork selections with live preview.

## Deployment

Sightlines is prepared for Cloudflare Workers static-assets deployment with Wrangler. See [docs/deployment.md](docs/deployment.md) for login, dry-run, deploy, and Cloudflare build settings.

## Roadmap

The detailed roadmap lives in `docs/plan.md` §9 (source of truth); the current position and near-term order live in `docs/status.md`. In brief:

* **MVP 1 — Spatial editor + checklist core: shipped.** Geometry spine, artwork library/checklist, placement with snapping and collision flagging, multi-select/group/arrange, simple derived 3D preview.
* **MVP 2 — Room shape tools + multi-room flow: shipped** (a benchmark-triggered renderer-scalability gate remains open). Polygon rooms and reshaping, partitions, paired door/window connections with honest 3D see-through/capped treatment, multi-room placement, 3D navigation.
* **MVP 3 — Project packages, sharing, polish: shipping.** `.sightlines` export/import with the untrusted-file safety pipeline (shipped 2026-07-12), PNG/PDF snapshot and document exports with automatic dimension lines (shipped 2026-07-17), saved views collection, bulk mat/frame editing, and readiness reporting.
* **MVP 4/5 — Tablet depth, then phone tier.** iPad-adapted layout, Dropbox-folder sync, richer checklist workflows, command palette; phone viewing later.
* **Backlog (real demand only):** hosted accounts/cloud, real-time collaboration, registrar-level collections management, full 3D editing, curved walls.

## Tech Stack

Current direction:

* **App:** Vite, React, TypeScript
* **State:** Zustand
* **Validation:** Zod
* **Storage:** IndexedDB now; OPFS planned for larger image blobs
* **UI:** Radix / shadcn-style primitives, Tailwind-compatible styling
* **2D editor:** React-rendered editor surfaces backed by plain project data
* **3D preview:** React Three Fiber / three.js
* **Exports:** Client-side image/PDF generation planned
* **Project package:** `.sightlines` zip package planned

No backend is required for the v1 local-first app.

## Development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Run checks:

```bash
npm run check
npm run test
npm run build
```

## Repository Notes

Recommended docs structure:

* `README.md` — concise project overview, current status, setup, roadmap.
* `PRODUCT.md` — product purpose, users, brand personality, design principles.
* `DESIGN.md` — visual language, tokens, component philosophy.
* `docs/plan.md` — full architecture and roadmap source of truth.
* `docs/status.md` — the single living status doc: current state, recent shipping, near-term order.
* `docs/quick-todos.md` — small open scraps that don't fit the roadmap.
* `docs/archive/` — frozen historical docs (build log through 2026-07-10, completed specs).

## Product Promise

Sketch the gallery. Define the walls. Build the checklist. Place the works. Respect the architecture. Preview the installation before anything goes on the wall.
