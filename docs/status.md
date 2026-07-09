# Sightlines Status Snapshot

Last refreshed: 2026-07-08

## Current Read

MVP 1A and 1B are effectively complete, and MVP 1C is through its 2D planning behaviors **and the simple derived 3D preview**. The 3D mode shipped per `docs/3d-preview-spec.md`: a read-only projection (pure `scene3d.ts` derivation → R3F dollhouse room shell, textured artwork planes, door/window cutouts, floor boxes, blocked zones, shared uncertainty language), click-to-select synced with the shared store, and animated Overview / Eye-level camera presets. No 3D editing — the inspector remains the numeric editing surface in 3D mode.

The next best major slice is room shape tools before deeper doorway connections: keep the fast rectangle path, add polygon room drawing, then add polygon reshape/vertex dragging. The 3D derivation already iterates room polygons generically (non-rectangular fixture tests are in place), so polygon rooms should project into 3D unchanged.

## Near-Term Order

1. ~~Room shape tools~~ **Shipped 2026-07-08**: polygon room drawing, reshape (vertex drag, wall split, vertex merge), and free-standing partition walls with double-sided faces on schema v3 — slices 1–3 of `docs/room-shapes-spec.md`.
2. Multi-room flow: paired door/window connections (`connectsToObjectId` — type/schema landed with v3, still zero writers) and 3D see-through openings — slices 4–5 of `docs/room-shapes-spec.md`.
3. MVP package/export work: `.sightlines` import/export, backup flow, PNG/PDF exports (incl. the deferred 3D screenshot), and readiness reporting.

## Known Follow-Ups From the 3D Slice

- three.js currently ships in the eager `vendor` chunk (`vite.config.ts` `manualChunks` routes all of `node_modules` there), so ~350 kB gzip downloads even for users who never open 3D. Worth a dedicated code-splitting pass.
- Overlapping door/window holes on one wall triangulate with minor artifacts (see `docs/3d-preview-spec.md` §10); the domain already flags overlapping placements for review.
- Eye height uses `project.defaultCenterlineHeightMm` as a proxy; add a per-project `eyeHeightMm` if users trip on it.

## Deferred

Vertex-level dragging for non-rectangular rooms remains gated on polygon room creation and a dedicated reshape mode. Package/export work should wait until the basic irregular-room story feels stable.
