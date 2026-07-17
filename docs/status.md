# Sightlines Status

Last refreshed: 2026-07-17 (repo health pass)

This is the single living status doc: current state, what shipped recently, and what comes next. The full product/architecture plan and roadmap live in `docs/plan.md`; small scraps live in `docs/quick-todos.md`; the chronological build log through 2026-07-10 is frozen at `docs/archive/progress.md`.

## Current Read

MVP 1A and 1B are effectively complete, and MVP 1C has shipped its 2D planning behaviors **and the simple derived 3D preview**. The 3D mode shipped per `docs/3d-preview-spec.md`: a read-only projection (pure `scene3d.ts` derivation → R3F dollhouse room shell, textured artwork planes, door/window cutouts, floor boxes, blocked zones, partition slabs, shared uncertainty language), click-to-select synced with the shared store, and animated Overview / Eye-level camera presets. No 3D editing — the inspector remains the numeric editing surface in 3D mode.

Room-shape slices 1-5 have shipped: the fast rectangle path remains, polygon room drawing/reshape is live, wall split/delete and wall-slide reshaping are in place, and free-standing partition walls are schema v3 room-owned objects with derived double-sided faces. Doors and windows can now be paired through reciprocal opening IDs; the inspector and Plan share one advisory angle/gap/overlap/height evaluation, aligned pairs create a true shared clear opening in 3D, and every unpaired or misaligned opening gets a recessed cap so coplanar backface culling cannot create a false portal.

The import surface is also beyond one-off image upload now: the Import wizard supports images-only, spreadsheet metadata, and combined image + metadata intake with map/review steps and image matching. Static public info/trust pages now live under `public/` (`about.html`, `privacy.html`, `security.html`, `it.html`, plus crawler/security metadata) and are linked from the left-rail Help surface.

## Consolidation Pass (shipped 2026-07-09)

Post-irregular-rooms refactor: 20 commits, all phases green (1065 tests, up from 957). Highlights:

- **New domain modules**: `vector.ts`, `wallLoop.ts`, `placeableWalls.ts` (the doorway feature's wall-enumeration seam), `roomCascade.ts` (single room-deletion cascade), `openingPairs.ts` (where doorway-pairing writers land), `planPreview.ts` (drag-preview composition out of PlanView), `signedAreaMm2` into `polygon.ts`.
- **Bug fixed**: wall-slide chips pointed the wrong way on concave rooms (centroid heuristic); one canonical `outwardWallNormal` now.
- **Landmines defused**: `removePlacement`/`removeSelectedPlacements` clear opening partner refs, and the shipped connection writers preserve the same reciprocal invariant during connect, re-pair, disconnect, and undo.
- **View layer**: all ten drag machines in PlanView/ElevationView share `useDragGesture`; PlanView −450 lines net.
- **App/store**: `usePlanMode` union (doorway pairing adds a `pairOpenings` variant there, one place), `commitWallObjectEdit`/`runPartitionEdit` pipelines, `commitPlanMove` split into four named cases.
- **3D loading**: Three.js and the React Three Fiber stack are isolated behind the lazy `ThreeDView` route. The eager vendor chunk is 148.87 kB gzip; the 223.14 kB gzip 3D chunk is fetched only when 3D opens, with a build-time eager-graph assertion protecting the boundary.
- **Deliberately deferred**: rectangle↔polygon edit-pipeline merge — ~~an explicit decision gate behind the "rectangle resize characterization (pipeline-merge gate)" suites in `editRoom.test.ts`/`store.test.ts`~~ **shipped 2026-07-12**: `resizeWallPreservingAngles` now delegates into `moveRoomWall` (anchor "start" slides the next wall, "end" slides the previous — the end-anchor placement-offset compensation is gone; offsets are never touched). The gate suites passed unmodified and now pin the wrapper's contract. Still deferred to the doorway slice: PlanView single-`mode` prop, room-qualified hover ids, and schema v4 tightening (`MIN_ENDPOINT_SPACING_MM`, `wallId` cross-check — bundle with the pairing migration).

## iPad/touch support pass (shipped 2026-07-09)

Touch drag-and-drop for artwork placement, insecure-context support for LAN dev testing, and topbar responsiveness: 3 commits, typecheck green, tests 1065 → 1087.

- **Touch drag-and-drop**: iPhone Safari lacks HTML5 drag-and-drop; iPadOS Safari unreliably fires `drop`. New `artworkDragSession.ts` module with parallel pointer-event path: long-press checklist rows (300ms, 10px slop), floating thumbnail preview, shared snap ghost, release places. Desktop HTML5 DnD hardened with standard payload, session fallback, and artwork-id validation. Verified on-device (iOS) and via CDP.
- **Insecure-context (plain-http LAN) support**: `crypto.subtle.digest` and `crypto.randomUUID` are secure-context-only. New `src/domain/assets/sha256.ts` (WebCrypto when available; pure FIPS 180-4 fallback with bit-identical digest for duplicate detection) and `src/domain/id.ts` (`newId()` function with UUID v4 fallback, replacing nine call sites). Production HTTPS uses native fast paths; fallbacks dead code.
- **Error surface hardening**: `addArtworksFromFiles` and `importArtworkDrafts` now catch and surface intake errors in the error banner instead of failing silently.
- **Topbar responsive at ≤1040px**: single-line icon-only layout; Plan/Elevation/3D tab labels, Export label, and save-badge text collapse to visually-hidden spans (accessible names preserved); colored save dot remains.

## Foundation Refactor (shipped 2026-07-12)

KISS/DRY foundation pass: 4 commits, all phases green (1,453 tests, no test modified). Motivation: groundwork for MVP3 (PNG/PDF exports, §13 import-safety pipeline) and MVP4 (tablet, better inspector).

- **Shared image-intake seam** (`domain/assets/intakeImageFile.ts`): `addArtworksFromFiles` and `importArtworkDrafts` unified around `processImageFile`/`buildImageAsset`. Saves stay caller-owned (quick-add gates on duplicate-hash, drafts fold into their error shape). Package import untouched — validates foreign pre-processed bytes, not fresh uploads. Foundation for the §13 import-safety hardening pipeline.
- **Pure 2D scene builders** (`domain/scene2d/planScene.ts`, `elevationScene.ts`): `buildPlanScene` (rooms, partitions, connection glyphs, wall/floor object rects) and `buildElevationScene` (placements/openings, rect + bounds math, floor/centerline Y) now derive static render primitives as plain data. Views map to SVG instead of deriving inline. Drag previews reuse `getRenderedWallObjectPlanRect` and `isArtworkOutOfWallBounds` — mid-drag and at-rest can't disagree. 15 new characterization suites. Foundation for PNG/PDF export: exports consume the same builders views render from, so print can never drift from screen.
- **Store-connected views and toolbar extraction** (App.tsx 2,794 → 1,977 lines): PlanView reads 15 former props and ElevationView 6 via narrow useAppStore selectors (SettingsDialog subscription pattern, one value per selector, stable action refs). Ownership line: anything App composes stays a prop (allowOverlappingPlacement wrappers, marquee selection ids, derived ids). Toolbar pickers move to `components/toolbar/` with Compact/full twins merged behind a variant prop (ClusterPicker, markup/classes/tooltips/kbd preserved verbatim). WorkspaceFocus.test.tsx seeded the store and stubbed jsdom missing SVG methods; marquee wiring live in view now.
- **PlanView rendering split into layer components** (PlanView.tsx 3,403 → 2,398 lines): new `components/plan/` directory with PlanStructureLayer (walls/hit polygons/partition slabs), PlacedObjectsLayer (connection glyphs, wall+floor object rects + drag-preview), PlanHandlesLayer (room wash, resize/reshape/slide handles, wall/partition labels), PlanOverlaysLayer (draw previews, tool/drop ghosts, snap guides, marquee), and shared `types.ts` (11 gesture-state types). Every hook, drag machine, handler stayed in PlanView — layers are render-only, JSX relocated not restructured, SVG paint order and handler attachment points preserved exactly. Room-fill polygons and GridOverlay stay inline (grid paints between fills and structure).
- **Deliberately deferred** (KISS/YAGNI — revisit on demand): store.ts slicing (applyEdit spine is sound), inspector components (MVP4 rework scheduled), doorway-slice deferrals (single-mode prop, room-qualified hover ids, schema v4 tightening).

## Quick-Todos Batch (shipped 2026-07-12, five concurrent slices)

Five parallel agent slices merged sequentially, all green (tests 1477 → 1502). Full detail in `docs/quick-todos.md` Done section.

- **Doors pinned to the floorline in elevation**: placement ignores pointer y for doors (ghost rides the floor), `moveOpening` hard-clamps `yMm = heightMm/2`, height edits keep the bottom grounded, door inspector hides the pinned Y field. Windows/blocked-zones untouched.
- **Toasts (shadcn sonner)**: export success/failure, import success/warnings/failure, and placed-checklist-row drag attempts now toast; import successes no longer misuse the red error banner. Placed rows warn only on an actual drag (press travels past slop or escapes the row) — plain selection clicks stay silent. Overrides scoped under `.sonner-toaster` so they beat sonner's runtime stylesheet; white card, semantic color on icon/border only.
- **Elevation wall switcher redesign** (`WallSwitcher.tsx`): current room's perimeter walls inline + indented Partitions section (faces via `getRoomPlaceableWalls`), other rooms as DropdownMenu submenus, flat list single-room, "Room · Wall" trigger when multi-room; prev/next steps perimeter → faces → next room. New Sub/Radio wrappers in `ui/dropdown-menu.tsx`.
- **Project manager modal** (`ProjectManager.tsx`): open/inline-rename/two-step-delete/quick-export per row without opening the project (`renameProjectById`, `exportProjectPackageById` sharing `buildPackageZip`); `ProjectSummary` gained roomCount/artworkCount populated cheaply in `toProjectSummary`.
- **Partition alignment package** (clearance model reworked same day after user review): `partitionSpacing.ts` four-sided face-accurate clearances — normal gaps from the slab faces, span gaps from the endpoints — against perimeter + other partitions' slabs (partitions count as boundaries for dims, snapping, and centering); Center between walls / Center along span inspector actions through `runPartitionEdit` (undo free); move-drag snapping to per-axis equidistant-between-neighbors (snapped position reads equal gaps; skipped >15° off-axis) and sibling-partition midpoints via the existing `.snap-guide` chain; endpoint wall-kiss (Shift-lock > wall-kiss > grid); `PartitionDimensionLines.tsx` shows all four side gaps at rest, motion-latched per axis during move drags; centering buttons read "Center left–right"/"Center up–down" (`partitionAxisForWorldAxis`); partition snap guides clip to the room bounds (`Guide.extentMm`).

## Shipped 2026-07-10 → 2026-07-12 (64 commits on main; tests 1117 → 1334, all green)

- **3D navigation overhaul**: cursor-directed wheel dolly, WASD travel with idle-gap step capping, double-click focus flights (including empty-space focus), one-finger touch pan + ground-plane panning, focus selection, and renderer metrics. Tunables live in `cameraNav.ts`; verification levers are `__sightlines3d` and `?benchmark=renderer`.
- **Rectangle-room draw gesture + Draw toolbar cluster**: `R` = rectangle, `⇧R` = outline (polygon), drawn-rectangle domain factory and store action, corner-bracket glyph. Toolbar reorganized around an Insert-decorates / Draw-creates grammar: the Draw cluster leads, partition moved out of Insert into Draw, generic `.tool-cluster` pickers extracted, one 30px control lane.
- **Soft-tactile UI pass** (spec/soft-tactile-ui merged): recessed tracks with raised sliding chips, pressed toggle grammar, sliding petrol underline top nav, styled toolbar tooltips with entrance animation, Insert as pressed tool buttons, soft treatment extended to inspector pickers, help dialog, and zoom cluster.
- **Cross-project artwork library view** plus a persistent inspector visibility toggle with engaged/collapsed styling.
- **Framing + matting previews**: additive `matWidthMm` + `frame` on the artwork record (no schema bump); elevation draws frame ring → mat ring → image with bevel hairline; plan widens the along-wall extent to the outer size; editable Overall W×H solves for the frame band; artwork inspector reworked into collapsible sections with persisted open state. Framing contract Phases 1–4 now keep stored placement dimensions image-sized while wall validation, snapping, selection, grouping, fit-selected, arrangement, neighbor detection, spacing readouts, and dimension lines measure outer framed footprints. Tooltip/inspector dual-size copy and 3D camera standoff remain Phase 5; floor framing remains deferred pending a representation decision.
- **Neighbor-aware dim lines** in the between-works tab: outer dim lines stop at the nearest neighbor edge (falling back to the wall edge), with per-side calculated distance readouts in the inspector.
- **Settings dialog** with storage-persistence hook, durable-storage request, and elevation empty-state treatment.
- **Context-aware help dialog** on the shared UI primitives.
- **Test corpus + import intelligence**: Rijksmuseum and Art Institute of Chicago artwork metadata fixtures with download script (physical dimensions included), and `guessColumnMapping` handling for camelCase/PascalCase spreadsheet headers.
- **`.sightlines` package export slice** (2026-07-12, import deferred): schema-versioned `SightlinesPackage` manifest (`src/domain/schema/packageSchema.ts`) with content-addressed, per-tier asset inventory (sha256/byteSize/mimeType/path); pure async derivation (`src/domain/package/buildPackage.ts`) selecting the referenced-artwork subset and three export modes (`originals` / `display` default / `metadata-only`); fflate zip writer storing image blobs uncompressed and deflating JSON; `exportProjectPackage(mode)` store action; topbar Export dropdown plus Settings "Export backup" wired to the display-tier package. Format documented in `docs/package-format.md`.
- **`.sightlines` package import slice** (2026-07-12): the full untrusted-file pipeline (docs/plan.md §13) — pre-inflation zip caps + path-traversal rejection (`extractPackage.ts`), staged manifest parse (lenient envelope → migrate embedded docs via the existing project/artwork chains → strict validation), per-blob re-hash/MIME-allowlist/dimension guards with graceful per-asset degradation, and the §6 merge rules (`importPackage.ts`): identical-content reuse, one-step keep-mine/use-theirs/keep-both conflict review dialog, sha256 dedupe against the local library (with automatic re-link for metadata-only packages), and import-as-new-project on id collision. One topbar Import control detects package-vs-JSON by content. Import behavior documented in `docs/package-format.md`.

## Repo Health Pass (2026-07-17, multi-agent review + reorg)

Two reviewers swept `496daba..HEAD` (the July 15–17 work: PDF export pipeline, saved views/snapshots, wall-length anchors, bulk mat/frame, keyboard nudging, spreadsheet-import dimensions, WebGL snapshot management), an architecture agent mapped the refactor surface, and two implementation agents restructured the code. Landed:

- **Component reorg** (`f89fc07`): the ~102 flat files in `src/app/components/` moved into `dialogs/`, `elevation/`, `imports/`, `inspectors/`, `library/`, `measurement/`, `panels/`, `plan/`, `shared/` (+ existing `three/`, `toolbar/`, `ui/`). Pure `git mv` renames + import rewrites; root keeps only AppRail, FontLab, WorkspaceFocus.test.
- **PDF export survives a failed 3D render** (`6708dc7`): a rejected `renderSavedView` (renderer not yet mounted, WebGL context loss mid-batch) used to throw away the whole document; the 3D page now degrades to the missing-artwork placeholder + warning pattern. Dead `ui/toggle-group.tsx` and `inspectors/InspectorDisclosure.tsx` removed in the same commit.
- **Selection-identity resets** (`088aa15`): bulk mat/frame draft and the Remove-all confirmation reset on selection *identity* (new `selectionKey` prop), not count — reselecting a different same-size set can no longer inherit a stale draft or an armed destructive confirm.
- **store.ts slice extractions** (3,924 → 3,048 lines): five groups moved into `src/app/store/` following the `arrangeSlice` internals-bag pattern — `documentMetaSlice` (saved views + reference measurements), `selectionSlice` (all 11 selection actions), `projectManagerSlice`, `openingEdits` (nine pure opening helpers), and `packageSlice` (package import/export incl. `buildPackageZip`/`commitPackageImport`). Undo/redo core, `EditEntry`/`EditExtras`, and every public export stayed in store.ts; `store.test.ts` passed untouched.

Review verdicts that held up under real scrutiny (no action needed): wall-length anchor math (proven anchor-invariant), saved-view thumbnail cache races, the Export-menu `modal={false}` freeze fix (root cause, not paper-over), plan-nudge keyboard guards vs. existing shortcuts, `updateArtworksMatFrame` undo halves, WebGL context lifecycle in SnapshotStage/SavedViewRenderHost, and spreadsheet dimension parsing (incl. mm-vs-cm bare numbers and UTC-safe xlsx dates).

### Deferred from this pass (address later)

- **Elevation pinch-during-measurement (touch-only, plausible)**: `ElevationView.handleSvgPointerDownCapture` gives Measure first refusal, so `useSvgViewportGestures` never records the primary touch and two-finger pinch-zoom cannot start while a one-finger measurement gesture is in flight (Plan is correct: hook gets first refusal and cancels the measurement via `shouldCancelMeasurementForViewportClaim`, which Elevation never calls). Fix by mirroring Plan's ordering; needs the still-open iPad verification pass — don't reorder gesture capture blind.
- **PDF 3D mount-race hardening**: `handleExportPdf` fires `renderSavedView` without awaiting `SavedViewRenderHost` mount (lazy three chunk; idle-prefetch is a soft mitigation). The new placeholder fallback makes this non-fatal, but awaiting readiness/one retry when 3D pages are selected would produce the real page instead of a placeholder on fresh fast sessions.
- **store.ts remaining slices**: room/wall geometry (~1301–2036, needs `runPartitionEdit` + wall-placement validation in the internals bag) and artwork intake/library (~2334–2762, repository deps + cross-project delete cascade) are extractable but each wants its own session. Artwork editing, placement/openings, and the undo/redo transaction core (`applyEdit`/`pushEditEntry`/`persist`/`setDocument`) stay in store.ts as the kernel — do not extract. Optional: `store/types.ts` for `AppState`/`EditExtras` to break the (type-only, harmless) store⇄slice import cycle.
- **App.tsx extractions** (unblocked now that the reorg landed): dialog-host block → `<AppDialogs>`, topbar → `<TopBar>`, `ProjectTitleInput` + tail helpers → own files; and App's selector-less `useAppStore()` destructure (~110 fields → re-render on every store write) → narrow selectors. Perf/structure, not correctness.
- **`exportProjectJson`** (store.ts) is test-only — production export goes through packages; retire into a test helper when convenient.
- **Small notes**: the >900 kB pdf chunk build warning is pre-existing and acknowledged; `elevation/GroupDimensionLines` still imports `../plan/labelStagger` (existing cross-feature edge — candidate for `shared/` if it grows); export scale/JPEG-quality constants are intentionally duplicated between `captureSnapshot.ts` and `SnapshotStage.tsx` per spec §10.4 (skip consolidating).

## Near-Term Order

1. MVP package/export work: `.sightlines` **export and import** shipped 2026-07-12 (format + import behavior in `docs/package-format.md`) — next, the prominent backup flow, PNG/PDF exports (including the deferred 3D screenshot), and readiness reporting.
2. Multi-room placement and management polish around the shared floor coordinate space.
3. Run the 10-room / 200-work renderer benchmark fixture on desktop and tablet; defer room-visibility filtering until measurements show a material whole-floor 3D cost. Overview remains whole-floor; any future scope belongs to eye-level rendering and the render layer only.

## Known Follow-Ups

- Overlapping door/window holes on one wall triangulate with minor artifacts (see `docs/archive/3d-preview-spec.md` §10); the domain already flags overlapping placements for review.
- Eye height uses `project.defaultCenterlineHeightMm` as a proxy; add a per-project `eyeHeightMm` if users trip on it.
- Duplicate artwork/image import prevention is planned but not yet enforced across the new wizard path.

## Deferred

Curved walls, full 3D editing, hosted accounts/collaboration, and registrar-level collection management remain out of the near-term product scope.

Deliberately skipped in the 2D zoom/pan MVP (revisit only on demand): ⌘+/⌘− zoom shortcuts (conflict with browser page zoom), double-click-to-fit, pan-distance clamping, and viewport persistence across sessions.
