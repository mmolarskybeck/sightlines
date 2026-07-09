# Sightlines Status Snapshot

Last refreshed: 2026-07-09

## Current Read

MVP 1A and 1B are effectively complete, and MVP 1C has shipped its 2D planning behaviors **and the simple derived 3D preview**. The 3D mode shipped per `docs/3d-preview-spec.md`: a read-only projection (pure `scene3d.ts` derivation → R3F dollhouse room shell, textured artwork planes, door/window cutouts, floor boxes, blocked zones, partition slabs, shared uncertainty language), click-to-select synced with the shared store, and animated Overview / Eye-level camera presets. No 3D editing — the inspector remains the numeric editing surface in 3D mode.

Room-shape slices 1-3 have shipped: the fast rectangle path remains, polygon room drawing/reshape is live, wall split/delete and wall-slide reshaping are in place, and free-standing partition walls are schema v3 room-owned objects with derived double-sided faces. Recent follow-up fixes hardened focus ownership for SVG/workspace interactions and global shortcuts, so focused inputs, selects, and resize handles keep their own keys.

The import surface is also beyond one-off image upload now: the Import wizard supports images-only, spreadsheet metadata, and combined image + metadata intake with map/review steps and image matching. Static public info/trust pages now live under `public/` (`about.html`, `privacy.html`, `security.html`, `it.html`, plus crawler/security metadata) and are linked from the left-rail Help surface.

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
