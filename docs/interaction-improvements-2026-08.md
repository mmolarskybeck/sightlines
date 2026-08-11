# Interaction improvements — August 2026

Plan for five interaction items requested 2026-08-11. Ordered by dependency and
risk, smallest first. Each item lists the design decision, the touch points,
and the verification bar.

Status legend: ☐ planned · ◐ in progress · ☑ built · ✔ reviewed+verified

---

## 1. ✔ Checklist: always-collapsible sections + auto-expand on selection

*(User items 3 and 4 — one root cause.)*

**Problem.** In group-by-artist mode, the section containing the selected work
cannot be collapsed. The auto-expand effect at
`ChecklistPanel.tsx:276-290` depends on `rows`, which is rebuilt (new array
identity) every render, so the effect re-fires after every render — including
the render caused by the user's own collapse click — and immediately re-opens
the section. "Collapse all artists" is likewise defeated for the selected
artist's section.

**Design.**
- The auto-expand-on-selection behavior is *wanted* (it is exactly item 4);
  it must fire only when `selectedArtworkId` actually **changes**, not on every
  render. Track the previous id in a ref (the panel already uses this idiom at
  `:311-318`) and/or memoize `rows`.
- Memoize `rows` regardless — it's an unmemoized `.map` feeding effect deps.
- Add scroll-into-view for the selected row when selection arrives from
  outside the panel (plan/3D/elevation click). Constraint: the group's `<ul>`
  is conditionally rendered (`:832-841`), so the scroll must run after the
  expand commit (effect after render, or rAF).
- Do NOT auto-switch the left panel to the checklist when it's showing
  something else — out of scope, potentially annoying.

**Touch points.** `src/app/components/panels/ChecklistPanel.tsx` only.
Tests: `ChecklistPanel.test.tsx` — note the harness defaults
`selectedArtworkId` to `null`, which is why this bug was invisible; add cases
with a non-null selection: (a) section containing selection can be collapsed
and stays collapsed, (b) selection *change* expands the target section,
(c) collapse-all works with a selection active.

**Verify.** Vitest + manual: select a work, collapse its artist → stays
collapsed; click a different work in plan → its artist expands and row scrolls
into view.

---

## 2. ✔ Plan drop onto a wall selects that wall for elevation

*(User item 1.)*

**Problem.** Dropping a checklist work onto a wall in plan places it, but
toggling to elevation still shows the previous wall context.

**Design.** Elevation renders the wall in `wallContextId` (store). In
`store.ts placeArtwork` (~L2416-2430), the commit already runs
`selectionWrite(nextProject, {kind:"objects", ids:[placement.id]}, get().wallContextId)`
— pass the just-placed-on `wallId` instead of the stale context. This is the
sanctioned shape (`EditExtras` allows it; selection + wallContextId must
travel together via `selectionWrite`).
- Do NOT use `selectWall` (arms the Delete shortcut on the wall) or
  `focusWallContext` (clobbers the new object selection).
- Partition face ids (`${partitionId}#a|#b`) are valid `wallContextId`s and
  appear in the wall switcher — no special-casing.
- `placeArtworkOnFloor` keeps its current behavior (no wall involved).
- Also cover the plan drag-capture path: when *moving* an already-placed work
  ends with it anchored to a wall (`planMoveFloorToWall`, and wall→wall moves
  through the plan move commit), update `wallContextId` to that wall the same
  way, if the commit path makes that clean. Checklist drop is the must-have.
- Do NOT auto-switch `viewMode` to elevation; the user toggles manually.

**Touch points.** `src/app/store.ts` (`placeArtwork`, possibly
`planMoveFloorToWall` / plan move commit). Tests in store tests: place on
wall B while context is wall A → `wallContextId === "B"` and selection is the
new placement.

**Verify.** Vitest + manual: drop on far wall in plan, hit Tab/elevation
toggle → that wall is showing with the new work selected.

---

## 3. ✔ Cross-type drops convert placement (floor work → wall, wall work → floor)

*(User item 5.)*

**Problem.** Dragging a checklist work whose effective form is "floor"
(explicit `placementForm:"floor"`, or recorded `depthMm > 0`) over a wall in
plan does nothing (policy `floor-only` at `planSnapTargets.ts:89-102` — the
wall is never captured), and in elevation the drop is refused outright
(`ElevationView.tsx:1553-1556, 1566, 1614, 1653`). Symmetrically a wall work
can't be dropped on open floor in plan (`reject` policy → red ghost). The user
gets no explanation — it just won't place.

**Design.** Intent wins: where you drop it is where it goes. The artwork
`placementForm` stays the *default* (decides the ghost's initial preference),
but never blocks.
- **Plan:** change `floatPolicyForKind("artwork", form)` to return `"float"`
  for both forms — exactly the policy already used when *moving* a placed
  work (a hung work dragged to open floor stands up; a standing work dragged
  to a wall hangs). Drop commit already branches on `anchor === "floor" |
  "wall"`; both branches now reachable for both forms. Ghost dims must follow
  the *resolved* anchor, not the library form (wall footprint vs floor
  footprint — see `effectiveArtworkDims` in `usePlanArtworkDrop.ts:96-139`).
- **Elevation:** remove the three `isFloorWork` refusals (ghost suppression,
  `dropEffect = "none"`, commit bail). A floor work dropped on the elevation
  wall goes through the normal `placeArtwork` path at the drop x/y.
- **Type follows placement, flag untouched:** placing determines effective
  type (App already derives `artworkPlacementForm` from where the object
  lives). Do NOT write the library `placementForm` flag at drop time — same
  one-undo-step precedent as `setArtworkPlacementForm` for placed works. The
  Type toggle and round-trip memory (`wallYMm`, `floorMemory`) already handle
  later conversion.
- Depth handling needs no new code: wall placement of a deep work is the
  supported deep-wall-artwork path; floor placement of a flat work falls back
  through `effectiveFloorDepthMm` (depth → width → default).
- Cases are NOT artworks — their policies (`floor-only` / `capture-any`)
  are untouched.

**Touch points.** `src/domain/snapping/planSnapTargets.ts`
(`floatPolicyForKind`), `src/app/hooks/usePlanArtworkDrop.ts` (ghost dims per
resolved anchor), `src/app/components/elevation/ElevationView.tsx` (drop the
`isFloorWork` guards). Tests: `planSnapTargets.test.ts`, drop-hook coverage,
`e2e/artwork-placement-type.spec.ts` may need its assumptions updated.

**Verify.** Vitest + e2e + manual: drag a depth-bearing work onto a wall in
plan → hangs at default centerline height; drag it into elevation → places;
drag a flat wall work to open floor in plan → stands as floor object; Type
toggle still round-trips.

---

## 4. ✔ 3D view: drop-to-place on walls (and floor) + arrow-key nudge

*(User item 2. Amends the "no 3D editing" decision — 3D becomes a placement
and nudge surface; elevation/inspector remain the precision surfaces.)*

**Scope.** Drag a checklist work into the 3D view: a raycast hit on a wall
places it there (wall-local x from the hit, y from the hit height); a hit on
the floor places it as a floor work (consistent with item 3's intent-wins
rule). No snapping in 3D — the user refines in elevation or the inspector.
Arrow keys nudge a single selected wall artwork; WASD remains camera travel.

**Design — drop:**
- DOM handlers (`onDragOver`/`onDragLeave`/`onDrop` + the
  `subscribeArtworkTouchDrag` mirror) on the `.three-view` wrapper div
  (`ThreeDView.tsx:1249`), same protocol as plan/elevation
  (`ARTWORK_DRAG_MIME`, `draggingArtworkId` prop, drag session peek/consume).
- Per dragover, manual raycast (pattern from `CursorZoom`,
  `ThreeDView.tsx:641-647`; R3F state exposed via a tracker component like
  `LiveCameraTracker`). Tag wall meshes and floor surfaces with `userData` so
  hits can be filtered to placement surfaces (artwork planes, pick bands,
  doors etc. are not drop targets — but a hit on them should fall through to
  the wall/floor behind, so filter intersections rather than taking [0]).
- **Coordinate mapping — use floor-space projection, never panel-local x**
  (the `toPanelLocalX` winding reversal at `scene3d.ts:410-416` has no
  exported inverse): world hit → floor mm (`x/MM_TO_WORLD`, `z/MM_TO_WORLD`),
  then `projectPointToWall` / `findNearestWall` over `getPlaceableFloorWalls`
  → authored `(wallId, xAlongMm)`; height = `point.y / MM_TO_WORLD`, clamped
  so the work stays on the wall. Clamp x so the full width stays on the wall
  (same rule as `setArtworkPlacementForm` floor→wall).
- Commit through the same store actions as plan: `placeArtwork(artworkId,
  wallId, xMm, yMm)` (which, after item 2 of this doc, also sets
  `wallContextId` — so elevation opens on the drop wall) or
  `placeArtworkOnFloor`. Same guards apply (open walls refuse, already-placed
  refuse).
- Drop ghost: translucent aspect-correct plane on the hovered wall (or floor
  rect). `frameloop="demand"` — every ghost update must `invalidate()`.
- Respect item 3: form never blocks; wall hit places on wall, floor hit on
  floor.
- Rooms-empty state returns before the wrapper div renders — fine, nothing
  to drop onto.

**Design — arrow nudge:**
- `useArrangeNudgeShortcuts` (`:100`) currently bails unless
  `viewMode === "elevation"`. Allow `"3d"` as well, but in 3D handle only the
  **single wall-artwork selection** case (the multi-select path opens an
  arrange session whose preview only renders in elevation — bail to travel in
  3D for multi-select). Reuse `getNudgeStepMm`, `moveArtworkPlacement`.
- Arbitration with camera travel: the nudge listener is window
  **capture-phase**, so it fires first; when it handles an arrow press it must
  `preventDefault()` + `stopImmediatePropagation()` so `KeyboardTravel`
  (`ThreeDView.tsx:714-824`, which owns Arrow* + WASD) never sees it. Result:
  arrows nudge when a wall artwork is selected, arrows travel when not; WASD
  always travels. Also make `KeyboardTravel` drop Arrow* codes from its
  pressed-set bookkeeping if a keyup arrives for a key it never saw down.
- Skip clean-increment quantization in 3D (needs neighbor footprints wired
  for the elevation wall; plain step nudge is the right v1).

**Docs amendment (required, same change):** update `docs/status.md` ("No 3D
editing" sentence) to: 3D supports drop-to-place and arrow nudge; numeric
editing stays in the inspector; full 3D dragging/gizmos remain out of scope.
Note the amendment in `docs/archive/3d-preview-spec.md` is superseded (archive
docs stay frozen — add one line at top pointing at status.md if convention
allows, else status.md alone).

**Touch points.** `src/app/components/three/ThreeDView.tsx` (drop handlers,
raycast tracker, ghost, KeyboardTravel arbitration),
`src/app/components/three/WallPanel.tsx` + `FloorSurface.tsx` (userData
tags), `src/app/App.tsx` (pass `draggingArtworkId`, `onPlaceArtwork`,
`onPlaceArtworkOnFloor` to ThreeDView), `src/app/hooks/useArrangeNudgeShortcuts.ts`,
`docs/status.md`. New pure helper for world-hit → (wallId, xMm, yMm) mapping
lives in app layer or a new module — NOT in `scene3d.ts` (that file is
one-directional by contract).

**Verify.** Vitest for the hit-mapping helper (winding both directions,
partition faces, clamps); manual/driver: drop from checklist onto a far wall
in 3D → places, selected, elevation toggle shows that wall; arrows nudge it;
click floor-drop → stands on floor; WASD still travels; arrows travel again
after Escape.

---

## Sequencing

1. Item 1 (checklist) and item 2 (wall context) — independent, parallel.
2. Item 3 (cross-type drops) — after item 2 (shares `placeArtwork` region).
3. Item 4 (3D) — last; depends on item 2's wallContext behavior and item 3's
   intent-wins rule.

Working state: branch `feat/dropbox-share-links` carries unrelated staged
Dropbox work — these changes stay unstaged and in disjoint files; no commits
without explicit go-ahead.
