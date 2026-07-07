# 3D Preview — Slice Spec

Status: approved for implementation · Written: 2026-07-07 · Revised 2026-07-07 after external review
Decisions confirmed with Marina: orbit + eye-level preset camera · click-to-select (no editing) · soft neutral lighting, no shadows · real cutouts for doors/windows.

## 1. Goal

Add a **simple derived 3D preview** as a third mode alongside Plan and Elevation: a read-only spatial projection of the project that lets a curator stand back from (or inside) the room and judge how the hang actually reads — scale, rhythm, sightlines toward walls — then jump back to Plan/Elevation to make changes.

Per `docs/plan.md` §1/§2: the 3D scene is a **disposable projection of project data**, exactly like the Konva plan and the SVG elevation. Project data → scene description → R3F meshes. Never the reverse. No 3D editing in this slice.

## 2. Non-goals (this slice)

- **No 3D editing** — no dragging artworks, no wall manipulation, no transform gizmos.
- **No walk/first-person navigation** — the eye-level preset is a camera position, not a movement mode.
- **No multi-room doorway sightlines** — door cutouts exist (you can see *out* of them into empty space), but the aligned-doors/see-into-next-room logic stays in the multi-room slice (`plan.md` §4.2).
- **No frames/mats, no photoreal materials, no shadows, no lighting controls.**
- **No 3D screenshot/PNG export** — that lands with the MVP-2 export work.
- **No tablet-specific polish** — but nothing may *break* touch: OrbitControls' native touch mapping (drag = orbit, pinch = zoom, two-finger drag = pan) must be left intact.

## 3. Dependencies

Add: `three`, `@react-three/fiber`, `@react-three/drei` (for `OrbitControls`), `@types/three` (dev). These were already committed to in `plan.md` §3. No postprocessing packages.

## 4. UX

### 4.1 Mode entry

- `ViewMode` in `src/app/store.ts` (line ~60) gains `"3d"`: `"plan" | "elevation" | "data" | "3d"`.
- The topbar mode `ToggleGroup` in `App.tsx` (currently Plan/Elevation, ~line 910) gains a **3D** tab; the `value === "plan" || value === "elevation"` guard extends to `"3d"`. This matches the shell decision recorded in `docs/progress.md` ("3D will be a mode tab", not a rail item). Tab label stays **3D** (short, explicit); empty-state and control-cluster copy may say "3D Preview".
- Left panels (Checklist, Rooms & Walls) and the right inspector remain available in 3D mode, same grid as Plan/Elevation. Insert tools in the topbar are **disabled** in 3D mode (same treatment as Data view).

### 4.2 Camera

- **Default: orbit.** `OrbitControls` with damping. On entering 3D mode the camera frames the scene: positioned above and outside at ~35–45° elevation, target at the floor-center, distance fit to the bounding box with margin. Framing fits the **union of all room floor polygons** (identical to "the room" today, correct on day one when multi-room arrives — do not fit against `rooms[0]` only).
- **Auto-fit runs only on first entry to 3D mode and on project switch.** It does not re-run on selection changes, texture loads, inspector edits, or room-geometry changes — the user reclaims framing via the Overview preset. (A camera that jumps while you edit room height from the inspector is worse than a stale framing.)
- **Eye-level preset.** A small control cluster overlaid in the viewport (bottom-left, matching the plan toolbar's visual language) offers:
  - **Overview** — returns to the fitted orbit framing (also the entry state).
  - **Eye level** — animates the camera to a standing viewpoint: eye height = `project.defaultCenterlineHeightMm` (the artwork centerline doubles as a reasonable eye proxy; revisit with a dedicated setting later), positioned inside the room at a point that gives a comfortable view of the target wall. Target-wall priority: (1) the selected wall (`selectedWallId`), (2) the wall containing the selected wall artwork if the selection came from the checklist/inspector, (3) the longest wall, (4) the first wall. The OrbitControls target moves to that wall's center at eye height, so subsequent orbiting pivots around what you're looking at.
  - Both are presets, not modes — after either, the user is still in free orbit.
- Camera state is transient view state: not persisted, not undoable, reset on project switch.

### 4.3 Selection (click-to-select, no editing)

- Clicking an artwork plane (wall or floor object) raycasts and calls the existing `selectObject(id)` — the shared selection store, so the right inspector immediately shows the artwork and numeric editing happens there. Modifier-click uses `{ additive: true }`, same as Plan.
- Clicking a wall surface (not an artwork) calls `selectWall(wallId)`.
- Clicking empty space / floor clears object selection (same settle semantics as Plan — the store's auto-accept of pending arrangements already handles this via `setObjectSelection`).
- **Event precedence:** artwork and floor-object pointer handlers must `stopPropagation()` so the wall/floor beneath does not also receive the click; empty-space deselection fires only from the canvas/floor/background handler when no object handled the event. (Prevents "clicked the artwork and it deselected itself".)
- Selection renders as an **accent edge outline** on the selected mesh — petrol/accent token, consistent with the 2D selection language. **Never tint the artwork image texture itself** (it would defeat the color-fidelity material setup in §6.2); walls and untextured floor boxes may additionally tint. Selection made *elsewhere* (checklist row, inspector) highlights in 3D too, since it's the same store slice.
- No hover-dependent affordances (tablet rule) — a light pointer-cursor change on desktop is fine, nothing load-bearing.

### 4.4 Uncertainty

Artworks with `dimensions.status` of `"approximate"` or `"unknown"` must read as uncertain in 3D, consistent with the shared indicator language (`plan.md` §7, `UncertaintyIndicator`):

- **Unknown dims**: neutral placeholder plane (no texture even if an image exists is *wrong* — do show the image, but at the same placeholder sizing rules `elevationArtworkGeometry` uses) with a dashed edge outline.
- **Approximate dims**: normal textured plane plus the dashed edge outline.
- Dashed edges in WebGL: use `LineSegments` with `LineDashedMaterial` (call `computeLineDistances()`), rectangle outline slightly proud of the plane.

## 5. Architecture

### 5.1 Derivation layer (pure, tested)

New module `src/domain/geometry/scene3d.ts`: a **pure function** from `Project` to a serializable scene description — no three.js imports, fully unit-testable:

```ts
type Scene3d = {
  rooms: Room3d[];
};
type Room3d = {
  roomId: string;
  floorPolygon: Vec2[];            // floor-space, mm, after RoomPlacement offset/rotation
  walls: WallPanel3d[];
};
type WallPanel3d = {
  wallId: string;
  start: Vec2; end: Vec2;          // floor-space mm
  heightMm: number;
  holes: Hole3d[];                 // door/window cutouts, wall-local coords
  artworks: WallArtwork3d[];       // wall-local x/y center, w/h, assetId, status, objectId
  blockedZones: Rect3d[];
};
type Hole3d = {
  kind: "door" | "window";
  xMinMm: number; xMaxMm: number;  // wall-local, along the wall
  yMinMm: number; yMaxMm: number;  // wall-local, 0 = floor
  clamped: boolean;                // true if the source object overflowed wall bounds
};
// + FloorObject3d for floor artworks / blocked zones
```

The domain stores wall objects by **center** (`WallObjectBase.xMm/yMm` — see the comment at `FloorObjectBase` in `src/domain/project.ts`). The derivation converts center+size → explicit min/max extents exactly once, here; the render layer never does center math. Doors force `yMinMm = 0` (floor-to-top cutout) regardless of the stored center; windows keep their floating extent.

All the fiddly logic lives here and gets vitest coverage: wall-local → floor-space transforms (reusing the vertex/wall math the elevation view already relies on), door holes extending floor-to-top vs window holes floating, hole clamping to wall bounds, placeholder sizing for unknown dims (reuse `elevationArtworkGeometry` rules), `RoomPlacement` offset/rotation application, iterating `floor.rooms` (plural — works day one when multi-room arrives).

**Wall orientation must be tested, not assumed.** The single-sided dollhouse effect (§5.3) lives or dies on winding order. The derivation exposes each wall's inward direction (implicitly via `start`/`end` order convention — document which), and tests must cover: a clockwise room polygon, a counterclockwise one (or an explicit normalization step with a test proving it), a rotated `RoomPlacement`, a non-rectangular polygon room, and an assertion of each wall's computed inward normal — not just wall positions.

### 5.2 Render layer (R3F)

New `src/app/components/three/` directory:

- `ThreeDView.tsx` — the mode's root: `<Canvas frameloop="demand">`, camera rig, lights, `<SceneRooms>`, viewport control cluster, empty state (reuse the Plan/Elevation empty-state pattern when there's no room).
- `SceneRooms` / `WallPanel` / `ArtworkPlane` / `FloorObjectBox` — dumb mappers from `Scene3d` to meshes.
- `useArtworkTextures` — texture loading (see §6.3).

Coordinate convention: **mm → meters at 0.001** (three.js sanity for camera/near-far), plan (x, y) → three (x, z), height → three +y. One `mmToWorld` helper, used everywhere.

### 5.3 Geometry specifics

- **Floor**: `ShapeGeometry` from the room polygon, lying in the xz-plane. Matte neutral material (light warm grey token). A very subtle larger ground plane beneath (or nothing — decide in polish; default nothing, background color carries it).
- **Walls**: one `ShapeGeometry` per wall — a rectangle (wall length × wall height) with door/window `holes` as `Shape.holes` — positioned/rotated into place. **Zero thickness, single-sided, facing inward.** From outside the room, far walls read normally and near walls are invisible (dollhouse effect), so orbit always shows the interior; from inside at eye level, all walls read normally. This is the standard trick and avoids double-geometry.
- **Doors / windows**: rendered directly from `Hole3d` extents (§5.1) — doors arrive as floor-to-top (`yMinMm = 0`), windows as floating rectangles; the render layer does no coordinate math. Blocked zones on walls: translucent tinted quad flush to the wall (they're planning annotations, not physical).
- **Artworks (wall)**: textured `PlaneGeometry`, offset ~20 mm off the wall toward the room to avoid z-fighting. `toneMapped` off or a plain `MeshBasicMaterial`-adjacent setup so image colors stay faithful (see §6.2).
- **Floor objects**: `BoxGeometry` (`widthMm × heightMm × depthMm`) sitting on the floor at its position/rotation. `FloorObjectBase` requires all three dimensions, so zero-volume boxes can't occur from the domain side; placeholder sizing for unknown *artwork* dims is already resolved at placement time. Neutral matte material; artwork floor objects get the uncertainty edge treatment when applicable but **no image texture** this slice (draping an image on a sculpture box misleads more than it informs). Floor blocked zones: flat translucent quad on the floor.

## 6. Rendering & performance

### 6.1 Lighting (decision: soft neutral, no shadows)

- Ambient light (~0.9) + one gentle directional light (~0.4) from high front-left, **`castShadow` off everywhere**. Enough for walls/floor to shade slightly differently and read as volume; calm, cheap on iPad.
- Background: the app's canvas background token (near-white), fog off.

### 6.2 Materials

- Walls/floor: `MeshLambertMaterial` (cheap, takes the lights).
- Artwork images: `MeshBasicMaterial` with the texture and `toneMapped: false` — artwork color fidelity beats lighting realism; a curator judging a hang must not see a lighting-tinted version of the work. Set renderer `outputColorSpace` sRGB and texture `colorSpace = SRGBColorSpace`.

### 6.3 Textures

- **Display tier** (~1600–1800 px WebP) per `plan.md` §4.5, via the asset repository. Follow the `useAssetImageUrls` pattern (object-URL lifecycle) → `TextureLoader` per URL; new hook `useArtworkTextures` owns the full chain and **disposes textures** when an asset drops out or the view unmounts (GPU memory, not just object URLs). The hook must ignore stale async loads that resolve after unmount or after the assetId changed, and must dispose replaced textures, not only removed ones.
- Cache keyed by assetId; a failed load falls back to the neutral placeholder material, never breaks the scene.
- Set `anisotropy` to a modest value (4–8) so oblique eye-level views of far walls stay legible.

### 6.4 Frame loop

- `frameloop="demand"`: render only when something changes. Invalidate on OrbitControls change events, store-driven scene changes (subscribe to the derived scene inputs), and camera preset animations. The 3D view must cost ~zero GPU/battery while idle — this is a planning instrument, not a game.
- Cap DPR at 2. Do not add postprocessing or custom antialiasing passes.

## 7. Store changes (small)

- `ViewMode` union + `setViewMode` already generic — just extend the type and the App.tsx guards/disabled states.
- No new persisted state. No new undoable commands (nothing in 3D mutates the document).
- Selection: no new APIs needed — `selectObject`, `selectWall`, `setObjectSelection` cover it.

## 8. Milestones

Sequenced so each lands reviewable and the app is never broken:

1. **M1 — Scaffold + room shell.** Deps installed; `"3d"` mode tab wired; `scene3d.ts` derivation for floor + walls (no holes yet) with unit tests; `ThreeDView` renders floor/walls with lighting and orbit; fitted entry framing; empty state.
2. **M2 — Artworks.** Wall artwork planes with display-tier textures, placeholder + uncertainty treatment, texture lifecycle hook; floor objects as boxes; floor/wall blocked zones.
3. **M3 — Openings.** Door/window holes in the derivation (tests for clamping/edge cases) and `Shape.holes` rendering.
4. **M4 — Selection + eye-level + polish.** Raycast click-to-select synced with the store; selection highlight; Overview/Eye-level presets with animated transitions; disabled-tool topbar states; `/verify` pass in the browser; update `docs/status.md`, `docs/progress.md`.

Implementation is delegated to subagents per workflow preference; the main session verifies each milestone in the running app before the next starts.

## 9. Acceptance criteria

- [ ] 3D tab appears in the topbar; switching modes preserves selection and panels; Plan/Elevation behavior unchanged.
- [ ] Room floor + walls render at correct scale from real project data; wall heights per-wall (`Wall.heightMm`), including after room resize.
- [ ] Every placed wall artwork appears at its exact position/size with its display-tier image; unknown/approximate dims show the uncertainty treatment.
- [ ] Doors read as floor-to-top cutouts, windows as floating cutouts; you can see out through them.
- [ ] Floor objects render as correctly sized/rotated boxes at their positions.
- [ ] Clicking an artwork in 3D selects it in the shared store (inspector updates); clicking empty space deselects; checklist selection highlights in 3D.
- [ ] Overview and Eye-level presets work; orbit/pan/zoom smooth; touch mapping intact (verify in devtools touch emulation minimum).
- [ ] Idle 3D view renders on demand only (no continuous rAF loop when nothing moves).
- [ ] `npm run check` and `npm test` pass; `scene3d.ts` derivation has meaningful unit coverage (including the wall-winding/normal fixtures from §5.1).
- [ ] No document mutation is possible through direct 3D viewport interactions. Inspector edits remain fully functional in 3D mode and update the derived preview.

## 10. Risks / open edges

- **Zero-thickness walls** are a rendering convention, not physical truth — fine for this slice, but if wall thickness ever enters the domain model (it isn't there today), the derivation layer is the single place to change.
- **Eye height = centerline height** is a pragmatic proxy; if users trip on it, add a per-project `eyeHeightMm` setting (tiny change, deferred).
- **Texture memory on iPad** with large checklists: display tier keeps this in budget per `plan.md` §3.5, but if a project has 100+ placed works, consider lazy-loading textures by wall visibility later — not this slice.
- **Non-rectangular rooms**: the derivation iterates vertices generically, so polygon rooms (next roadmap slice) should Just Work — keep the derivation free of rectangle assumptions and add a polygon fixture test now to lock that in.
- **Overlapping door/window holes** on one wall triangulate with minor visual artifacts (`Shape.holes` doesn't union overlaps). The domain already flags overlapping placements for review, disjoint holes render cleanly, and nothing crashes — union-merging overlapping holes is deferred until it bites a real project.
