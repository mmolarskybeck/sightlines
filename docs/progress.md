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
- [x] Added basic rectangular room creation controls and grouped room/wall navigation in the Gallery panel.
- [x] Introduced the single `applyEdit` pipeline in the store: every mutating action is a thin command constructor; the pipeline stamps `updatedAt`, pushes the undo/redo stack, drops the redo stack, and persists.
- [x] Added project-level undo/redo with toolbar buttons and Cmd/Ctrl+Z / Shift+Cmd+Z / Ctrl+Y shortcuts; document replacement (boot, import, reset) resets the edit history.
- [x] Made the project title commit on blur/Enter (reverting empty input) instead of saving per keystroke.
- [x] Made repository `save()` validate against the current schema before writing, so invalid state can never persist.
- [x] Made repository `list()` read raw summaries and skip unreadable records instead of failing wholesale; `boot` now surfaces a visible load-failure message instead of silently swapping in the sample.
- [x] Added error handling to JSON import — malformed files report "Import failed" and leave the current project untouched.
- [x] Constrained `RoomPlacement.rotationDeg` to 0 in the schema until rotation is actually rendered.
- [x] Added schema invariants: walls form a closed loop in vertex order; wall and placement `roomId`s agree with their containing room.
- [x] Gave `migrateProject` a minimal versioned-shape pre-parse before full validation.
- [x] Injected the project repository into the store via `createAppStore(repository)`, enabling store tests against an in-memory fake.
- [x] Added store tests covering boot, undo/redo round-trips, redo-stack clearing, no-op edit skipping, import failure/success, and load-failure messaging.
- [x] Split `App.tsx` into per-component files (`PlanView`, `ElevationView`, `GridOverlay`, `WallInspector`, `DataView`).
- [x] Centralized the elevation wall-local → SVG y-flip in one `wallLocalYToSvgY` helper.
- [x] Added explicit room Width/Depth dimension controls in the Gallery sidebar for rectangle rooms, alongside the existing per-wall rows — reuses the same paired-wall resize path as the inspector's per-wall Length field via a new generalized `resizeWall(wallId, lengthMm)` store action (`resizeSelectedWall` now delegates to it).
- [x] Made numeric length edits reject non-rectangular rooms instead of silently skewing a neighboring wall's angle. `resizeWallPreservingAngles` previously fell back to moving a single end vertex for any room that wasn't a clean four-wall quad — that fallback could break an adjacent wall's right angle without telling anyone. It now throws a clear, catchable error for that case (`"only supports rectangular rooms"`), and both the wall Length field and the new Width/Depth fields surface it inline instead of producing an unhandled rejection. Skewed/non-90° reshaping stays explicitly reserved for a future dedicated reshape tool, not a numeric-field side effect.
- [x] Replaced the temporary fixed grid interval with the shared precision system from `docs/plan.md` §5.5. Added `domain/units/precision.ts` with unit-aware metric/imperial grid interval tables and `getMinorGridIntervalMm`/`getMajorGridIntervalMm`/`getPixelsPerMm`; added a `useContainerSize` hook so `PlanView`/`ElevationView` measure their actual rendered pixel size via `ResizeObserver` and derive a real pixels-per-mm scale (matching SVG `xMidYMid meet` scaling) instead of assuming one. The grid now genuinely steps to a coarser or finer interval as available screen space changes, with a readable major-line landmark computed from the same table — `getGridSpacingMm` and its fixed constant are gone. Plan and elevation still read separate coordinate spaces, per §5.5.
- [x] Split the single grid toggle into independent "show grid" and "snap to grid" local preferences (`useViewPreferences`), persisted to `localStorage` — never to `Project`/`.sightlines` data, so importing a shared file never imports someone else's working-style preferences. Added a second toolbar toggle (Snap, `Magnet` icon) alongside Grid; `snapToGrid` defaults on and is ready for the next step to consume once grid snap targets exist — it doesn't change rendering yet on its own.
- [x] Added `getGridSnapTargets(intervalMm, visibleBoundsMm)` (`domain/snapping/gridSnapTargets.ts`), generating one lowest-priority `"grid"` `SnapTarget` per visible grid line — vertical lines as `axis: "x"` candidates, horizontal as `axis: "y"` — from the active interval and visible coordinate space, ready to plug straight into `resolveSnap()` alongside centerline/neighbor targets. Capped defensively at 1000 lines/axis independent of caller input. Like `resolveSnap()` itself, this is pure domain plumbing with no call site yet — nothing drags anything on screen until tactile handles exist (still open below), so this is intentionally unwired until then, not a partial feature.
- [x] Added a real new-project / repository list/load/delete flow, replacing the old dev-only "reset local project" button (which nuked every saved project at once — a mismatch between its label and its blast radius now that multiple real projects can exist). Relaxed the schema's `floor.rooms` from `min(1)` to allow an empty floor, since a brand-new project starts with no rooms per the north star (`docs/plan.md` §1.5: room layout and checklist-first are equally valid starting points) — added `createBlankProject(title)` (`domain/newProject.ts`) for this. Added store actions `listProjectSummaries`/`openProject`/`createProject`/`deleteProject` (`deleteProject` falls back to another saved project, or a fresh blank one, if the currently-open project is the one deleted) and a `ProjectPicker` toolbar component listing saved projects with open/delete, sorted by most-recently-updated. Added a minimal empty-state message for the Elevation tab when no wall is selected (previously rendered nothing at all), since a fresh roomless project reaches that state immediately.
- [x] Confirmed (via audit) that "numeric room/wall fields always route through the shared units module" was already true — every user-facing length field (wall length, wall/room height, centerline, room width/depth) already goes through `parseLength`/`formatLength` exclusively; this checklist item was stale, not an open gap.
- [x] Added the first tactile drag handles — two draggable resize handles per rectangle room in Plan view (Width and Depth), the tactile counterpart to the sidebar's numeric Width/Depth fields. Added pure math helpers (`domain/geometry/dragResize.ts`: `projectDeltaOntoAxis`, `computeDraggedLengthMm`) so a 2D pointer drag only affects a wall's length along that wall's own axis. Each handle sits on the wall that actually moves when its dimension changes, not the wall whose length value it edits (resizing wall `i`'s length moves wall `i+1`'s vertices — verified this empirically in the browser for all four walls before locking in the mapping). Drag lifecycle: pointerdown captures the start point via `getScreenCTM()` (client px → SVG mm), live pointermove computes a preview by calling the *same* pure `resizeWallPreservingAngles` used for numeric commits (so dragging and typing can never disagree), and exactly one `resizeWall()` store call fires on release — one undo entry per drag, verified undo/redo round-trips correctly for both handles. A sub-threshold release (click without drag) is a no-op, no phantom undo entry.
- [x] Wired `getGridSnapTargets()`/`resolveSnap()` into the wall-resize drag — their first real call site, and what `snapToGrid` actually gates now. Each pointermove filters grid candidates to the axis the dragged handle can actually move along (a width handle only ever considers vertical grid lines, and vice versa — including the other axis risked spurious snaps from incidental hand-tremor alignment) before calling the same `resolveSnap()` used elsewhere, with hysteresis (`previousSnapTargetId`) carried frame-to-frame in drag state. Added a rendered dashed `.snap-guide` line from `resolveSnap()`'s `activeGuides` while snapped. Verified in the browser: a drag landing within threshold of a grid line snaps to the exact value, both in the live preview and the committed result; with `snapToGrid` off, the same drag commits the raw unsnapped value. (Verifying this surfaced a test-harness gotcha worth remembering: interleaving `preview_eval`/`preview_screenshot` calls *during* an active synthetic drag can inject stray pointer events into the page's real event stream and corrupt the in-progress gesture — mid-drag testing needs one uninterrupted pointerdown→pointermove→pointerup sequence per eval call, not staggered calls with inspection in between.)
- [x] Fixed grid snapping to snap the wall's moving edge, not the raw pointer. The drag previously committed `startLength + (snappedPointer − startPointer)`, so the grab offset within the 16px handle leaked into every committed length — landing on the 15' grid line still produced values like `14' 10 7/8"`. New pure helpers in `domain/geometry/dragResize.ts` (`getMovingWallEdgeWorldPointMm`, `proposeMovingEdgePointMm`, `computeEdgeSnappedLengthMm`) derive the moving edge's world position at drag start and snap *that* to grid targets, so the grab offset cancels exactly and the wall edge lands on the grid line. Regression test proves an off-center grab dragged near the 15' line commits the edge to exactly `feetToMm(15)`; snap-disabled path proven unchanged.
- [x] Added the display-unit toggle — a compact Units select (Imperial: ft, in / Metric: m, cm) in the view toolbar, backed by an undoable, persisted `setUnit` store action through `applyEdit`. Since grid interval tables and all formatting already key off `project.unit`, switching units switches the whole grid family (imperial 1"/2"/3"/6"/1'/… vs metric 5mm/1/2/5/10cm/…) rather than relabeling one spacing, per §5.5.
- [x] Added the user-adjustable grid precision floor from §5.4/§5.5 ("step downward until hitting the user's chosen precision floor"). `getMinorGridIntervalMm` now accepts an optional `minIntervalMm` floor that clamps zoom-adaptive selection up to the smallest table entry ≥ the floor; `getGridPrecisionFloorOptionsMm(unit)` curates the offered floors from each family's own interval table (imperial ½"/1"/6"/1'; metric 5mm/1cm/10cm) so every choice lands on an actual grid step. Persisted as `gridPrecisionFloorMm` (null = auto) in `useViewPreferences` — workspace preference, not project data — with a compact "Precision" select next to Grid/Snap/Units. Because PlanView's snap targets derive from the minor interval, the floor governs snap increments too: one precision system, not three. (Also fixed test infra: Node 25's non-functional built-in `localStorage` global was shadowing jsdom's in Vitest; `src/test/setup.ts` now installs an in-memory Storage when the global is unusable.)
- [x] Hardened JSON import (`docs/plan.md` §2 pipeline): new `migrateProjectJson(text)` in `projectSchema.ts` owns the full size-cap → parse → shape-check → migrate → validate flow. 20 MB import cap checked before `JSON.parse`; distinct calm error messages for not-JSON, not-a-Sightlines-project, made-with-a-newer-schema-version ("open it with a newer version of the app"), Zod validation failure (reformatted path + reason, no raw ZodError dump), non-string, and oversized input. Tests prove the open project is untouched on every failure path and that `exportProjectJson` → `importProjectJson` round-trips deep-equal. Audited prototype-pollution risk: `z.object`'s unknown-key stripping already covers it, no change needed.
- [x] Anchored the elevation grid to the floor per §5.5 ("y=0 should be floor level"): `GridOverlay` gained optional `originXMm`/`originYMm` pattern-phase props (default 0 keeps PlanView's world-origin anchoring), with the phase math in a pure tested `getGridPatternPhaseMm`. ElevationView passes `originYMm={wallHeightMm}` so a horizontal grid line always lands on the floor regardless of wall height. Also extended both interval tables downward (½" imperial, 0.5cm metric) for close-in elevation work — zoom-adaptive selection means these only appear when pixel density allows.
- [x] Added a `navigator.storage.persist()` request (`app/hooks/useStoragePersistence.ts`): on mount, checks `navigator.storage.persisted()` and requests `persist()` if not yet granted, exposing `"unsupported" | "granted" | "denied" | "pending"`. Every call is guarded — Safari/older browsers lack the API, and any thrown failure from a browser that exposes-but-misbehaves resolves to `"unsupported"` rather than propagating, so a storage quirk can never block boot. The sidebar's `.storage-note` now reflects the result: durable storage gets reassuring copy, denied/unsupported gets a slightly stronger export-a-backup nudge, and the brief pending window keeps the original neutral copy rather than flashing a warning that may immediately flip to reassurance.
- [x] Gave the Elevation tab's empty state (no wall selected) dedicated visual treatment instead of a bare message: `ElevationEmptyState` (`app/components/ElevationEmptyState.tsx`) adds a small centered, `aria-hidden` inline-SVG wall glyph (stroke-based outline + dashed centerline hint echoing the real elevation drawing's own `.wall-fill`/`.centerline`, styled with `currentColor`/`var(--subtle)` — no new colors) above the copy. Two states, matching the two reasons the surface is empty: no rooms yet ("Add a room, then select a wall…") vs. rooms exist but nothing is selected ("Select a wall from the Gallery list…"). No animation.
- [x] Added global artwork library repository: shared `domain/repositories/database.ts` with `ProjectRepository`, using a single `DB_VERSION` (bumped 1→2) with migration preserving existing projects. Mirrored the project repo's pattern: `validate`-before-`save` prevents invalid persistence, `list()` skips unreadable records instead of failing wholesale, and `saveAsset`/`delete` span both `assets` and `assetBlobs` in one transaction to avoid orphaned blobs.
- [x] Implemented image intake split between pure decision logic and browser-specific effects: `domain/assets/imageIntake.ts` enforces MIME allowlist (jpeg/png/webp), 50 MB cap, and never-upscale `fitWithin`; `browserImageProcessor.ts` handles `createImageBitmap` with `imageOrientation: "from-image"` for EXIF rotation, `OffscreenCanvas` (canvas fallback), WebP q=0.82, and SHA-256 of original bytes. Generates thumbnail ≤400px and display ≤1800px tiers. Web Worker offload and OPFS storage deferred behind `ImageProcessor`/`AssetRepository` seams.
- [x] Wired `createAppStore(deps)` to inject `ImageProcessor`. Batch intake via `addArtworksFromFiles` writes library/asset records outside `applyEdit`, then commits a single undo entry per batch that only touches `checklistArtworkIds` — undoing removes checklist membership, never library records, so assets remain available for reuse (§4.1). Per-file failures aggregate without sinking the batch; `removeArtworkFromChecklist` leaves library records intact but defensively drops dangling `artwork` wallObjects.
- [x] Built checklist UI in `ChecklistPanel` left sidebar: pointer-agnostic intake (drag-drop + file picker), `useAssetImageUrls` object-URL hook prevents memory bloat, missing-library-record rows degrade visually instead of vanishing, placed/unplaced tag derived from `wallObjects` not hardcoded state. Both input paths route through `addArtworksFromFiles` so intake errors surface uniformly.
- [x] Implemented artwork metadata editing: `ArtworkInspector` component (title, artist, date, accession, location; dimension W/H/D fields via `parseLength`/`formatLength` with a Status select; commit-on-blur; empty commits as undefined since fields are optional) — `updateArtwork` validates via `parseArtwork` before persisting, invalid edits error calmly with no undo entry. Typing a dimension never auto-flips status; status is the curator's claim, not derived.
- [x] Generalized undo per docs/plan.md §7: `EditEntry` now carries an optional project half and/or artwork half (`{label, project?: {before,after}, artwork?: {before,after}}`), making artwork metadata edits undoable despite library records living outside the project document — a dimension edit that resyncs placed sizes bundles both halves into one atomic entry. Placements with `displayDimensionsOverride` are left alone by the sync.
- [x] Dimension uncertainty: shared `UncertaintyIndicator` component (§8 one visual language — "Approx."/"No dims" badge) reused in checklist rows and artwork inspector; elevation mirrors the same amber tokens as dashed outlines on uncertain placements.
- [x] Drag-to-wall placement: checklist rows are HTML5 drag sources (`ARTWORK_DRAG_MIME`); elevation is the drop target with a live snapped ghost (App relays `draggingArtworkId` from dragstart because dataTransfer payloads are unreadable until drop). Unknown dims place at 610×760mm placeholders (`PLACEHOLDER_ARTWORK_*` constants) per plan §1.5 "place without waiting for precision"; out-of-bounds placements are flagged (warning + danger outline), never blocked or clamped.
- [x] Elevation rendering: `ElevationArtwork` renders display-tier images (useAssetImageUrls grew a tier param, default "thumbnail" so existing call sites unchanged) inside stroke-only outline rects that always show the true dimension extent (xMidYMid meet — art is never cropped); selection + click-to-select wired.
- [x] Pure snapping: new `getArtworkSnapTargets`/`resolveArtworkSnap` (centerline > neighbor-center > neighbor-edge > grid, §2 priority, grid tier gated on `snapToGrid`) — drop ghost and move drag share the identical resolve path so preview and commit can never disagree.
- [x] Transaction-bounded placement undo (§7): pointer-drag move previews locally and commits exactly one `moveArtworkPlacement` on release; sub-threshold release is a no-op. Geometry-change revalidation was already wired from 1A (resizeWall → `validateChangedWallPlacements`) — now proven by a store test (artwork near wall end + shrink → warning); horizontal bounds message reworded to read correctly for both resize and fresh placement.
- [x] Fixed two issues surfaced by end-to-end browser verification of the placement slice: (1) placed artworks were hit-testable only on their hairline outline stroke — the outline rect is `fill: none`, and SVG's default `visiblePainted` hit-testing ignores unpainted fill, so clicking/dragging the artwork body did nothing; `.elevation-artwork:not(.ghost) .artwork-outline { pointer-events: all }` makes the whole true-dimension rect the hit area while ghosts stay inert. (2) The placement-warning panel showed raw wallObject UUIDs; warnings are now labeled App-side with the artwork's title (or the object kind) before rendering — the domain `PlacementWarning` keeps carrying only ids.

## In Progress / Immediate Next

- [ ] Extend tactile handles to vertex-level dragging for non-rectangular rooms once a reshape mode is designed (today's handles only cover the rectangle width/depth case, matching numeric editing's current scope).

## MVP 1A Remaining

- [ ] Finish the geometry spine from `docs/plan.md` section 9:
  - [ ] Migration function chain (`v1→v2`, ...) when a schema v2 first ships — the parse → validate → migrate → validate pipeline shape already exists in `migrateProject`.
- [ ] Keep transient drag state out of `applyEdit`/persist when tactile handles arrive — already true for the new wall-resize drag (live preview is computed locally in `PlanView` via the pure `resizeWallPreservingAngles`, never through `applyEdit`, until the single commit on release).

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
