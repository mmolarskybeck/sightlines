# Floor supports: pedestals and plinths as objects

Status: Shipped 2026-09-18 on feat/floor-supports (uncommitted pending review).

## 1. Why

The 2026-09-17 model stored a pedestal as a `support` block on one artwork's floor placement. A shelf (2026-09-18) is its own wall object that several works stand on. The two disagree, one pedestal could never carry two works, and the inspector asked the same question twice ("Stands on" plus a support block). This round makes pedestals and plinths standalone floor objects modelled on shelves, and turns "Stands on" into a derived reading with actions. USER DECISION 2026-09-18.

## 2. Model (schema v8)

```ts
export type FloorSupportKind = "pedestal" | "plinth";

export type SupportFloorObject = FloorObjectBase & {
  kind: "support";
  supportKind: FloorSupportKind;
  // Absent = no bonnet. Height of the plexi box above the top face.
  bonnetHeightMm?: number;
  bonnetHeightLocked?: boolean;
  // Absent = false. See §4.
  overhangAllowed?: boolean;
};
```

- `heightMm` is the TOP FACE height above the floor. `widthMm`/`depthMm`/`rotationDeg`/`xMm`/`yMm` as any floor object. `baseHeightMm` is ignored (a support never hangs), `wallYMm` written as 0.
- `FloorObject` union gains `SupportFloorObject`. `ArtworkFloorObject` LOSES `support` and `monitorSupport`; `FloorSupport`, `MonitorSupport`, `resolveFloorSupport`, `resolveStandsOn`, `normalizeFloorSupport`, `normalizeProjectFloorSupports`, `supportRepairCount`, `reportSupportRepairs`, `supportedTotalHeightMm`, `supportPlanRect`, `assemblyPlanRect`, the "monitor-default" resolver, `ElevationSceneSupportedArtworkGhost`, `supportedArtworkGhosts`, `PlanSceneFloorObject.support`, `ElevationSceneMonitorGhost.supportXMin/Max`/`bonnetHeightMm` are all DELETED. `ArtworkFloorMemory` no longer parks `support`/`monitorSupport`.
- Nothing on an artwork says what it stands on. A work STANDS ON a support when (§3) its plan footprint overlaps the support's and its `baseHeightMm` equals the support's `heightMm` within `SUPPORT_SEAT_TOLERANCE_MM` (= 1). "The work's bottom edge is the support top" is therefore literally `baseHeightMm`.
- Derived reading `resolveFloorStandsOn(object, floorObjects, artworksById?)`:
  - `{ kind: "support", support }` when a rider of some support (widest-overlap wins if several).
  - `{ kind: "suspended", heightMm }` when `baseHeightMm > 0` and no support.
  - `{ kind: "floor" }` otherwise. Cases and monitors read the same way; a monitor is never "suspended" (existing rule): a monitor with `baseHeightMm > 0` and no support is reported as `floor` and its baseHeight is treated as 0 by renderers.

### Migration v7 → v8 (`MIGRATIONS[7]`, a real rewrite)

For every artwork floor placement:
1. If it has `support`: compute the support's footprint centre in floor space exactly as the old `supportPlanRect` did (offset rotated into the placement frame), create a `SupportFloorObject` with a fresh id, `supportKind = support.kind`, that centre, the support's width/depth/height, the placement's `rotationDeg`, and carry `bonnetHeightMm`, `bonnetHeightLocked`, `overhangAllowed`. Insert it into the floor's object list IMMEDIATELY BEFORE the artwork so it draws beneath it. Set the artwork's `baseHeightMm = support.heightMm`. Delete `support`.
2. Else if the artwork is a box monitor and `monitorSupport !== "floor"`: create a pedestal under it with footprint = the placement's `widthMm`/`depthMm`, `heightMm = MONITOR_PEDESTAL_HEIGHT_MM` (800), centred on the placement, same rotation; set `baseHeightMm = 800`. (Monitor detection needs the artwork record: the migration receives the whole document, join through `artworks`.)
3. Delete `monitorSupport` in every case. Strip `support`/`monitorSupport` from every `floorMemory` on wall placements.

Downgrade refusal follows the v6/v7 pattern. The migration is pure; no repair report survives (delete the `supportRepairCount` plumbing through repositories, `packageSlice`, `projectManagerSlice`, `store.ts`).

## 3. Riders (mirror of `shelfRiders.ts`, new file `src/domain/placement/floorRiders.ts`)

- `getSupportRiders(support, floorObjects, artworksById?)`: artwork floor objects on the same floor whose plan rect (`getFloorObjectPlanRect`) overlaps the support's plan rect (`planRectIntersectsRect`) and `|baseHeightMm − support.heightMm| ≤ SUPPORT_SEAT_TOLERANCE_MM`. Monitors count.
- `expandWithSupportRiders(objectIds, floorObjects, artworksById?)`: adds every rider of every selected support, order-preserving, idempotent.
- `getSupportSeatCandidates(moving: { id?, centerMm, widthMm, depthMm, rotationDeg }, floorObjects)`: supports whose plan rect overlaps the moving rect.
- `seatOnAnyOverlappingSupport(moving, floorObjects): { baseHeightMm, supportId } | null`: widest-overlap-area wins.
- `resolveFloorStandsOn` (§2) lives here too.
- Riders are DERIVED at every read and never stored; `groupId` stays dead data. Same USER DECISION as shelves.

## 4. Seating and unseating rules

- **Any drop or drag end of a floor artwork in plan or 3D seats it** on the widest-overlapping support (`baseHeightMm` = its top). If the work WAS a rider before the move and now overlaps no support, it is set on the floor (`baseHeightMm` = 0). A work that was explicitly suspended (baseHeight > 0, not a rider) and overlaps no support keeps its height. ⌘/Ctrl bypasses seating exactly as it bypasses shelf seating and every other snap. The support announces capture during the drag in the selection colour (plan `.is-snap-target`, 3D outline) like a shelf does.
- **Checklist drop onto a support's footprint** in plan or 3D seats the work (mirror of `seatOnAnyOverlappingShelf` at `placeArtwork` time, after the aspect bake, via the same `opts` seam the shelf uses).
- **Overhang.** `overhangAllowed` absent/false: while a rider is dragged it is clamped so its footprint stays INSIDE the top face (containment on both local axes, in the support's rotated frame). True: clamped so the footprints keep overlapping by at least 1 mm on both axes. In both cases the clamp is a drag barrier with pop-through: reuse `resolveDragBarriers` (`dragBarriers.ts`, the 48 px barrier grammar) so pushing through the edge unseats the work onto the floor. If the barrier helper cannot express a rotated-rect edge, clamp hard and leave "Set on floor" / ⌘-drag as the exits, and say so in the hand-back.
- **Moving a support carries its riders rigidly** (one translation for all, one undo entry) in plan drag, plan nudge, 3D drag, and inspector X/Y. Rotating a support (plan rotate handle, inspector angle) rotates its riders about the support's centre by the same delta and rotates each rider's own `rotationDeg` by the same delta. Resizing a support does not move riders. Editing a support's `heightMm` re-seats its riders (their `baseHeightMm` follows). A support is refused nothing: it moves anywhere a floor object can.
- **Deleting a support** sets its riders on the floor (`baseHeightMm` 0) and reports "Pedestal removed; N works set on the floor." through the same sonner channel the shelf notice uses. No confirm dialog.
- **Overlap policy.** A rider and its support overlap by definition: the floor overlap policy (`overlapPolicy.ts` and any plan drag barrier between floor objects) treats support↔artwork as `allowed`; support↔support and support↔case follow the artwork↔artwork rule. Hit order in plan: riders draw and hit above their support.
- **Wall capture / restore.** Capturing a rider onto a wall leaves the support on the floor (like a shelf keeps standing when a work is taken off). Restoring to the floor restores `baseHeightMm` from floor memory as today; if it then overlaps a support at that height it is simply a rider again.

## 5. Factories and defaults (`src/domain/placement/createSupport.ts`)

- `createSupport({ kind, xMm, yMm, rotationDeg, widthMm, depthMm, heightMm })` → `SupportFloorObject`, modelled on `createCase.ts`.
- `defaultSupportForWork({ kind, work: { widthMm, depthMm, heightMm }, project })` keeps today's sizing rules from `defaultFloorSupport` (`PEDESTAL_MARGIN_MM` 100 / `PLINTH_MARGIN_MM` 150 margins, `PEDESTAL_MIN_FOOTPRINT_MM` 300 / `PLINTH_MIN_FOOTPRINT_MM` 600 minimums, pedestal height `clamp(defaultCenterlineHeightMm − workHeight/2, 600, 1400)` with 1100 fallback, plinth height 150).
- Inserting a support from the toolbar (tool kind `"support"`, label "Pedestal", Insert menu only, no keyboard shortcut — USER DECISION 2026-09-18) places a pedestal of `PEDESTAL_MIN_FOOTPRINT_MM`² × pedestal fallback height at the click; the inspector's kind select switches it to a plinth (which only relabels and re-applies the plinth default height when the height is still the pedestal default).
- Placing a box monitor on the floor (checklist drop, wall→floor Type toggle, restore) creates a pedestal under it: footprint = cabinet footprint, height 800, and seats the monitor. Absent-monitorSupport-means-pedestal is thereby preserved as behaviour without the field. USER DECISION 2026-08-28 on monitor default stands; its mechanism changes.

## 6. Rendering

- **Plan**: `PlanSceneFloorObject` for `kind: "support"` carries `rect`, `supportKind`, `hasBonnet`; glyph = solid outline, plinth lighter fill, bonnet as a dashed inner outline at the same footprint (move the existing drawing out of the old `support` branch). Draw order: supports before artworks. Exports (`pdf/planPage.ts`, `preview/planPageMarks.tsx`) consume this entry; no re-derivation.
- **Elevation**: a support in front of a wall projects onto it as a ghost in the H-toggled family, exactly as `floorCaseGhosts` do (`ElevationSceneSupportGhost` with x-span, height, bonnetHeightMm, supportKind). A rider is drawn by the EXISTING suspended-artwork ghost at its `baseHeightMm`; the old supported-artwork ghost and the monitor ghost's support/bonnet fields go away. `elevationDimensionModel.ts` reads the support ghost for the "top of pedestal" dimension it drew before. PDF elevation page and preview marks consume the new ghost.
- **3D**: `SupportMesh` (box; plinth and pedestal share it; bonnet = the case glass construction from `CaseMesh`), selectable and draggable through `useSelectableFloorObject` + the shared object drag; a drag carries riders as one rigid assembly and commits through `movePlanObjectsGroup`. `FloorObjectBox` and `CrtMonitorMesh` lose their support layout; a rider simply sits at `baseHeightMm`. The selection box wraps only the selected object.
- Snap-target announcement: plan `.is-snap-target` on the support glyph, 3D outline, same as shelves.

## 7. Inspector

**Artwork on the floor** ("Position on floor" section, in order):
1. Type toggle Wall / Floor (unchanged).
2. X (floor), Y (floor), Angle.
3. **Footprint** summary row (`InspectorSummaryRow`, always present): value "W × D · Same as work" with an "Edit" action, or "W × D · Differs from work" with a "Reset" action (sets the floor object's width/depth/height to the work's, the existing match-size behaviour). "Edit" expands the row into the Width / Depth / Height fields inline; it stays expanded while the values differ. "Same as work" describes present equality only, never a live link — a support or footprint never resizes because the work's dimensions were corrected. USER DECISION 2026-09-18 (replaces "hide unless diverged"). `FloorArtworkImageSizeNote` folds into this row.
4. **Support** summary row (`InspectorSummaryRow`, label "Support", derived from `resolveFloorStandsOn` on every render, never a select; same label and grammar as the wall-work Support row):
   - Floor: value "On the floor". Actions: "Put on pedestal", "Put on plinth", "Suspend".
   - Support: value "On pedestal · W × D × H" (or "On plinth · …", project units). Actions: "Select pedestal", "Center on pedestal", "Set on floor".
   - Suspended: value "Suspended" with a "Height off floor" field beside it. Actions: "Set on floor", "Put on pedestal".
   Actions render as one compact action group (the shelf row's grammar); the exact control is the UI round's call under `impeccable`. "Rider" and "seat" are internal words and never appear in UI copy.
5. Image faces (unchanged).

"Put on pedestal/plinth": create `defaultSupportForWork` centred on the work, same rotation, insert before the work, seat the work; one undo entry. If the work is already suspended, the new support's height is the work's current `baseHeightMm` clamped to the pedestal range. "Set on floor": `baseHeightMm` 0, the support stays. "Center on pedestal": move the work to the support's centre.

**Support inspector** (new `SupportInspector`, modelled on `ShelfInspector`/`FloorCaseInspector`): title "Pedestal" / "Plinth"; Kind select (Pedestal / Plinth); "Holds" summary row ("Nothing yet" teaching notice at zero, "N works" with Select works otherwise); X, Y, Width, Depth, Height (top face), Angle via `FloorPlacementFields` without base height; "Allow overhang" switch; "Plexi bonnet" switch with Bonnet height + lock (the existing bonnet rules: enabling grows the footprint to `riderUnion + 2 × (CASE_GLASS_THICKNESS_MM + BONNET_CLEARANCE_MM)` and clears overhang); "Fit to works" action (grow the footprint to contain the riders' union plus the kind's margin, never shrink); Delete.

**Duplicating** a support duplicates the support alone; its works stay where they are.

## 8. Not in this round

Drag barriers between a rider and the support edge beyond the clamp in §4; multi-support selection rotate; a support standing on a shelf. Tracked in `docs/status.md` Known Follow-Ups.
