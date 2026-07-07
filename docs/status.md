# Sightlines Status Snapshot

Last refreshed: 2026-07-06

## Current Read

MVP 1A and 1B are effectively complete, and MVP 1C is now mostly through its 2D planning behaviors. Multi-select, group drag, equal wall distribution, floor objects in plan view, checklist filtering/sorting, and the 2D workflow confidence fixes are done.

The next best major slice is the simple derived 3D preview. It should stay a disposable projection of project data, like Plan and Elevation, and should not introduce 3D editing yet. After that, prioritize room shape tools before deeper doorway connections: keep the fast rectangle path, add polygon room drawing, then add polygon reshape/vertex dragging.

## Near-Term Order

1. Simple derived 3D preview — spec approved, see `docs/3d-preview-spec.md`.
2. Room shape tools: polygon room drawing, then polygon reshape/vertex dragging.
3. Multi-room flow: additional room placement, paired door connections, and 3D sightlines through aligned doorways.
4. MVP package/export work: `.sightlines` import/export, backup flow, PNG/PDF exports, and readiness reporting.

## Deferred

Vertex-level dragging for non-rectangular rooms remains gated on polygon room creation and a dedicated reshape mode. Package/export work should wait until the core planning loop includes 3D preview and the basic irregular-room story feels stable.
