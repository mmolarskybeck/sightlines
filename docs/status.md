# Sightlines Status Snapshot

Last refreshed: 2026-07-09

## Current Read

MVP 1A and 1B are effectively complete, and MVP 1C has shipped its 2D planning behaviors **and the simple derived 3D preview**. The 3D mode shipped per `docs/3d-preview-spec.md`: a read-only projection (pure `scene3d.ts` derivation → R3F dollhouse room shell, textured artwork planes, door/window cutouts, floor boxes, blocked zones, partition slabs, shared uncertainty language), click-to-select synced with the shared store, and animated Overview / Eye-level camera presets. No 3D editing — the inspector remains the numeric editing surface in 3D mode.

Room-shape slices 1-3 have shipped: the fast rectangle path remains, polygon room drawing/reshape is live, wall split/delete and wall-slide reshaping are in place, and free-standing partition walls are schema v3 room-owned objects with derived double-sided faces. Recent follow-up fixes hardened focus ownership for SVG/workspace interactions and global shortcuts, so focused inputs, selects, and resize handles keep their own keys.

The import surface is also beyond one-off image upload now: the Import wizard supports images-only, spreadsheet metadata, and combined image + metadata intake with map/review steps and image matching. Static public info/trust pages now live under `public/` (`about.html`, `privacy.html`, `security.html`, `it.html`, plus crawler/security metadata) and are linked from the left-rail Help surface.

## Consolidation Pass (shipped 2026-07-09)

Post-irregular-rooms refactor: 20 commits, all phases green (1065 tests, up from 957). Highlights:

- **New domain modules**: `vector.ts`, `wallLoop.ts`, `placeableWalls.ts` (the doorway feature's wall-enumeration seam), `roomCascade.ts` (single room-deletion cascade), `openingPairs.ts` (where doorway-pairing writers land), `planPreview.ts` (drag-preview composition out of PlanView), `signedAreaMm2` into `polygon.ts`.
- **Bug fixed**: wall-slide chips pointed the wrong way on concave rooms (centroid heuristic); one canonical `outwardWallNormal` now.
- **Landmines defused**: `removePlacement`/`removeSelectedPlacements` now clear opening partner refs (matters once `connectsToObjectId` gets writers).
- **View layer**: all ten drag machines in PlanView/ElevationView share `useDragGesture`; PlanView −450 lines net.
- **App/store**: `usePlanMode` union (doorway pairing adds a `pairOpenings` variant there, one place), `commitWallObjectEdit`/`runPartitionEdit` pipelines, `commitPlanMove` split into four named cases.
- **Deliberately deferred**: rectangle↔polygon edit-pipeline merge is an explicit decision gate behind the "rectangle resize characterization (pipeline-merge gate)" suites in `editRoom.test.ts`/`store.test.ts` — evaluate delegating into `moveRoomWall` only against those pinned promises. Also deferred to the doorway slice: PlanView single-`mode` prop, room-qualified hover ids, and schema v4 tightening (`MIN_ENDPOINT_SPACING_MM`, `wallId` cross-check — bundle with the pairing migration).

## iPad/touch support pass (shipped 2026-07-09)

Touch drag-and-drop for artwork placement, insecure-context support for LAN dev testing, and topbar responsiveness: 3 commits, typecheck green, tests 1065 → 1087.

- **Touch drag-and-drop**: iPhone Safari lacks HTML5 drag-and-drop; iPadOS Safari unreliably fires `drop`. New `artworkDragSession.ts` module with parallel pointer-event path: long-press checklist rows (300ms, 10px slop), floating thumbnail preview, shared snap ghost, release places. Desktop HTML5 DnD hardened with standard payload, session fallback, and artwork-id validation. Verified on-device (iOS) and via CDP.
- **Insecure-context (plain-http LAN) support**: `crypto.subtle.digest` and `crypto.randomUUID` are secure-context-only. New `src/domain/assets/sha256.ts` (WebCrypto when available; pure FIPS 180-4 fallback with bit-identical digest for duplicate detection) and `src/domain/id.ts` (`newId()` function with UUID v4 fallback, replacing nine call sites). Production HTTPS uses native fast paths; fallbacks dead code.
- **Error surface hardening**: `addArtworksFromFiles` and `importArtworkDrafts` now catch and surface intake errors in the error banner instead of failing silently.
- **Topbar responsive at ≤1040px**: single-line icon-only layout; Plan/Elevation/3D tab labels, Export label, and save-badge text collapse to visually-hidden spans (accessible names preserved); colored save dot remains.

## Near-Term Order

1. Paired door/window connections: add writers for `connectsToObjectId`, derived aligned/misaligned status, inspector UI, and deletion/cleanup flows — slices 4-5 of `docs/room-shapes-spec.md`.
2. 3D see-through openings for aligned paired doors/windows; keep the current-room-plus-visible-connected-rooms rendering strategy before attempting whole-floor 3D.
3. MVP package/export work: `.sightlines` import/export, backup flow, PNG/PDF exports (including the deferred 3D screenshot), and readiness reporting.

## Known Follow-Ups

- three.js currently ships in the eager `vendor` chunk (`vite.config.ts` `manualChunks` routes all of `node_modules` there), so ~350 kB gzip downloads even for users who never open 3D. Worth a dedicated code-splitting pass.
- Overlapping door/window holes on one wall triangulate with minor artifacts (see `docs/3d-preview-spec.md` §10); the domain already flags overlapping placements for review.
- Eye height uses `project.defaultCenterlineHeightMm` as a proxy; add a per-project `eyeHeightMm` if users trip on it.
- `.sightlines` package import/export still needs the untrusted-file safety pipeline before becoming the main backup/share surface.
- Duplicate artwork/image import prevention is planned but not yet enforced across the new wizard path.

## Deferred

Curved walls, full 3D editing, hosted accounts/collaboration, and registrar-level collection management remain out of the near-term product scope.
