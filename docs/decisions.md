# Decisions and Traps

Decisions of record, invariants, and traps distilled from the 2026-07-09 → 2026-09-01 build rounds (full narrative in `docs/archive/build-log-2026-07-09-to-2026-09-01.md`). One line per entry; newest last within each section. Add to the matching section when a round settles something a future edit could break. Entries tagged USER DECISION are not open for re-litigation without asking.

## Rooms, walls and openings

- **2026-07-09** `outwardWallNormal` is the one canonical outward direction; the centroid heuristic it replaced pointed wall-slide chips the wrong way on concave rooms.
- **2026-07-09** `removePlacement`/`removeSelectedPlacements` must clear opening partner refs; the reciprocal-pair invariant has to survive creation, geometry edits, splits, deletion and undo.
- **2026-07-12** `resizeWallPreservingAngles` delegates into `moveRoomWall` (anchor "start" slides the next wall, "end" the previous); placement offsets are never touched.
- **2026-08-09** Both door handing flags are stated against the wall's authored `start -> end`, so no renderer consults room winding; 3D remaps the hinge to panel-local x because `deriveRoom` reverses panels for clockwise rooms.
- **2026-08-09** Leaf mirroring is gated on `areSharedBoundaryWalls`, matching position edits, so legacy pairs on unrelated walls keep independent leaves.
- **2026-08-09** Adoption resolves a leaf conflict by **hinged wins**, never by whichever id sorts first — a sort-order rule would silently erase the only leaf in a pair.
- **2026-08-09** `DoorWallObject` is split out of the connectable-opening union and the window branch spells the prohibition as `z.never().optional()`, because zod strips unknown keys and omission would have dropped `leaf` silently.
- **2026-08-09** Swing clearance is advisory: nothing about the arc blocks or warns on placement, and "Flip swing" has no visible 3D effect because a shut leaf is symmetric about the wall plane.
- **2026-08-10** Only a full-span perimeter wall can be opened, so the action can never create an ambiguous half-wall state; an open wall stays listed for orientation but takes no artwork or openings.
- **2026-08-10** Partitions within `PARTITION_NEIGHBOR_MAX_GAP_MM` (1200, inclusive) count as spacing neighbors for readouts, snapping, arrange, PDF dims, and the plan wall-dimension chain, which splits at a qualifying band instead of measuring through it.
- **2026-08-10** Drag barriers past a partition stay off — placement past a partition is visual-only — USER DECISION.
- **2026-09-17** Use as North wall relabels all four walls in stored loop order; any 4-wall room; partition faces excluded; confirms before overwriting custom names, judged on the whole ordered name pattern (hasDefaultWallNames), never name by name — a typed "Wall 12" or a duplicated compass name is custom.
- **2026-09-18** A shelf is its own wall object, not a placement variant: several works share one slab, so the thing they stand on has to exist independently of any of them — USER DECISION. `yMm` is the slab centre, `heightMm` its thickness, `depthMm` its protrusion; the inspector authors the TOP face and converts once, at the commit.
- **2026-09-18** Shelf riders are DERIVED from geometry at move time on every path — elevation drag and nudge, plan drag and nudge, inspector x/top edits — and never stored; `shelfRiders.ts` is the whole definition and `WallObjectBase.groupId` stays dead data. Never build shelf grouping on `groupId` — USER DECISION. **Amended 2026-09-18 (later):** the foot is the FRAMED outer footprint bottom (`withArtworkFootprintFromMap`), never the stored image bottom — the elevation snap and barriers seat the outer box on the slab, so the rider test, "Add shelf", plan/3D seating and `placeArtwork`'s re-seat all measure the same edge; every `getShelfRiders`/`expandWithShelfRiders` call passes an `artworksById` map.
- **2026-09-18** A shelf reanchors across walls in plan the way artwork does, but RIGIDLY: one common delta for the slab and its riders, refused outright when the union does not fit the target wall (or it is an open side). Never fall back to per-member clamping — USER DECISION.
- **2026-09-18** Deleting a shelf leaves the works that stood on it exactly where they are and says so ("Shelf removed; N works left in place.") — no confirm dialog, because nothing is lost. The notice goes through the sonner channel `reportSupportRepairs` uses, not the `error` banner.

## Placement, snapping and framing

- **2026-07-12** Drag previews reuse `getRenderedWallObjectPlanRect` and `isArtworkOutOfWallBounds` so mid-drag and at-rest geometry can never disagree.
- **2026-07-12** Doors ignore pointer y in elevation: `moveOpening` hard-clamps `yMm = heightMm/2` and height edits keep the bottom grounded; windows and blocked zones are untouched.
- **2026-07-12** `partitionSpacing.ts` measures four-sided face-accurate clearances (normal gaps from slab faces, span gaps from endpoints); partitions count as boundaries for dims, snapping and centering.
- **2026-07-12** Partition endpoint snap precedence is Shift-lock > wall-kiss > grid.
- **2026-07-15** Stored placement dimensions stay image-sized; wall validation, snapping, selection, grouping, fit-selected, arrangement, neighbor detection, spacing readouts and dimension lines all measure the outer framed footprint instead.
- **2026-07-18** `framing.ts` is the single framed-footprint source across all six consumers, `orthogonalNeighbors.ts` the one dimension engine, `resolveSnap` the one snap engine; `domain/` never imports from `app/`.
- **2026-07-18** `getArtworkRingRectsMm` in `framing.ts` is the single image→mat→frame decomposition; the PDF expands in mm before the affine pt transform so it stays bit-identical to elevation.
- **2026-08-10** Frame profile is a flat square box-section; a rounded cushion ramp was rejected on sight — USER DECISION.
- **2026-08-10** `FRAME_FINISH_SHADING` in `framing.ts` is the single source for finish shading; white/black stay flat and the PDF deliberately stays flat `FRAME_FINISH_HEX`.
- **2026-08-10** `effectiveWallArtworkDepthMm` undefined means flat; `wallFootprintDepthMm` is its own drag channel, distinct from `movingSize.depthMm`, and elevation stays depth-blind by case precedent.
- **2026-08-11** Intent wins on drops: where you drop it is where it goes. `placementForm` sets the ghost's initial preference but never blocks, and the ghost's dims must follow the resolved anchor, not the library form.
- **2026-08-11** A drop never writes the library `placementForm` flag — placement determines effective type; the flag speaks only while a work is unplaced.
- **2026-08-11** Two height memories are deliberately distinct: `wallYMm` on a floor object vs `floorMemory.baseHeightMm` on a wall object; a move of an already-placed work always floats.
- **2026-08-11** Back-to-back pairing is a pose snap between two ordinary placements, not a schema link — the one-placement-per-artwork rule is what keeps both works real in the checklist, labels and PDF.
- **2026-08-11** Cases are not artworks: their `floor-only` / `capture-any` drop policies are untouched by the intent-wins rule.
- **2026-08-31** `effectivePlacementForm` ladder: explicit Type > monitor/sculpture→floor, projection→wall > explicit "framed"→wall > depth heuristic — a merely-derived "framed" falls through so pre-`displayAs` projects behave exactly as before.
- **2026-08-31** A work with a mat or frame set stays "framed" regardless of medium, so medium-derived defaults can never silently strip an existing frame.
- **2026-08-31** Floor placements rebake on record-dimension edits only while undiverged (±0.5 mm vs seeded size); a manually resized placement is left alone, and the rebake composes with the wall rebake into one undo entry.
- **2026-09-01** `artworkDropOuterMm` in `domain/framing.ts` is the one drop-ghost footprint; 3D and elevation ghosts must match the plan drop.
- **2026-09-18** Snap tier `shelf-top` (rank 0.5) outranks the centerline (1) — USER DECISION. It is only ever offered for a work that already overlaps the slab horizontally (`getShelfSnapCandidates`, the same predicate that decides what a shelf carries), so once the work is also in capture range the physical support relationship beats the curatorial eyeline.

- **2026-09-18** Seating a work on a shelf is one gesture in every view — drop or drag it over the slab — and the slab announces capture in the selection petrol everywhere (elevation `.snap-target`, plan `.is-snap-target`, 3D outline). The elevation shelf-top guide carries `guidePositionMm` (the top face) and `extentMm` (the slab span) and an "On shelf" label, so it can never be mistaken for the centerline guide; the elevation guide renderer honors `extentMm` on both axes.
- **2026-09-18** A plan checklist drop over a shelf's footprint seats on it (`seatOnAnyOverlappingShelf`, widest x-overlap wins); a plan MOVE of a placed wall work stays x-only and never re-seats — USER-FACING RULE, do not "fix". ⌘/Ctrl bypasses seating on every drop and drag path, as it already bypassed every other snap.
- **2026-09-18** `placeArtwork` takes `opts.seatOnShelfId` and re-seats the bottom edge on that slab AFTER `loadArtworkAspect` bakes the real size: a drop ghost may have been placeholder-sized, and a work whose bottom misses the top face by half a height difference is not a rider.
- **2026-09-18** A shelf snaps in elevation by its TOP face: the centerline target for `movingKind === "shelf"` seats the top face on the eyeline with the guide drawn there. A shelf assembly (slab + riders, pressed on the slab) snaps as the SLAB via `snapProxy` on `resolveElevationPlacement`, never as the union box, and a shelf proxy is offered no shelf-top target. A rider's Center button is "Center on shelf" (`boundaryKind: "shelf"`, x = slab centre).

## Floor objects and display types

- **2026-08-10** `baseHeightMm` on `FloorObjectBase` is the bottom edge's height above the floor and is **not** `wallYMm`; blocked zones ignore it (a floor-area annotation has no volume) and display cases stand on their legs.
- **2026-08-10** Room height is the only vertical datum that exists (there is no ceiling geometry), so a suspended object dragged into the void between rooms draws no wires rather than inventing one.
- **2026-08-10** A floor object's Width/Depth/Height size the support; the artwork record's dimensions size the work. They coincide only at placement and diverge the moment the board is resized.
- **2026-08-10** `heightMm` is set once at placement and editing the artwork's dimensions deliberately does not rebake it — hence the explicit Height field.
- **2026-08-10** The face image is drawn at the work's own size centered on each chosen face, shrunk but never distorted when the face is too small.
- **2026-08-10** The BoxGeometry material-group order is `+x, -x, +y, -y, +z, -z`, not the picker's reading order; a test reads the real geometry's groups back out of the position buffer.
- **2026-08-10** Textured faces use `MeshBasicMaterial` + `toneMapped: false`; untextured faces stay Lambert so a neutral box still reads as a volume. Lambert under `AMBIENT_LIGHT_INTENSITY = 2.9` saturated every floor texture to flat white.
- **2026-08-10** TRAP: a thin board at 45° projects a **narrower** span onto the wall, not a wider one — a panel foreshortens.
- **2026-08-28** The Display control is a plain always-visible dropdown — no medium auto-detect, no mode toggle; a medium-keyword nudge was rejected as the primary mechanism — USER DECISION.
- **2026-08-28** Round 1 ships CRT box monitor only; flatscreens and projections are already approximable as plain wall works, so build them only when the approximation falls short — USER DECISION.
- **2026-08-28** A monitor defaults to a white pedestal; placement `heightMm` is the cabinet only and the pedestal is added by renderers, so toggling support rewrites no geometry — USER DECISION.
- **2026-08-28** The monitor elevation ghost is the one deliberate exception to "floor-resting artwork emits no ghost".
- **2026-08-28** Known v1 lossiness: `monitorSupport` was not stashed in `ArtworkFloorMemory`, so an explicit "on floor" choice captured onto a wall reverted to the pedestal default on return — closed 2026-09-17, floor memory now parks both `support` and `monitorSupport`.
- **2026-08-31** Medium→Display derivation uses exact category matching with light aliases and no substring matching (`domain/placement/mediumCategory.ts`); medium itself stays free text for labels, exports and import.
- **2026-08-31** Projection and sculpture render frameless via `effectiveFraming` at the derivation layer, so stored mat/frame survive a flip back.
- **2026-09-01** Deliberately deferred: a display-kind descriptor table waits until a fifth display kind lands.
- **2026-09-17** A pedestal/plinth is an **attached support block on the floor placement**, not a standalone floor object; one `xMm`/`yMm`/`rotationDeg` carries both boxes and `support.offsetXMm/offsetYMm` are stored support-relative in the placement's rotated local frame — USER DECISION.
- **2026-09-17** Vertical is always locked: the work's bottom edge IS the support top. Only the horizontal offset may overhang, and the two footprints must always overlap on both axes (`|offset|` clamped to `(supportSize + workSize)/2 − 1 mm`) — a pedestal standing beside its sculpture is not a state.
- **2026-09-17** Overhang off means the support CONTAINS the work: a support edit below the work footprint grows the support (never shrinks the work, never silently centres the work over an edge) and offsets clamp to `±(supportSize − workSize)/2`.
- **2026-09-17** A plexi bonnet's footprint IS the support's, it clears `overhangAllowed`, and the work must fit inside the glass (`supportSize ≥ workSize + 2 × (CASE_GLASS_THICKNESS_MM + BONNET_CLEARANCE_MM)`, growing the support) — USER DECISION.
- **2026-09-17** Bonnet height tracks the work (`work height + BONNET_HEADROOM_MM`, always re-derived so a stale imported number never survives) unless locked; a LOCKED bonnet shorter than the work warns (`bonnetTooShortByMm`) rather than growing — USER DECISION.
- **2026-09-17** The relational support invariants live ONLY in `normalizeFloorSupport` (`domain/geometry/supportGlyphs.ts`), run by every store write and at the load boundary; the zod schema stays structural, because the rules read the placement's own dimensions.
- **2026-09-17** `support` supersedes `monitorSupport`: a monitor with no explicit support still resolves to its 800 mm cabinet-width pedestal (`resolveFloorSupport`, source `"monitor-default"`), and choosing Floor writes `monitorSupport: "floor"` because absence would resolve back to the pedestal.
- **2026-09-17** `baseHeightMm` is ignored while a support is present (as cases and monitors already ignore it): support and suspension are mutually exclusive states, so the inspector withholds "Height off floor" rather than offering a number nothing reads.
- **2026-09-17** A default pedestal's height derives from the project's `defaultCenterlineHeightMm` (`clamp(centerline − workHeight/2, 600, 1400)`, 1100 fallback) — "near eye level" against the project's own datum rather than a fixed number.
- **2026-09-17** The assembly is ONE hit target: in plan the support rect carries the work's pointer handlers and the selection outline, hit-testing and rotate handle anchor to `assemblyPlanRect`; in 3D every sub-mesh shares `useSelectableFloorObject` and the selection box wraps the union.
- **2026-09-17** The supported-artwork elevation ghost joins the H ghost family (monitor/suspended/floor-case) rather than taking a toggle of its own; it is the second deliberate exception to "floor-resting artwork emits no ghost".
- **2026-09-17** Schema v6 exists for DOWNGRADE REFUSAL only (`MIGRATIONS[5]` is a pure version stamp): a v5 build would accept the file, strip `support`, draw the work on the floor and re-save the loss — the same rationale as `isOpenSide` at v4→v5.

## Views: plan, elevation, 3D

- **2026-07-12** Plan layer components under `components/plan/` are render-only; every hook, drag machine and handler stays in PlanView, and SVG paint order plus handler attachment points are preserved exactly.
- **2026-07-12** Room-fill polygons and GridOverlay stay inline in PlanView because the grid paints between fills and structure.
- **2026-08-09** The plan swing arc is the only glyph that paints outside its own rect: it is pointer-transparent, interaction bounds are deliberately unchanged, and only paint/export bounds grew to include it.
- **2026-08-09** The 3D door leaf is legible on the shade side only through its `#b6bcc2` outline (face contrast 1.08); `DOOR_LEAF_EDGE_OUTSET_MM` keeps line and surface out of the same depth-buffer fight — weigh any thinning of that edge against the shade-side number.
- **2026-08-10** Elevation gets a Ghosts toggle (`H`) that hides dashed families only; hidden ghosts drop out of gap dims. A partition abutting a wall (≤150 mm) draws a solid band, otherwise a dashed ghost.
- **2026-08-11** A plan drop sets the elevation wall context through `selectionWrite`, never `selectWall` (arms the Delete shortcut) or `focusWallContext` (clobbers the new selection); view mode is never auto-switched.
- **2026-08-11** Partition face ids (`${partitionId}#a|#b`) are valid `wallContextId`s and need no special-casing.
- **2026-08-11** 3D drop mapping filters intersections rather than taking `[0]`, so a hit on an artwork plane or pick band falls through to the wall or floor behind it.
- **2026-08-11** In 3D the arrow-nudge listener is window capture-phase and must `preventDefault()` + `stopImmediatePropagation()` so `KeyboardTravel` never sees a handled arrow; WASD always travels and multi-select bails to travel.
- **2026-08-11** Anything drawn in 3D selects its own object; open doorways use a 60 mm perimeter pick band because a full pick plane was rejected — the centre stays see-through and click-through — USER DECISION.
- **2026-08-11** 3D is a placement and nudge surface; elevation and the inspector remain the precision surfaces, and there is no snapping in 3D. **Amended 2026-09-18:** the one exception is shelf seating — a wall work dropped or dragged within `SHELF_SEAT_CAPTURE_3D_MM` (200 mm) of a slab it overlaps stands on it, ⌘/Ctrl bypasses it, and the slab shows the selection outline while captured.
- **2026-08-28** `CLICK_DRAG_TOLERANCE_PX = 6` is the one discriminator between click, orbit-release and drag everywhere in 3D; an object drag disables OrbitControls for the gesture and commits as one store call = one undo.
- **2026-08-28** Deferred in 3D drag: wall↔floor conversion mid-drag, group drag, touch drag, and snapping or barriers.
- **2026-08-31** Known disagreement: elevation wires end at the viewed wall's top while 3D wires go to room height.
- **2026-09-18** ~~A shelf is selectable in 3D but NOT draggable this round~~ SUPERSEDED the same day: `WallShelfMesh` arms the shared object drag; the drag carries riders as one rigid assembly and commits through `moveWallObjectsGroup` with `wallId`. A shelf STICKS to its wall: a foreign-wall hit resolves against the origin wall (`stickToWallId`) until the pointer has travelled `SHELF_WALL_HOP_PX` = 120 px across that one foreign wall, then it hops, refused when the union does not fit (same rule as the plan reanchor). Artworks and cases still hop on the first frame. Original entry: A shelf is selectable in 3D but NOT draggable this round — `WallShelfMesh` deliberately has no drag handler, so a 3D drag cannot move a slab out from under its riders. Rider-aware 3D shelf drag is a tracked follow-up.

## Exports (PNG, PDF, checklist, packages)

- **2026-07-12** Package import validates foreign pre-processed bytes, not fresh uploads, so it deliberately stays outside the `intakeImageFile.ts` intake seam.
- **2026-07-12** The untrusted-package pipeline is pre-inflation zip caps + path-traversal rejection, lenient envelope → migrate → strict validation, then per-blob re-hash / MIME allowlist / dimension guards with graceful per-asset degradation.
- **2026-07-12** Import merge: identical content is reused, conflicts get one keep-mine/use-theirs/keep-both review, sha256 dedupes against the local library, and an id collision imports as a new project.
- **2026-07-15** A saved view that fails to render (unmounted 3D host, WebGL context loss) degrades to a placeholder page rather than losing the whole export.
- **2026-07-17** Export scale and JPEG-quality constants are intentionally duplicated between `captureSnapshot.ts` and `SnapshotStage.tsx` per spec §10.4 — do not consolidate.
- **2026-07-18** PDF vs SVG dimension-*label placement* deliberately differ (real font metrics + flood-fill vs estimate + step-out); values and ticks share one engine. See `docs/export-spec.md` §16.
- **2026-07-18** `openingConnections` are deliberately omitted from PDF room pages.
- **2026-07-18** `caseGlyphs.ts` owns vitrine construction in mm and both SVG and PDF consume it; the PDF's own drifted generic glyphs were the one place an export visibly disagreed with the canvas.
- **2026-08-09** TRAP: `planTransform` copying `createPlanTransform`'s `(maxYMm - yMm)` flip mirrors the y-DOWN SVG preview against the y-UP PDF page; assert orientation, not arithmetic (`ExportPdfPreview.test.ts`).
- **2026-08-09** TRAP: `planDimensionMarks` compared a screen-space normal against a world-space outward vector; both sides are now computed in screen space so it holds under any future axis convention.
- **2026-08-09** Deliberately left: the export preview draws windows and blocked zones with a coarse diagonal where the PDF draws mullions and hatch.
- **2026-08-19** Checklist export column headers must match the import wizard's `FIELD_ALIASES` so an exported file re-imports without hand-mapping; axis cells are bare numbers in the project's artwork unit and CSV is UTF-8 with a BOM.
- **2026-08-19** Missing images and deleted library records degrade a checklist export to warnings rather than failing it.
- **2026-08-19** `scripts/assert-chunk-graph.mjs` must keep `xlsx` unreachable from the eager graph alongside three/pdf/fontkit.
- **2026-08-19** Import-conflict rows must show what actually differs: `imageChanged` is a required field on `ArtworkConflict`, and same-label rows always show dims/date/accession. Metadata-map diffs are deliberately not rendered.
- **2026-08-28** TRAP (Windows): `showSaveFilePicker` with `suggestedName` and no `types` filter loses the extension under "hide extensions"; every export must pass a real `types`/accept entry, and raw `Uint8Array` data needs a typed Blob for the anchor fallback.
- **2026-09-01** `deliverExport.ts` + `useExportActions.ts` are the one export delivery route out of App.
- **2026-09-01** Open gap: PDF plan pages still draw a suspended board like a floor-resting one, with no height-off-floor callout and no facing information.

## Storage, cloud backup and sync

- **2026-07-19** Snapshots share the origin: the last-5 IndexedDB snapshots recover from corruption and bad saves, not from eviction.
- **2026-07-19** The Dropbox app ships the app key only — the app secret is never used or shipped; PKCE S256 + state validation, code consumed only on `/auth/dropbox/callback`, App Folder scope, no chooser/saver/embedder domains or webhooks.
- **2026-07-19** `VITE_DROPBOX_CLIENT_ID` is baked at build time: it must be in `.env.local` on the build machine before `wrangler deploy` (a Cloudflare dashboard var never reaches the bundle). The feature hides entirely when unset.
- **2026-08-19** The Dropbox rev is the only lineage; timestamps are display-only and the dialog says so.
- **2026-08-19** Sync writes are rev-conditional (`mode: update`, `autorename: false`, `strict_conflict: true`), so a lost race fails classified `"conflict"` instead of overwriting or spawning `(1)` files.
- **2026-08-19** Replace mode (`importPackage.ts` `replaceProjectId`) is the only path allowed to reuse an existing project id, and only after a recovery snapshot and a re-check that the target didn't drift while a dialog was open; either prerequisite failing aborts with the local copy untouched.
- **2026-08-19** A pull seeds `cloudBackupMeta` so it never burns a `/backups` retention slot re-uploading what it just downloaded; a restore does the same at commit.
- **2026-08-19** A missing head is surfaced, never silently recreated; sync metadata bound to another account reads as unlinked but is not deleted; a folder prefix matching two heads falls back to backup wording rather than guessing.
- **2026-08-19** "Not now" persists as `paused` so a reload lands back on Needs review without re-prompting, and only a manual check clears it; Escape resolves as "Not now" because dismissing must never read as picking a version.
- **2026-08-19** Conflict choices are direction-named only ("Use the Dropbox version" / "Keep this device's version" / "Keep both") and are whole-project.
- **2026-08-19** The cloud browser lists sync heads in parallel with backup folders as an independent failure domain — a heads failure must never blank the backups listing.
- **2026-08-19** A prefix match with a local project offers only "Save a copy"; copies are never linked, and the 8-char prefix is a display heuristic that fails closed to copy when the local list can't be read.
- **2026-08-19** TRAP: Dropbox uses 409 for every route error — only a `not_found` 409 may read as an empty listing.
- **2026-08-19** Upload preflight checks the 256 MB download cap so an unretrievable backup is never created.
- **2026-08-19** `/shares` is never auto-pruned because the files back live shared links; "delete everywhere" needs a remote tombstone and stays deferred.
- **2026-08-19** A shared project always opens as a new copy, fetched through the stateless worker relay.
- **2026-08-24** Backup and sync are one "Dropbox" popover row folded worst-state-first; sync attention outranks backup trouble and provider reauth outranks everything. Turning sync off lives in Settings — USER DECISION.
- **2026-08-11** TRAP: broken-image glyphs inside exported PNGs came from revoked-but-still-painted blob URLs and a production CSP `connect-src` without `blob:`; the live view looks fine either way. PDF export was never affected (it takes Blobs from the repository).
- **2026-09-01** `remotePathFor` and `maxDownloadBytes` are required members of `CloudBackupProvider`, and no store slice may import a Dropbox module.
- **2026-09-01** `ProjectSyncMeta.provider` stays the `"dropbox"` literal until a second provider is planned.
- **2026-09-17** `ProjectRepository.loadWithReport` is the ordinary open's way of keeping the load report (`supportRepairCount`) that plain `load` drops, so boot and `openProject` announce a re-fitted support the way a snapshot restore and a JSON import already do; the in-memory fake runs the same `normalizeProjectFloorSupports` rather than re-parsing, because `load` must keep handing seeded documents back by reference.

## App shell, store and hooks

- **2026-07-09** `usePlanMode` keeps the mutually exclusive plan tools in one union; `commitWallObjectEdit` and `runPartitionEdit` are the scoped reconciliation seams.
- **2026-07-17** Bulk-edit drafts and armed destructive confirms reset on selection *identity* (`selectionKey`), not count — reselecting a different same-size set must not inherit a stale draft.
- **2026-07-17** The undo/redo transaction core (`applyEdit`/`pushEditEntry`/`persist`/`setDocument`) plus artwork editing and placement stay in store.ts as the kernel — do not extract.
- **2026-07-17** `exportProjectJson` is test-only; production export goes through packages.
- **2026-08-10** A tab that hears about a newer copy reloads through `setDocument` and writes nothing back — no snapshot, no save: a tab catching up must never become the clobberer.
- **2026-08-10** A passive reload is deferred while focused, mid-save, or with an arrange preview live; a failed passive reload is logged and dropped — never a toast, never an error state.
- **2026-08-10** Advertised trade-offs: two tabs editing the same instant resolve last-write-wins, and an external reload resets that tab's undo history and selection. This is refresh, not multiplayer.
- **2026-08-10** TRAP: a vitest process is one browsing context, so every store in it hears the others' saves — inject `createInertCrossTabSync()` or a fake.
- **2026-08-10** Known limitation: only the open document and the artwork library refresh; project-manager rename/delete of a non-open project does not announce, so another tab can re-save over it.
- **2026-08-31** TRAP: `TextField` seeds its draft once per mount, so inspector inputs must be keyed on `artwork.id` — keyed on the field name alone, a blur commits the previous work's value onto the new one. Verify inspector fields expanded, not from the collapsed summary (which reads the record directly and is always right).
- **2026-09-01** `useStoragePersistence` holds local state and requests persistence in an effect, so it is called once in App and passed down.
- **2026-09-01** `hooks/useSyncLink.ts` holds the one "linked = sync meta names the OPEN project" rule, and `useCloudActions` keeps the popover row and Export-menu item from forking.
- **2026-09-01** `updateArtwork` stays in store.ts because its record edit and placement rebake are one undo entry.
- **2026-09-01** TRAP: the mapping re-guess keys on the table memo, so a same-named replacement spreadsheet no longer keeps stale column indices.
- **2026-09-01** Geometry modules must not import from the schema module — `project.ts` re-exports the case/monitor constants that now live in `caseGlyphs.ts`/`monitorGlyphs.ts`, and the reverse direction is a runtime import cycle.
- **2026-09-08** `npm run check` fails on any static runtime import cycle reachable from `src/main.tsx` or `worker/index.ts` (`check:cycles`; `import type` and dynamic-import edges are ignored, so store⇄slice type cycles are fine). Break a new cycle by moving the shared value next to its geometry (`DEFAULT_FLOOR_OBJECT_DEPTH_MM` lives in `planObjects.ts`, `findVertex` in `walls.ts`) and re-exporting from the old home.
- **2026-09-09** USER DECISION: `main` is branch-protected; work merges through a pull request whose `test` CI job is green. Admin enforcement is off, so a direct owner push remains an emergency path. CI runs `npm run build` so the bundle-size budget is enforced before merge, not at deploy.
- **2026-09-08** `build` fails if a tracked chunk (`index`, `vendor`, `three`, `pdf`, `fontkit`, `xlsx`) grows >10% over `scripts/bundle-size-baseline.json`; rebase with `node scripts/assert-bundle-size.mjs --update` only alongside the change that earns it.

## UI and design

- **2026-07-09** Toolbar grammar: Insert decorates, Draw creates — partition lives in Draw.
- **2026-07-12** Toast overrides are scoped under `.sonner-toaster` so they beat sonner's runtime stylesheet; placed-checklist rows warn only on an actual drag, never on a plain selection click.
- **2026-07-12** Import success toasts must not reuse the red error banner.
- **2026-08-10** The support-vs-work size note is a quiet `.field-hint` with an inline tertiary action, not a filled alert card — the inspector's flat-panel hierarchy wins.
- **2026-08-10** The per-face picker uses `Toggle`s against DESIGN.md's stricter `Checkbox` reading, deliberately, because latching-toggle grammar is already used for "Keep proportions" and Visible/Locked.
- **2026-08-11** Checklist sections are always collapsible; auto-expand fires only when `selectedArtworkId` actually changes (tracked in a ref), never on every render, and the panel never auto-switches away from what it is showing.
- **2026-08-19** Import-dialog styling lives in `global.css` (`.import-conflict-*`), not Tailwind-only.
- **2026-08-28** PDF-dialog wall lists default collapsed with count badges so every top-level section header sits above the fold; a sticky bottom fade signals overflow.
- **2026-08-31** Checklist sort and group-by-artist are project data (`project.checklistView`), travelling with packages and sync at the accepted cost of dirtying the document; writes go through `applyEdit` and are undoable — USER DECISION.
- **2026-08-31** With `checklistView` absent the panel derives a group-show default live (≥2 artists each with ≥2 works; blank artists never count); the first explicit choice permanently supersedes the heuristic. Search, filter and collapsed groups stay session state.
- **2026-08-31** The Medium combobox is free-solo: an exact-match committed value always reopens to the full list, prose values open no popup, focus never leaves the input, and Enter selects only an explicitly highlighted row (the native `<datalist>` filter-to-match glitch this replaced).
- **2026-09-01** `--dialog-width` on `.dialog-content` and `.seg-compact`/`.seg-compact--lg` are the single declarations; do not re-add per-component overrides.
- **2026-08-19** User-facing copy says "project", never "document" — "document" is internal vocabulary a curator reads as a file.
- **2026-08-19** A copy layer belongs in `src/app/`, not `src/domain/`; check with `grep -rn 'from "../../app/' src/domain/` (should be empty).

- **2026-09-18** The wall-work inspector shows the support relationship as a "Support" summary row ("Hung on the wall" with an Add shelf action, or "Shelf" with Select shelf), derived from `getShelfRiders` on every render — never a stored flag and never a two-way select, because leaving a shelf is a drag, not a menu choice. The shelf inspector is state-aware: a teaching notice at zero riders, "Holds N works" with Select works otherwise.

## Working method (verification and review)

- **2026-08-06** Review needs three independent forms of evidence — automated tests, a real browser boot and interaction, and byte/file-type/textual-diff checks. Any one can be green while the shipped result is broken.
- **2026-08-06** TRAP: a textual `\u0000` escape silently converted to a literal NUL byte makes a file binary to git, and `od -c` cannot detect it (both render as `\0`) — use `file`, `git diff --stat`, or a byte count.
- **2026-08-06** Verify tests, not just run them: break the fix, confirm the test fails, restore. A snapshot-ordering test passed vacuously until it asserted the landed copy is the **pre-repair** original.
- **2026-08-06** Delegate by file ownership with no shared files and no cross-dependency; sequence whenever two tasks touch the same function or test file, and keep the integration seam in the main session where verification is.
- **2026-08-06** Forbid `git stash`, `git checkout`, and repo-wide resets in every agent brief — the checkout is shared with parallel sessions.
- **2026-08-06** Perf budget: analysis runs once per committed edit (room drags commit on release), measured 7.8 ms for load repair and 0.9 ms for the conflicts selector on the 10-room/200-work benchmark — re-confirm against it if the scope of analysis grows.
- **2026-08-19** Review the backup/restore interaction loop adversarially, not each layer alone — an independent second review after the stage-1 commit found five real issues.
- **2026-09-01** Comment rule throughout the repo: keep the sentence that states an invariant a future edit could break, cut the sentence that recounts what a previous commit decided.
