# Framing Dimension Contract & Implementation Plan

Audited 2026-07-12 (four-agent pass: store data-flow, elevation behaviors, plan
behaviors, 3D + exports); revised same day after review (Phase-0 churn removed,
override semantics pulled forward, boundary adapter added, floor parity split
out pending a product decision). This document is the source of truth for
**which dimension every geometry consumer uses**, and the phased plan for
closing the displayed-vs-behavioral gaps. Disagreement inventory with line
references in §2; phases in §4 are independently shippable and each ends green.

Process note: framing work starts on its own `feat/framing-dimension-contract`
branch once the in-flight persistence branch's work is committed — do not mix
it into `feat/persistence-corruption-safety`.

## 1. The contract

**Model invariant (keep):** placement `widthMm`/`heightMm` always store the
IMAGE size and are the **behavioral footprint base**. Mat/frame are read-time
expansions, never baked into stored dims. Baking would break the "Overall"
inverse solver (`deriveFrameWidthFromOverallMm`), force migrations + placement
resync on every mat/frame edit, and pollute the `.sightlines` format.

**`displayDimensionsOverride` — canonical rule (decided now, not deferred):**
the override is **display/provenance metadata only**. Geometry never resolves
it. Placement `widthMm`/`heightMm` remain the sole behavioral image footprint
for all persisted and imported records, including any that already carry an
override (the field is schema-valid and package-round-trips despite having no
UI writer). If a writer ever ships, it must explicitly **rebake** the
placement's stored dims from the override at write time (handling partial
dimensions/placeholders through `getEffectivePlacementSizeMm`) — at which
point no geometry consumer changes, because they all read stored dims. Until
then the override's only consumers are display strings (tooltip today).

**Derived quantity (the one seam):** the *effective footprint* of a placement =

```
getArtworkOuterDimensionsMm(placement.widthMm, placement.heightMm,
                            artwork?.matWidthMm, artwork?.frame)
```

expand the **stored** placement dims — never re-derive from
`artwork.dimensions`, never resolve the override. Bands are symmetric per
side, so expansion never moves a center (`xMm`/`yMm` unaffected), which is
what makes pre-expansion safe.

**One canonical boundary adapter.** Views must not hand-roll widened copies.
Add, alongside the size helper:

```ts
withArtworkFootprint<T extends WallObjectBase>(object: T, artwork?: Pick<Artwork, "matWidthMm" | "frame">): T
```

(plus a floor-object variant when 6b lands). Rules: artwork kind expands by
mat+frame; openings/blocked-zones return unchanged; missing artwork record
(dangling `artworkId`) returns unchanged; all non-size fields — `id`, `kind`,
`artworkId`, `xMm`/`yMm` (center), `wallId`, `groupId`, `rotationDeg` — pass
through untouched. Every behavioral boundary (validation, snapping, barriers,
arrange, group bounds, marquee) uses this adapter; collision/arrange/group
algorithms stay `WallObjectBase`-pure and framing-agnostic.

### Per-consumer contract table

| Consumer | Contract | Status |
|---|---|---|
| Image plane render, mat bevel/opening rect, aspect-fit, inspector Image W×H | **image** (mat opening ≡ image in this model) | correct today |
| Plan wall glyph + its click hit, elevation band painting, 3D wall meshes + raycast, single selection outline | **outer** | correct today |
| Collision/overlap validation, bounds check, out-of-bounds | **outer** | correct |
| Snap edge/flush targets (both views), floor-line snap, 48px drag barriers, drop ghosts | **outer** | correct |
| Marquee (both views), group bounds/outline, fit-selected, arrange/distribute solvers, neighbor detection, spacing readouts, dimension lines | **outer** | correct |
| Tooltips, inspector summaries | image **and** "overall" line when framed | Phase 5 |
| 3D eye-level camera standoff | **outer** | Phase 5 |
| Spreadsheet import `framed`-role cells | persisted provenance, never silently stored as image dims | Phase 6a |
| Floor artwork glyph/hit/3D | **image** — framing is wall-only geometry; floor stays framing-agnostic (see §3) | decided, Phase 6b |
| `displayDimensionsOverride` | display/provenance metadata; geometry reads stored dims (rule above) | decided, Phase 1 documents it |
| Center-snap targets, group-drag anchor math | stored dims (centers identical under symmetric bands — deliberate) | exempt, document |
| Plan off-wall depth, floor-object +20mm 3D pad | schematic constants | exempt, document |
| `.sightlines` export/import, wall↔floor conversion | stored-as-is, derivation-free | correct today |

## 2. Disagreement inventory (audit findings)

All gaps are exactly `2·(matWidthMm + frame.widthMm)` per axis.

Correctness tier:
- Collision structurally framing-blind: `src/domain/placement/collision.ts:12-35`,
  `validatePlacement.ts:149-170` (Artwork never passed in).
- Bounds check `validatePlacement.ts:103-106`; elevation out-of-bounds
  `elevationScene.ts:69-81` → `ElevationView.tsx:1392-1398`.
- Spreadsheet `framed` role: `spreadsheetImport/dimensions.ts:10,181-187` wins
  priority but `importPlan.ts:130,140` stores the overall size as image dims.

Interaction tier:
- Snap edges: `artworkSnapTargets.ts:32-57,131-154` (elevation + plan via
  `planSnapTargets.ts:253`); floor-line snap `artworkSnapTargets.ts:110` puts
  the image bottom on the floorline (frame extends below).
- 48px barrier obstacles image-sized: `ElevationView.tsx:916-943`.
- Arrange/distribute/neighbors image-edge throughout `arrangeOnWall.ts`
  (`:15-17,50,60,84,215,251,317-365`).
- Marquee: elevation `groupBounds.ts:35-48` via `ElevationView.tsx:461`; plan
  `PlanView.tsx:1920-1925` calls `getWallObjectPlanRect` without widening.
- Plan drop ghost image-sized → grows on drop: `PlanView.tsx:2099-2122`,
  `PlanOverlaysLayer.tsx:318-337`.

Display tier:
- Group outline `ElevationView.tsx:1507` + fit-selected `:1189-1195` use image
  unions (`groupBounds.ts:18-28`) while single-select outline wraps outer
  (`ElevationArtwork.tsx:185-192`).
- Dimension lines/readouts: `ElevationView.tsx:1226,1240-1243`,
  `GroupDimensionLines.tsx:69`, `arrangeReadout.ts:128-135`.
- Tooltips print image dims under outer-painted glyphs:
  `PlacementTooltip.tsx:69`, `PlacedObjectsLayer.tsx:85-97`,
  `ElevationView.tsx:1401-1409`.
- 3D standoff: `ThreeDView.tsx:298` → `cameraNav.ts:103-108`.

Form asymmetry:
- Floor artworks never framed: plan `planObjects.ts:202-210`,
  `planScene.ts:259-266`; 3D `FloorObjectBox.tsx` (no framing consumption),
  `scene3d.ts:69-81,187-207`.

Consistent today (do not touch): plan wall glyph + click hit (incl. mid-drag
previews, `planScene.ts:130-152` / `PlacedObjectsLayer.tsx:159-179`); 3D wall
render + picking (`ArtworkPlane.tsx:102,124,148`); package round-trip.

## 3. Decisions

Decided:
- **Derive, don't bake** (rationale in §1).
- **One canonical adapter at boundaries; domain algorithms stay
  `WallObjectBase`-pure** (§1).
- **Override = display/provenance metadata; stored placement dims are the
  behavioral footprint** (§1). This is decided in Phase 1 so Phases 2-5 cannot
  implement geometry against the wrong contract.
- **Testing approach:** no throwaway characterization tests for known-broken
  behavior. Permanent invariant tests land in Phase 1; each fixing phase ships
  its *desired-behavior* regression tests alongside the fix (use `it.todo`
  stubs in Phase 1 if we want the inventory visible early).
- **Spreadsheet `framed` values:** we cannot back-solve bands from one overall
  number, so the value still lands in `dimensions` — but with **persisted
  provenance** (`dimensionRole: "overall"` retained on the artwork's
  `extraMetadata`, already written today at `importPlan.ts:130`) promoted to a
  first-class review-visible flag. A transient import-wizard warning is only
  acceptable if the review/commit flow provably carries it; provenance in the
  record is the fallback that always survives.

- **Framing is WALL-ONLY geometry** (decided 2026-07-13, closing Phase 6b —
  option (a) of the two that were open). Conversion keeps mat/frame on the
  artwork record, but floor geometry ignores them: a floor-placed artwork's
  plan glyph, hit area, and 3D box stay image-sized. Three reasons, in code:

  1. **The depth fallback would silently inherit the frame band.**
     `effectiveFloorDepthMm` (`artworkForm.ts`) falls back to `widthMm` when no
     depth is entered. If a floor artwork's width were ever the OUTER width, a
     depth-less floor work would pick up a plan depth of image + 2·(mat+frame) —
     the frame band leaking into an axis it has no physical relationship to. The
     failure would happen implicitly, rather than by anyone choosing it.
  2. **A floor artwork has ambiguous physical orientation** (flat on the floor?
     leaning against a wall? crated?), so outer HEIGHT cannot be auto-mapped
     onto plan DEPTH. Stored floor `depthMm` already has its own spatial
     meaning.
  3. **The populations barely overlap.** `effectivePlacementForm` sends a work
     to the floor only when `placementForm === "floor"` or `depthMm > 0`; mat
     and frame are 2D wall-work fields. A framed work becomes floor-form only if
     someone enters a depth or flips the form explicitly — precisely the
     leaning/crated case where the representation is unknown. This declines to
     guess about a rare case; it does not defer a common one.

  It also preserves the invariant the whole contract rests on: storage stays
  image-sized, so a floor→wall conversion restores `heightMm`/`wallYMm` and the
  work re-expands the moment it is back on a wall, with nothing to migrate —
  which only holds because no floor field ever absorbed a frame band.

  **Unblock condition:** floor geometry stays image-sized until an artwork
  carries an explicit physical orientation (flat / leaning / crated). That enum
  — not the framing fields — is what determines whether outer height maps to
  plan depth at all. Reopening this without one is guessing.

  Note the one thing that is NOT the floor stage: a **rejected** plan drop
  (`floatPolicy: "reject"`, no wall in capture range) is a wall-only artwork
  that lost capture, not a floor placement. Its ghost keeps the outer width.
  `resolveRejected` and `resolveOnFloor` must stay distinct for exactly that
  reason (`planSnapTargets.ts`).

## 4. Phases

Each phase: implement → its regression tests → `npm test` green →
browser-verify via the /verify recipe with a framed fixture (image 400×300,
mat 75, frame 25 → outer 600×500).

### Phase 1 — Contract helper, adapter, override decision, permanent invariants

- `getPlacementFootprintMm(placement, artwork?)` in `src/domain/framing.ts`
  (wraps `getArtworkOuterDimensionsMm` over stored dims).
- `withArtworkFootprint` adapter (§1) + unit tests covering: artwork
  expansion, opening pass-through, missing-record pass-through, and
  preservation of `id`/`kind`/`artworkId`/center/`wallId`/`groupId`.
- Permanent invariant tests (never flip): `store.test.ts` — framed placement
  creation stays image-sized; mat/frame-only `updateArtwork` touches no
  placement; wall↔floor conversion copies dims verbatim; override left intact
  and unresolved by geometry. Package `roundTrip` fixture with mat+frame.
- Encode the override rule in code comments at `project.ts:157` and in this
  doc. No consumers change yet.

### Phase 2 — Validation and bounds (complete 2026-07-13)

- Adapter applied at the `validatePlacement`/collision call boundaries in
  `store.ts` and `ElevationView`; elevation out-of-bounds size fed through the
  footprint helper (`elevationScene.ts:69-81` call site,
  `ElevationView.tsx:1392-1398`).
- Regression tests: frames-overlap/images-don't now warns; frame past wall
  edge now flags. Warning stays the existing non-blocking gate (overlap toggle
  policy unchanged) — existing projects may newly warn; that is the point.

### Phase 3 — Snapping, barriers, ghosts (complete 2026-07-13)

- Elevation: `movingSize` (`ElevationView.tsx:943` solo, `:910` group) and
  neighbor boxes via adapter; floor-line target lands the outer bottom on the
  floorline; barrier obstacle rects (`:916-943`) likewise.
- Plan: `resolveOnWall` caller passes footprint width (`planSnapTargets.ts:253`
  input); drop ghost pipeline (`PlanView.tsx:2099-2122`,
  `PlanOverlaysLayer.tsx:318-337`) sizes via footprint /
  `getRenderedWallObjectPlanRect` so nothing grows on drop.
- Center targets deliberately unchanged. Regression tests: flush snap aligns
  frame edges; floor snap keeps frame above floorline; barrier flush stop
  leaves frames tangent; ghost size equals rendered size.

### Phase 4 — Selection, group, arrangement, readout geometry (complete 2026-07-13)

- Arrange member assembly (`ElevationView.tsx`, `arrangeSlice`/
  `arrangeReadout` inputs) built through the adapter — every `arrangeOnWall.ts`
  solver, `detectBoundary`, `getNeighborAwareSegments` then measures frame
  edges for free.
- `getGroupBounds`/`getIdsIntersectingRect` callers (`ElevationView.tsx:461,
  1189-1195, 1507`, `GroupDimensionLines.tsx:69`) pass adapted boxes: group
  outline, elevation marquee, fit-selected, dimension lines move together.
  Plan marquee (`PlanView.tsx:1920-1925`) tests the rendered (widened) rect —
  same transform as paint.
- Regression tests: mixed framed/unframed equal spacing is frame-edge-equal;
  marquee grazing only a frame band selects; single and group outlines wrap
  the same edges; fit-selected contains the frame.

### Phase 5 — Tooltip and camera truth

- Tooltip (`PlacementTooltip.tsx`): add an "overall W × H" line when
  mat/frame present; keep image dims labeled. Inspector `formatFramingSummary`
  gains the overall size.
- 3D standoff: `ThreeDView.tsx:298` feeds footprint dims to
  `eyeLevelArtworkDistanceMm`.
- Regression tests: tooltip shows both lines for a framed work, one line for
  unframed; standoff distance computed from outer dims.

### Phase 6a — Spreadsheet provenance

- Promote `dimensionRole: "overall"`/`"framed"` provenance to a
  review-visible, persisted flag per §3; import-review surfaces "framed/
  overall size stored as image dims — adding mat/frame will double-count."
- Regression tests: a `"Framed: 24 x 36 in"` cell lands in `dimensions` WITH
  persisted provenance; review model carries the flag through commit.

### Phase 6b — Floor behavior: framing is wall-only (complete 2026-07-13)

- Decision per §3: floor geometry is image-sized and framing-agnostic. No
  floor adapter variant, no floor footprint helper.
- The wall/floor split is enforced at the SOURCE, not downstream: `PlanView`'s
  drop-dimension helper produces `wallFootprintWidthMm` only when
  `effectivePlacementForm(artwork) === "wall"`, so a floor work is image-sized
  by construction rather than by the floor stage happening to ignore the field.
- Bug fixed at the same seam: `resolveRejected` (`planSnapTargets.ts`) built its
  rect through `resolveOnFloor` and so dropped the footprint width — a framed
  wall work's ghost visibly shrank by 2·(mat+frame) the instant wall capture was
  lost, then grew back on re-capture. A reject is a wall work, not a floor
  object; it now keeps its outer width. The two paths stay deliberately distinct.
- Decision pinned in-code at `effectiveFloorDepthMm` (the width fallback must
  never receive an outer width) and `getPlacementFootprintMm` (no floor variant).
- Regression tests: a rejected drop keeps the outer width; a floor-only drop
  keeps the image width even when handed a footprint width; a framed floor work's
  derived plan depth is the image width, not the outer width.

## 5. Docs to update on completion

- `docs/quick-todos.md:45` — retire the "deliberate limitation" sentence
  phase-by-phase.
- `ElevationArtwork.tsx:62-64` prop comment — update once snapping/dim lines
  use footprints.
- `docs/status.md` — record each shipped phase.
