# Sightlines Status Snapshot

Last refreshed: 2026-07-06

## Current Read

MVP 1A and 1B are effectively complete, and MVP 1C is now mostly through its 2D planning behaviors. Multi-select, group drag, equal wall distribution, floor objects in plan view, checklist filtering/sorting, and the 2D workflow confidence fixes are done.

The next best major slice is the simple derived 3D preview. It should stay a disposable projection of project data, like Plan and Elevation, and should not introduce 3D editing yet.

## Near-Term Order

1. Simple derived 3D preview.
2. Small 2D polish scraps from `docs/quick-todos.md` if they block confidence during 3D work.
3. MVP2 package/export work: `.sightlines` import/export, backup flow, PNG/PDF exports, and readiness reporting.

## Deferred

Vertex-level dragging for non-rectangular rooms remains gated on designing a reshape mode. MVP2 `.sightlines` package/export work should wait until the core MVP1 planning loop, including 3D preview, feels stable.
