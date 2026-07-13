# Quick Todos

Here is where I gather small, actionable tasks and scraps for future implementation, things that don't fit cleanly into the overall roadmap and aren't necessarily part of major features.

## Open Scraps

### ui / ux

* polish single artwork inspector view and make arrange higher up so it's easier to access / has better ui/ux?

## project management

* bulk edit of projects in the project manager?
* add preview image to project management? either a 3d preview overhead view or plan view preview?

## possible adds

* By default, dimension lines currently appear when objects/works are selected, but we should have an option to have these visible all the time (w maybe intelligent changes on drag, to change which dims are visible?) - by default this would show the spacing in between every object/artwork on the visible wall (in elevation mode)
* and a way to switch on other dimension lines being visible, line the space from the floor to the bottom of each work? this is noisy most of the time but there are scenarios where you’d want to see it (especially also on export as pdf or elevation png)

## mobile / phone view

* Drawing room tool - needs better feedback, way to unplace a point or rearrange it maybe? Easy to make mistakes (current behavior on touch/iOS seems to require one gesture to draw line, and a second one to place the point down? This feels a bit weird but idk how to improve it)
* No backspace so we have a little floating delete button OR maybe better context menu on long press to delete?
* If we remove scale dropdown or move it up to main nav bar, or somewhere, maybe we have room for whole toolbar
* Consider making left rail a bit narrower ?
* for phones or very small viewports, we should make checklist, rooms & walls, and the inspector into sheets/drawers

### 3d objects & sculptures

* add plinths and make floor objects placeable on top of them?
* 3d/floor objects need a way to be rotated

## Done / Folded Back Into Status

(Shipped items are summarized in `docs/status.md`; fuller detail kept here until it stops being useful.)

* (2026-07-12 batch) Doors pinned to the floorline in elevation: elevation placement ignores pointer y for doors (ghost rides the floor), `moveOpening` hard-clamps door `yMm = heightMm/2`, height edits keep the bottom on the floor, and the door inspector hides the pinned Y field. Windows/blocked-zones untouched.
* (2026-07-12 batch) Toasts via shadcn sonner (`ui/sonner.tsx`, light theme, bottom-center; overrides scoped under `.sonner-toaster` beat sonner's runtime stylesheet; no richColors — white card, semantic color on icon/border only). Export success/failure and import success/warnings/failure now toast (import successes no longer misuse the red error banner). Placed checklist rows warn via toast on an actual drag attempt — press must travel past the touch-drag slop or escape the row while held; a plain selection click stays silent.
* (2026-07-12 batch) Elevation wall switcher redesigned (`WallSwitcher.tsx` on Radix DropdownMenu with new Sub/Radio wrappers): current room's perimeter walls inline + indented "Partitions" section (faces from `getRoomPlaceableWalls`), other rooms as submenus, flat list for single-room projects, trigger shows "Room · Wall" when multi-room. Prev/next stepping walks perimeter → faces → next room unchanged.
* (2026-07-12 batch) Project manager modal (`ProjectManager.tsx`, Radix Dialog; ProjectPicker reduced to the trigger): per-row open, inline pencil rename (`renameProjectById`, syncs the open project), two-step inline delete confirm (no window.confirm), quick `.sightlines` export without opening (`exportProjectPackageById`, shares `buildPackageZip` with the main export, toasts on success/failure). `ProjectSummary` gained `roomCount`/`artworkCount`, populated cheaply in `toProjectSummary`.
* (2026-07-12 batch, clearance model reworked same day after Marina's review) Partition alignment package: `partitionSpacing.ts` computes FOUR-SIDED, face-accurate clearances — normal-axis gaps ray-cast from the slab faces, span-axis gaps from the endpoints — against room perimeter PLUS every other partition's slab outline (neighboring partitions count as boundaries everywhere). "Center between walls" / "Center along span" inspector buttons via `centerFreestandingWallBetweenWalls` (+ `centerFreestandingWall` store action through `runPartitionEdit`, undo free; errors "Nothing on both sides to center between." when a ray misses) — centering equalizes the true displayed gaps, respecting partition neighbors. Move-drags snap to per-world-axis equidistant-between-neighbors targets (midpoint of the two extent-point hits, so the snapped position reads equal gaps; skipped when the partition is >15° off-axis) plus sibling-partition midpoint alignment, guides through the existing `.snap-guide` chain; endpoint drags wall-kiss via `snapDrawPointToRooms` (Shift-lock > wall-kiss > grid). `PartitionDimensionLines.tsx` renders all four side gaps at rest when selected; during a move drag only the axes actually moved show (per-axis latch at half the snap threshold, no dims until real travel). Centering buttons speak world-axis language — "Center left–right" / "Center up–down" via `partitionAxisForWorldAxis` (dominant-component mapping, 45° tie documented). Partition snap guides are clipped to the containing room's bounds (`Guide.extentMm`, ~200mm overshoot); other drags' guides untouched.

* Added an eyeline (centerline) show/hide toggle in elevation mode, mirroring the grid toggle's state, storage, and UI pattern; centerline alignment snapping stays active while hidden, matching how grid snap stays independent of grid visibility.
* Added framing + matting previews. Optional additive `matWidthMm` + `frame` ({widthMm, finish}) on the artwork record (no schema-version bump). Elevation draws flat frame ring → off-white mat ring → image, with a thin bevel hairline at the mat opening; selection outline wraps the outer rect. Plan widens the artwork's along-wall extent by the outer width ("simple dim change"). Finishes via dropdown (gold/white/black/silver/wood); mat/frame fields carry band-width placeholder examples (3"/1", 75/25 mm); "Overall" W × H are editable LengthFields that solve for the frame band (mat untouched; overall = image + 2·mat clears the frame, smaller errors in the field's message slot). Frame band always reads via thin hairlines at its outer edge and the frame/mat (or frame/image) boundary. Pure `getArtworkOuterDimensionsMm` + `deriveFrameWidthFromOverallMm` helpers in `src/domain/framing.ts`. Artwork inspector reworked into collapsible `InspectorSection` rows (Radix Collapsible; Dimensions / Mat & frame / Position / Details) with at-rest summaries and per-section open state persisted in view preferences. Wall-placement validation, snapping, barriers, ghosts, marquee, outlines, fit-selected, arrangement, neighbor detection, spacing readouts, and dimension lines now use outer framed footprints; floor-placed artwork in plan remains deliberately unframed pending the representation decision in `docs/framing-dimension-contract.md`.
* Fixed dims input UI/UX: length fields now reserve a stable message slot for conversion previews/errors.
* Added plan-wall click selection without conflicting with object selection or armed placement tools.
* Moved plan-mode door/window/blocked-zone placement into the top-bar insert workflow.
* Made the thin rectangle SVGs defining placement of art/objects in plan mode more visible and distinguishable --> let's refine and improve this, they are hard to see - also maybe petrol is not a good select color for wall select, bc not enough contrast w black
* polish the checklist UI - current sort dropdown feels clunky/inelegant.
* refine look of imperial/metric switch, it is too thin compared to surrounding elements and also has unnecessary double pill structure
* consider making add to this wall (door/window/zone) buttons in wall inspector pane into equally sized chips w useful hover tooltips
* make checklist/rooms&walls pane area resizable, also maybe make inspector pane resizable and collapsible ?
* i would expect that just entering ONE dim (height OR width) for an artwork should automatically supply the other dim, since we already know the artwork's aspect ratio based on the image file - so you should be able to enter just width or length, press return, and have the other dim autopopulate - you can still edit it manually, as you can now, but it will default on blur/return to the logical value based on the image's aspect ratio and the one defined dimension (this is only for 2d objects, i guess, or at least it doesn't apply to depth (z-axis dims))
* dim entry fields for artworks should reserve a stable message slot for conversion previews/errors so that layout spacing/sizing doesn't change every time the preview conversion pops up, also dim entry field sizing should be tweaked and made consistent w/ clean spacing
* when an artwork is dragged into the workspace, the little thumbnail that appears should be at the correct aspect ratio (currently squished)
* an artwork selected in the inspector pane should show a small thumbnail image there, next to the metadata - consider how best to lay this out responsively. also we should restructure the metadata organization so dims are near the top, currently they are too far down. things like lender/location can be nearer to the bottom.
* (shipped, dim lines) between-works tab now shows neighbour-aware outer dim lines: when the selected group has an artwork/group beside it on a side, the outer dim line stops at that neighbour's nearest edge (per-side fallback to the wall edge when nothing is beside it). The between-works inspector body mirrors this with two per-side calculated distance readouts (Neighbor-tagged when the target is a work). Reused getNeighborAwareSegments / detectBoundary — no new "neighbor" notion.
  * NOTE re: granular numeric adjustment of the left/right gaps to neighbour groups — this ALREADY exists via the "From edges" tab: its left/right/both anchors measure to and slide the group against detectBoundary's target, which is the nearest neighbour edge (wall only when there's no neighbour). So the "version of from wall edges but treating the neighbour groups as targets" is the From-edges tab today. Only remaining question is whether that adjustment should also be reachable from inside the between-works tab itself (currently between-works stays center-fixed and edits interior gap only); left as-is since it would duplicate From-edges.
* we need some sort of way to resolve/handle when dims don't perfectly match the aspect ratio of the image
  * for instance, we could add an option to arrive image aspect ratio w the accurate dims, but we don't want to the resulting image preview to appear squished/distorted
* no frames and mats rendered in 3d - add them
