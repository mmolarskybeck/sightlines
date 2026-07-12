# Sightlines Status

Last refreshed: 2026-07-12

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
- **Deliberately deferred**: rectangle↔polygon edit-pipeline merge is an explicit decision gate behind the "rectangle resize characterization (pipeline-merge gate)" suites in `editRoom.test.ts`/`store.test.ts` — evaluate delegating into `moveRoomWall` only against those pinned promises. Also deferred to the doorway slice: PlanView single-`mode` prop, room-qualified hover ids, and schema v4 tightening (`MIN_ENDPOINT_SPACING_MM`, `wallId` cross-check — bundle with the pairing migration).

## iPad/touch support pass (shipped 2026-07-09)

Touch drag-and-drop for artwork placement, insecure-context support for LAN dev testing, and topbar responsiveness: 3 commits, typecheck green, tests 1065 → 1087.

- **Touch drag-and-drop**: iPhone Safari lacks HTML5 drag-and-drop; iPadOS Safari unreliably fires `drop`. New `artworkDragSession.ts` module with parallel pointer-event path: long-press checklist rows (300ms, 10px slop), floating thumbnail preview, shared snap ghost, release places. Desktop HTML5 DnD hardened with standard payload, session fallback, and artwork-id validation. Verified on-device (iOS) and via CDP.
- **Insecure-context (plain-http LAN) support**: `crypto.subtle.digest` and `crypto.randomUUID` are secure-context-only. New `src/domain/assets/sha256.ts` (WebCrypto when available; pure FIPS 180-4 fallback with bit-identical digest for duplicate detection) and `src/domain/id.ts` (`newId()` function with UUID v4 fallback, replacing nine call sites). Production HTTPS uses native fast paths; fallbacks dead code.
- **Error surface hardening**: `addArtworksFromFiles` and `importArtworkDrafts` now catch and surface intake errors in the error banner instead of failing silently.
- **Topbar responsive at ≤1040px**: single-line icon-only layout; Plan/Elevation/3D tab labels, Export label, and save-badge text collapse to visually-hidden spans (accessible names preserved); colored save dot remains.

## Shipped 2026-07-10 → 2026-07-12 (64 commits on main; tests 1117 → 1334, all green)

- **3D navigation overhaul**: cursor-directed wheel dolly, WASD travel with idle-gap step capping, double-click focus flights (including empty-space focus), one-finger touch pan + ground-plane panning, focus selection, and renderer metrics. Tunables live in `cameraNav.ts`; verification levers are `__sightlines3d` and `?benchmark=renderer`.
- **Rectangle-room draw gesture + Draw toolbar cluster**: `R` = rectangle, `⇧R` = outline (polygon), drawn-rectangle domain factory and store action, corner-bracket glyph. Toolbar reorganized around an Insert-decorates / Draw-creates grammar: the Draw cluster leads, partition moved out of Insert into Draw, generic `.tool-cluster` pickers extracted, one 30px control lane.
- **Soft-tactile UI pass** (spec/soft-tactile-ui merged): recessed tracks with raised sliding chips, pressed toggle grammar, sliding petrol underline top nav, styled toolbar tooltips with entrance animation, Insert as pressed tool buttons, soft treatment extended to inspector pickers, help dialog, and zoom cluster.
- **Cross-project artwork library view** plus a persistent inspector visibility toggle with engaged/collapsed styling.
- **Framing + matting previews**: additive `matWidthMm` + `frame` on the artwork record (no schema bump); elevation draws frame ring → mat ring → image with bevel hairline; plan widens the along-wall extent to the outer size; editable Overall W×H solves for the frame band; artwork inspector reworked into collapsible sections with persisted open state. Known limitation: elevation snapping, dim lines, out-of-bounds, and fit-selected still use image dims, not outer framed size.
- **Neighbor-aware dim lines** in the between-works tab: outer dim lines stop at the nearest neighbor edge (falling back to the wall edge), with per-side calculated distance readouts in the inspector.
- **Settings dialog** with storage-persistence hook, durable-storage request, and elevation empty-state treatment.
- **Context-aware help dialog** on the shared UI primitives.
- **Test corpus + import intelligence**: Rijksmuseum and Art Institute of Chicago artwork metadata fixtures with download script (physical dimensions included), and `guessColumnMapping` handling for camelCase/PascalCase spreadsheet headers.
- **`.sightlines` package export slice** (2026-07-12, import deferred): schema-versioned `SightlinesPackage` manifest (`src/domain/schema/packageSchema.ts`) with content-addressed, per-tier asset inventory (sha256/byteSize/mimeType/path); pure async derivation (`src/domain/package/buildPackage.ts`) selecting the referenced-artwork subset and three export modes (`originals` / `display` default / `metadata-only`); fflate zip writer storing image blobs uncompressed and deflating JSON; `exportProjectPackage(mode)` store action; topbar Export dropdown plus Settings "Export backup" wired to the display-tier package. Format documented in `docs/package-format.md`.
- **`.sightlines` package import slice** (2026-07-12): the full untrusted-file pipeline (docs/plan.md §13) — pre-inflation zip caps + path-traversal rejection (`extractPackage.ts`), staged manifest parse (lenient envelope → migrate embedded docs via the existing project/artwork chains → strict validation), per-blob re-hash/MIME-allowlist/dimension guards with graceful per-asset degradation, and the §6 merge rules (`importPackage.ts`): identical-content reuse, one-step keep-mine/use-theirs/keep-both conflict review dialog, sha256 dedupe against the local library (with automatic re-link for metadata-only packages), and import-as-new-project on id collision. One topbar Import control detects package-vs-JSON by content. Import behavior documented in `docs/package-format.md`.

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
