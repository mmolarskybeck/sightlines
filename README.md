# Sightlines

**Sightlines** is a private-by-design exhibition planning tool for scaled room layouts, wall elevations, artwork placement, and simple 3D preview.

It is built for curators, exhibition planners, preparators, artists, and small gallery or museum teams who need to move between checklist thinking and spatial thinking without giving up privacy, precision, or speed.

Sightlines is not a CAD program, a SketchUp clone, a generic room planner, or a collections-management database. It is a calm, focused layout instrument for planning how artworks, labels, architectural constraints, and visitor sightlines relate in space.

## Current Status

Sightlines is deployed at app.sightlines.art and in daily curatorial use by its author on real exhibitions; the detailed current read and next steps live in `docs/status.md`.

The direction is **browser-first and local-first**:

* No account and no Sightlines backend.
* Artwork images and project data stay on the user’s device; projects autosave locally in the browser.
* Explicit export/backup paths are part of the product: `.sightlines` packages, PDF and image exports, and optional Dropbox backup, share links, and cross-device sync through the user's own account.

Hosted accounts, real-time collaboration, subscriptions, and admin tooling are intentionally deferred until there is real demand.

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
* Export portable project files, PDF documents, and checklist spreadsheets for backup, handoff, or manual sharing.
* Back up project packages directly to the user’s Dropbox account, share a one-way snapshot link, and keep one project in sync across the user’s own devices (technical pilot).

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

For additional protection, connect Dropbox from the save-status controls. Sightlines
uploads versioned `.sightlines` packages directly to a private Dropbox app folder;
project data is not uploaded to a Sightlines server. The app keeps the most recent
five Dropbox backups per project and also maintains a silent, same-origin local
snapshot history for recovery from a bad save. Local snapshots do not protect
against browser storage eviction, so Dropbox or an exported package remains the
off-device backup.

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
* Silent, fingerprint-deduplicated local snapshots for recovery from corruption or a bad save.
* Dropbox App Folder backup through browser OAuth with PKCE and offline refresh.
* `.sightlines` package export/import for portable manual backups and sharing.
* Static public info pages and trust/security metadata served from `public/`.

Provider boundary and future work:

* Dropbox is the first supported cloud provider and is currently in technical pilot.
* OneDrive and Google Drive are possible follow-on providers, not currently supported.
* Provider state must distinguish connected, reauthorization required, and last successful backup.
* Cloud backup is versioned file backup, not real-time collaboration or conflict-free co-editing.

See [docs/cloud-backup-providers.md](docs/cloud-backup-providers.md) for the provider
rollout plan, OAuth constraints, permissions, and production-readiness gates.

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


* IndexedDB-backed project storage.
* Versioned project schema validation with Zod.
* Project-level undo/redo.
* Plan view and wall elevation view.
* Rectangle room creation and wall navigation.
* Irregular polygon room drawing, vertex reshape, wall split/delete, and wall-slide reshaping.
* Free-standing partition walls with double-sided faces.
* Numeric wall and room dimension editing.
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
* Door, window, and blocked-zone wall objects.
* Shared doors and windows across rooms as one physical opening with two synchronized faces, optional hinged door leaves, and explicitly open walls.
* Floor and wall display cases, wall-text panels, and a measurement tool for reference distances.
* Framing and matting previews with adjustable band widths and shaded finishes, in elevation and 3D.
* Four display types — wall work, wall projection, box monitor, sculpture — derived from a free-text Medium field with an explicit override.
* Neighbor-aware dimension lines between placed works.
* Placement warnings for overlaps and out-of-bounds works.
* Floor objects in plan view with snapping, rotation, suspension height, per-face images, back-to-back pairing, and wall ⇄ floor conversion.
* Multi-select, group drag, and equal wall distribution.
* Checklist search, filtering, sorting, and artist grouping, with sort and grouping stored on the project.
* Derived 3D preview with artwork textures, true shared openings, hinged leaves, partition slabs, cases, monitors, and camera presets — editable by drop-to-place, arrow nudge, and pointer drag, with numeric precision left to the inspector and elevation.
* 3D navigation: cursor-directed wheel dolly, WASD travel, double-click focus flights, touch pan, a hand tool, and zoom controls.
* Touch drag-and-drop artwork placement for iPad/iPhone.
* Cross-project artwork library view and a settings dialog with durable-storage request.
* Focus-aware keyboard guards so text fields, selects, SVG workspace focus, and panel resize handles keep their own shortcuts.
* Static About, Privacy, Security, IT, `security.txt`, sitemap, robots, manifest, and `llms.txt` trust surfaces.
* `.sightlines` project package export/import with schema versioning and content-addressed assets.
* Saved views collection with editable titles, live room labels, and thumbnail caching.
* PNG/JPG image snapshots (one-click export of the current view).
* PDF document export with configurable contents (overview plan, room details, wall elevations, 3D views), automatic dimension lines, and vector output with embedded artwork.
* Checklist export as a PDF works list or as xlsx/CSV (optional images folder) whose headers round-trip through the import wizard.
* Bulk mat/frame editing for artwork selections with live preview.
* Dropbox cloud backup with automatic settled-edit uploads, five retained copies per project,
  reconnection handling, and save-status visibility.
* Dropbox share links (one-way snapshot handoffs that always open as a copy), a cloud project browser, and canonical cross-device sync with revision-conditional writes and whole-project conflict choices.
* Cross-tab refresh so two tabs on the same project never overwrite each other with stale copies.
* Consent-gated, allowlisted usage analytics and an independent crash-report preference (both off by default).

## Deployment

Sightlines is prepared for Cloudflare Workers static-assets deployment with Wrangler. See [docs/deployment.md](docs/deployment.md) for login, dry-run, deploy, and Cloudflare build settings.

## Pre-commit hook

After cloning, run `npm run hooks:install` once to activate the repository's
pre-commit checks. The current guard rejects raw NUL bytes in staged source and
documentation files while leaving intentional binary assets alone.

The same check runs in CI as `npm run check:nuls`, over every tracked text file
rather than only the staged ones — the hook is the fast local signal, CI is the
one that binds. Run `npm run check:nuls` by hand any time you want the tree
checked. A stray `0x00` in a source file is invisible in an editor and makes git
treat the file as binary, so its diffs stop being reviewable; `od -c` cannot
detect it, because it prints a raw NUL and the escape identically.

## Roadmap

The detailed roadmap lives in `docs/plan.md` §9 (source of truth); the current position and near-term order live in `docs/status.md`. In brief:

* **MVP 1 — Spatial editor + checklist core: shipped.** Geometry spine, artwork library/checklist, placement with snapping and collision flagging, multi-select/group/arrange, simple derived 3D preview.
* **MVP 2 — Room shape tools + multi-room flow: shipped** (a benchmark-triggered renderer-scalability gate remains open). Polygon rooms and reshaping, partitions, paired door/window connections with honest 3D see-through/capped treatment, multi-room placement, 3D navigation.
* **MVP 3 — Project packages, sharing, polish: shipping.** `.sightlines` export/import with the untrusted-file safety pipeline (2026-07-12), PNG/PDF exports with automatic dimension lines (2026-07-17), Dropbox backup (2026-07-19), share links (2026-08-11), checklist exports and cross-device sync (2026-08-19), the display-type model and 3D editing (2026-08-28 → 31). Still open: readiness reporting, guided onboarding, library-wide export.
* **MVP 4/5 — Tablet depth, then phone tier.** iPad-adapted layout, richer checklist workflows, scale-accurate tiled printing, command palette; phone viewing later. Sync stages 3–4 (share-link management, content-addressed cloud assets) are designed in `docs/cloud-sync-plan.md`.
* **Future provider expansion:** evaluate Google Drive and OneDrive after the Dropbox pilot. Each requires its own OAuth, verification, institutional-admin, and token-lifecycle review.
* **Backlog (real demand only):** hosted accounts/cloud, real-time collaboration, registrar-level collections management, 3D transform gizmos and 3D snapping, curved walls.

## Tech Stack

Current direction:

* **App:** Vite, React, TypeScript
* **State:** Zustand
* **Validation:** Zod
* **Storage:** IndexedDB for local projects and snapshots; Dropbox App Folder for optional off-device packages; OPFS planned for larger image blobs
* **UI:** Radix / shadcn-style primitives, Tailwind-compatible styling
* **2D editor:** React-rendered editor surfaces backed by plain project data
* **3D preview:** React Three Fiber / three.js
* **Exports:** Client-side image/PDF and `.sightlines` package generation
* **Cloud backup:** Provider interface with a Dropbox implementation; no Sightlines project-data backend

No backend is required for the current local-first app or Dropbox backup. Future
providers may require a small stateless token-exchange helper, subject to security
and provider-approval review.

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

`CLAUDE.md` holds the full index of which doc owns what and when to update it. In brief:

* `README.md` — concise project overview, current status, setup, roadmap.
* `CLAUDE.md` / `AGENTS.md` — working rules for coding agents and the index of which doc owns what.
* `PRODUCT.md` — product purpose, users, brand personality, design principles.
* `DESIGN.md` — visual language, tokens, component philosophy.
* `docs/plan.md` — full architecture and roadmap source of truth.
* `docs/status.md` — the single living status doc: current state, shipped rounds, near-term order, known follow-ups.
* `docs/decisions.md` — decisions of record, invariants, and traps by area.
* `docs/export-spec.md`, `docs/package-format.md`, `docs/cloud-sync-plan.md`, `docs/cloud-backup-providers.md`, `docs/deployment.md` — behavior contracts for exports, the `.sightlines` format, Dropbox sync, provider rollout, and deploys.
* `docs/quick-todos.md` — small open scraps that don't fit the roadmap.
* `docs/archive/` — frozen historical docs (build logs through 2026-09-01, completed specs and plans).

## Product Promise

Sketch the gallery. Define the walls. Build the checklist. Place the works. Respect the architecture. Preview the installation before anything goes on the wall.
