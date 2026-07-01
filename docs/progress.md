# Sightlines Rebuild Progress

This is the working implementation checklist for the rebuild. It is intentionally shorter and more tactical than `docs/plan.md`.

Refer to `docs/plan.md` as the full project overview, product/architecture plan, and roadmap source of truth. This file tracks what has already been built and what should be tackled next.

## Done

- [x] Created the new Vite + React + TypeScript application skeleton.
- [x] Added repo-level product context in `PRODUCT.md`.
- [x] Configured Impeccable live mode for the Vite single-shell app.
- [x] Added a local-first `ProjectRepository` interface.
- [x] Implemented an IndexedDB-backed project repository.
- [x] Added versioned project schema validation with Zod.
- [x] Added backwards-compatible defaulting for `wallObjects`.
- [x] Added the initial project data model: `Project`, `Floor`, `RoomPlacement`, `Room`, `RoomVertex`, `Wall`, `Artwork`, and `WallObject`.
- [x] Added the sample single-room project.
- [x] Added wall geometry helpers that derive wall length/angle from vertex IDs.
- [x] Built a first app shell with top bar, wall list, plan view, elevation view, JSON data view, and inspector.
- [x] Added JSON project import/export for early debugging and backup.
- [x] Added local-save status and browser-storage backup messaging.
- [x] Implemented `units/length.ts` for parsing and formatting measurements.
- [x] Added unit tests for measurement parsing/formatting edge cases.
- [x] Implemented pure `resolveSnap()` with snap priority and hysteresis support.
- [x] Added snap tests.
- [x] Added numeric wall-length editing through the inspector.
- [x] Made numeric rectangle edits preserve orthogonal geometry.
- [x] Made rectangle edits use an explicit anchor rule: the selected wall's start vertex stays fixed.
- [x] Made paired walls update together for rectangle rooms because width/height are the real editable dimensions.
- [x] Added geometry edit reporting: changed wall IDs and anchor vertex ID.
- [x] Added placement revalidation plumbing for walls whose lengths changed directly or by cascade.
- [x] Added an inspector warning panel for placement warnings.
- [x] Added browser verification for wall-length edits, orthogonal lock behavior, and basic tab interactions.
- [x] Added tests for geometry edits, schema defaults, and cascaded placement validation.
- [x] Added the rectangle inspector affordance for paired dimensions, so users can see that North/South and East/West are linked.
- [x] Added tests for rectangle paired-wall detection.
- [x] Implemented the first toggleable visual grid overlay for plan and elevation alignment.
- [x] Documented the unified precision-grid model: unit-aware intervals, zoom-adaptive display, continuous floorplan grid behavior, grid snap targets, separate show/snap preferences, and centerline guide behavior.
- [x] Added a toolbar action to reset local browser storage back to a fresh sample project during development.
- [x] Refined plan view framing so room layouts use full-floor bounds with proportional padding.

## In Progress / Immediate Next

- [ ] Add basic room creation/editing controls for MVP 1A beyond the initial sample rectangle.
- [ ] Add explicit room dimension controls for width/height alongside per-wall rows for rectangle rooms.
- [ ] Keep numeric edits orthogonal by default while reserving skew/non-90-degree geometry for an intentional future reshape mode.
- [ ] Replace the temporary fixed grid interval with the shared precision system from `docs/plan.md` §5.5.
- [ ] Split the current grid control into independent "show grid" and "snap to grid" local preferences.
- [ ] Generate grid snap targets for `resolveSnap()` from the active grid interval and visible coordinate space.

## MVP 1A Remaining

- [ ] Finish the geometry spine from `docs/plan.md` section 9:
  - [ ] Versioned import pipeline: parse -> validate minimal shape -> migrate -> validate current schema.
  - [ ] Repository list/load/delete UI beyond the single auto-loaded project.
  - [ ] New project flow.
  - [ ] Single-room footprint editing beyond numeric wall length.
  - [ ] Tactile vertex/wall handles.
  - [ ] Numeric room/wall fields that always route through the shared units module.
  - [ ] Empty wall elevation view polish.
  - [ ] JSON export/import hardening.
- [ ] Add a first undo/redo command stack at the project level.
- [ ] Add autosave behavior tied to committed document changes, not transient drag movement.
- [ ] Add corruption/error messaging for invalid imports.
- [ ] Add storage persistence request with `navigator.storage.persist()` where supported.
- [ ] Add app-level preferences for view options like grid visibility, snap-to-grid, and grid density without persisting them into `Project`.

## MVP 1B Next Major Slice

- [ ] Add global artwork library repository.
- [ ] Add project checklist membership separate from placement.
- [ ] Add image upload/intake.
- [ ] Generate thumbnail/display image tiers.
- [ ] Add artwork metadata editing.
- [ ] Add artwork dimension uncertainty state and shared indicator.
- [ ] Add drag-to-wall placement.
- [ ] Render placed artwork in wall elevation.
- [ ] Run placement changes through pure snapping and validation functions.
- [ ] Add transaction-bounded undo/redo for placement movement.
- [ ] Revalidate placements after any wall geometry change.

## MVP 1C / Later

- [ ] Doors, windows, and blocked zones.
- [ ] Collision validation against obstacles.
- [ ] Multi-select.
- [ ] Grouping and group drag.
- [ ] Equal distribution spacing.
- [ ] Floor objects in plan view.
- [ ] Simple 3D preview.
- [ ] Checklist panel with thumbnail, core fields, and sorting.

## MVP 2 / Later

- [ ] `.sightlines` package export/import.
- [ ] Import safety checks for zip traversal, size caps, MIME validation, and corrupted assets.
- [ ] Library-wide export/import.
- [ ] Prominent save-backup flow.
- [ ] PNG exports.
- [ ] PDF checklist export.
- [ ] Missing/approximate data readiness report.

## Design / UX Notes To Keep

- [ ] Keep `docs/plan.md` as the project overview and roadmap reference.
- [ ] Keep product UI restrained, dense, and task-focused.
- [ ] Avoid making numeric fields imply false independent degrees of freedom.
- [ ] Make constraints visible where they affect behavior.
- [ ] Flag invalid or uncertain state; do not silently fix, hide, clip, or slide user content.
- [ ] Use `sightlines-old/` only as local reference material unless explicitly asked to migrate specific code or assets.
