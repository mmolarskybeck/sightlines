# Quick Todos

Small, actionable scraps that don't fit the roadmap (`docs/plan.md` §9) or the Near-Term Order in `docs/status.md`. Cross an item off by deleting it — shipped work is recorded in `docs/status.md`, not here.

## UI / UX

* Polish the single-artwork inspector view and move Arrange higher up so it is easier to reach.
* Plan-view placement rectangles are still hard to see; petrol may be the wrong wall-select color (not enough contrast against black).
* Dimension lines only appear on selection. Add an always-visible option (elevation: spacing between every object on the visible wall, with intelligent changes on drag), and a switchable floor-to-bottom-of-work dimension family — noisy most of the time, wanted on PDF/PNG export.
* Hand tool for plan/elevation: 2D pan is gesture-only (space-drag, middle/right-drag). If the 3D hand tool tests well, add the same button for consistency.

## Project management

* Bulk edit of projects in the project manager.
* Preview image per project row (overhead 3D or plan-view thumbnail).

## Display types and floor objects (deferred from the 2026-08-28 feedback round)

* Pedestal options: colors/materials. Stretch: a standalone plinth floor object that other supports/works can stack on; independent plan drag of the support rect (today the assembly is one hit target and the offset is typed in the inspector); a bonnet footprint distinct from the pedestal's.
* More display types: wall-mounted flatscreen (slim black bezel, no frame options), projection with a soft-edged image or projector-beam glyph. Both are approximable today as plain wall works — build only when the approximation falls short.
* Medium auto-detect nudge: a one-time "Looks like a video work — display as monitor?" suggestion. Rejected as the primary mechanism; fine as a discoverability nudge.
* CRT niceties: screen glow/emissive so a "playing" monitor reads as lit in 3D; multi-monitor stacks and video walls.
* Elevation ghosts for floor-resting works (`baseHeightMm = 0`) with nothing under them — monitors and supported works now draw one; generalize to the remaining bare-floor artworks.

## Mobile / phone view

* Room-drawing tool needs better touch feedback and a way to undo or move a point; iOS currently seems to need one gesture to draw the line and another to place the point.
* No Backspace on touch: a floating delete button, or a long-press context menu with delete.
* If the scale dropdown moves to the main nav, the whole toolbar may fit.
* Consider a narrower left rail.
* On phones or very small viewports, make checklist, rooms & walls, and the inspector into sheets/drawers.
