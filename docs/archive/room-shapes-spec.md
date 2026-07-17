# Complex Room Shapes — Spec

Status: slices 1-5 shipped · Written: 2026-07-08 · Refreshed: 2026-07-10
Decisions confirmed with Marina: free-standing walls are **double-sided** placement surfaces · free-standing walls are **room-owned** · **polygons only**, no curved walls · **both doors and windows** can pair across rooms for 3D see-through.

## 1. Goal

Take room geometry from "rectangles plus a data model that could do more" to the real thing, in three pillars:

- **A. Polygon rooms** — draw and reshape any straight-walled room shape (L-shapes, angled walls, irregular galleries), while keeping the one-click rectangle path untouched.
- **B. Free-standing walls (partitions)** — walls in the middle of a room, connected to nothing, movable and rotatable, with artwork placeable on **both faces** and each face getting its own elevation view. Placement, validation, and 3D must treat them as first-class surfaces.
- **C. Paired openings across rooms** — doors *and* windows on abutting rooms can be explicitly connected, giving an advisory aligned/misaligned status in 2D and a true see-through opening in 3D.

This follows the architecture rules of `docs/plan.md` §1/§2 and the prescriptions already laid down in §4.2: pure domain logic in `src/domain/`, views as disposable projections, one `applyEdit` commit per gesture, mm-suffixed fields, stable IDs over indices. Where this spec revises §4.2 (one place — see §5.1), it says so explicitly.

**The critical structural fact this spec leans on:** arbitrary polygon rooms are *already valid data*. `Room.vertices` + `Room.walls` is a generic closed polygon; schema v2 validates any simple closed loop (superRefine in `src/domain/schema/projectSchema.ts`); `deriveScene3d` already iterates polygons generically with winding normalization and inward-normal orientation. Pillar A is constructors, tools, and UI — **no schema change, no migration**. Only pillar B (and C's field change) needs schema v3.

## 2. Non-goals (this slice group)

- **No curved walls.** Straight segments only; arcs would need a new geometry model, curved elevation, curved placement math, and 3D meshing. Out of scope entirely, not deferred within this spec.
- **No room rotation.** `RoomPlacement.rotationDeg` stays schema-locked to 0 (per `plan.md` §4.2). Consequence for pillar C: paired openings require the two walls to be anti-parallel *as drawn*. Angled polygon walls can still pair (the alignment test is angle-based, not axis-aligned); rooms just can't be rotated to make walls meet.
- **No doors or windows on free-standing walls (v1).** A through-cut punches both faces and needs mirrored blocking extents in validation plus double holes in 3D. Blocked-zones on partition faces *are* allowed (they're face-local annotations with no through-cutting semantics). The through-cut design is sketched in §10 for later.
- **Numeric polygon-wall length editing uses an explicit anchor.** The wall inspector lets the curator keep either the segment's start or end fixed. The adjacent wall at the free end translates parallel to itself through the same `moveRoomWall` geometry used by rectangle resizing, so the selected segment reaches the exact entered length without silently choosing an anchor. Numeric room width/depth remains rectangle-only.
- **No walls-with-thickness for perimeter walls.** Perimeter walls stay zero-thickness lines; only partitions get `thicknessMm` (§5.4). The visual inconsistency is accepted (§10).

## 3. What already exists (build on, don't rebuild)

| Capability | Where | State |
|---|---|---|
| Polygon room data model (vertices + wall loop, stable IDs) | `src/domain/project.ts`, `src/domain/schema/projectSchema.ts` | Done — schema v2 validates arbitrary simple loops |
| Multi-room floor, shared coordinate space | `Floor.rooms: RoomPlacement[]` | Done — offset-positioned rooms render/move/select today |
| Generic polygon → 3D derivation (winding, inward normals, holes) | `src/domain/geometry/scene3d.ts`, `WallPanel.tsx` | Done — non-rectangular fixture tests in place |
| Door/window/blocked-zone openings, armed placement tools | `createOpening.ts`, store, `PlanView.tsx` `activeTool` | Done |
| Single placement entry point + wall capture + hysteresis | `resolvePlanPlacement` (`planSnapTargets.ts`), `findNearestWall` (`planObjects.ts`) | Done — reused unchanged (§6.1) |
| Validation (bounds advisory / opening collision blocking / overlap advisory) | `validatePlacement.ts` | Done — extended only via the wall-geometry map (§6.2) |
| `connectsToObjectId` on connectable openings | `src/domain/project.ts`, schema | v3 field exists and validates symmetric pairs; writers/UI pending slices 4-5 (§5.5) |
| Rectangle fast path (dimension fields, resize handles) | `walls.ts` `getRectangleRoomDimensions`, `RoomResizeHandles.tsx` | Done — stays gated exactly as-is |

The hard blocker: the schema's closed-loop superRefine (`walls[i].endVertexId === walls[i+1].startVertexId`, wrapping) makes a lone unconnected wall unrepresentable as a `Wall`. Free-standing walls are therefore a **new entity**, not a relaxation of the loop invariant (§5.2).

## 4. Vocabulary

- **Perimeter wall** — a `Wall` in a room's closed loop, as today.
- **Free-standing wall / partition** — a new `FreestandingWall` entity: a room-owned segment with thickness, connected to nothing.
- **Face** — one of the two placeable sides of a partition (`a`/`b`). Faces are *derived*, Wall-like, and carry stable IDs; wall objects hang on faces, never on the partition itself.
- **Paired openings** — two door (or two window) wall objects on different perimeter walls that reference each other; **connection** is the stored pairing, **alignment** is the derived geometric status.

## 5. Data model

### 5.1 Relationship to `plan.md` §4.2

This spec implements §4.2's prescriptions as written — polygon draw as a dedicated mode, vertex drag moving referencing walls, vertex insert splitting one wall into two, rectangle fast path preserved, structural invariants validated at the schema boundary — with **one deliberate revision**: doorway/window pairing moved from `connectsToWallId` (wall-level) to `connectsToObjectId` (opening-level). A wall can carry several openings, so a wall-level pointer cannot identify the counterpart hole, its extent, or its kind. The old field had zero writers, so replacing it in schema v3 was a clean migration. `docs/plan.md` §4.2 now points to this object-level pairing shape.

### 5.2 `FreestandingWall` — new entity on `Room`, inline endpoints

```ts
// src/domain/project.ts
export type FreestandingWall = {
  id: string;
  roomId: string;
  name: string;                 // "Partition 1"
  // Room-local mm, same coordinate space as RoomVertex. Inline points,
  // deliberately NOT entries in room.vertices.
  startXMm: number; startYMm: number;
  endXMm: number;   endYMm: number;
  heightMm: number;             // defaults to room.heightMm at creation
  thicknessMm: number;          // §5.4; default 100
  defaultCenterlineHeightMm?: number;   // mirrors Wall
};

export type Room = {
  // …existing fields…
  freestandingWalls: FreestandingWall[];
};
```

**Why inline endpoints, not shared `RoomVertex` entries:** vertex IDs exist to express *shared corners* between loop walls; a partition shares nothing. Putting its endpoints in `room.vertices` would force every consumer of `vertices` (floor bounds, floor-polygon triangulation, winding, containment) to filter them out, and would poison the closed-loop invariant this spec is careful not to touch. Inline points give length/angle for free via the same segment math as `getWallGeometry`.

**Why room-owned (confirmed decision):** room-local coordinates mean `RoomPlacement.offsetXMm/offsetYMm` moves partitions with the room automatically, and `deleteRoom` cascades by construction. No floor-level orphan semantics to invent.

**Room-height contract (extends `resizeRoomHeight`, `src/app/store.ts:706`):** today, editing room height force-syncs `room.heightMm` and every perimeter `wall.heightMm` together. Partitions get **follow-the-default** semantics instead: `resizeRoomHeight` also updates any partition whose `heightMm` equals the *previous* `room.heightMm` (i.e. an untouched default follows the room), and leaves partitions with an explicitly different height alone — partitions deliberately built below ceiling height are a core gallery pattern, and force-syncing them would fight the `FreestandingWallInspector` height field. The asymmetry with perimeter walls is deliberate and this spec's decision of record. `changedWallIds` from a room-height edit includes both face IDs of every partition whose height changed, so their placements revalidate.

### 5.3 Double-sidedness — derived face pseudo-walls, not stored records

Each partition exposes **two derived, Wall-like faces** with stable IDs:

- Face ID scheme: `${freestandingWallId}#a` and `${freestandingWallId}#b`. The schema bans `#` in all real `Wall`, `RoomVertex`, and `FreestandingWall` IDs so face IDs can never collide. Parsing is centralized — never string-split at call sites:

```ts
// src/domain/geometry/freestandingWalls.ts
export function faceWallId(wallId: string, face: "a" | "b"): string;
export function parseFaceWallId(id: string): { freestandingWallId: string; face: "a" | "b" } | null;
```

- **Derived, not stored.** Stored face records would duplicate geometry (two records that must agree with the centerline forever); every move/rotate would write three records atomically, with superRefine glue to prevent drift. Derived faces cannot drift, and everything downstream already consumes walls through derivation choke points.

**Face orientation convention (load-bearing):**

- Face **A** is the side toward the **left normal of start→end** (`(-dy, dx)` — the same convention as `wallInwardNormal` in `scene3d.ts`). Face A's derived geometry runs start→end.
- Face **B**'s derived geometry runs **end→start** (endpoints swapped).

Each face then satisfies exactly the existing perimeter-wall contract — *the viewer's side is on the left of the face's own start→end*. What falls out for free: elevation renders each face as seen by someone standing on that side (mirror-correct — face B's `xMm` is measured from the physical end vertex, which is precisely the mirror-correct coordinate for that side); `scene3d`'s single-sided panel convention holds per face with zero render-layer changes.

**Wall objects store the face ID in `wallObject.wallId`.** The bare partition ID is never stored in `wallObjects`. This is the move that lets all existing placement, validation, elevation, and selection machinery work unchanged — a face is just another wall as far as `wallId` consumers are concerned.

**Where faces get injected** (the complete list — found by grepping `getWallsWithGeometry` consumers):

- `getProjectWalls` (`src/app/projectWalls.ts`) — sidebar/elevation wall list, display names "Partition 1 — side A".
- `getFloorWalls` (`src/domain/geometry/planObjects.ts`) — plan capture/snapping pool (§6.1).
- `validateWallObjects`' wall-geometry map (`validatePlacement.ts`) — bounds/collision per face (§6.2).
- `deriveScene3d` (`scene3d.ts`) — face panels (§7.1).

`getWallsWithGeometry` (`walls.ts`) itself stays **perimeter-only** — loop invariants (`hasLoopingWallOrder`, `resizeOrthogonalQuad` index arithmetic) depend on it seeing only the loop.

Derivation entry point:

```ts
// src/domain/geometry/freestandingWalls.ts
export type FreestandingFace = WallWithGeometry & {
  face: "a" | "b";
  freestandingWallId: string;
  thicknessMm: number;
};
// Face endpoints are offset thicknessMm/2 along the face's outward normal
// from the stored centerline; length equals centerline length.
export function getFreestandingFaces(room: Room): FreestandingFace[];
```

### 5.4 Thickness — stored `thicknessMm`, default 100 mm

Perimeter walls stay zero-thickness. Partitions get real thickness because:

1. **Plan legibility and hit-testing** — a zero-width line in the middle of a room is nearly unclickable and unreadable; a 100 mm slab renders as a thin filled rect, which is how galleries draw partitions anyway.
2. **3D correctness** — two opposite-facing coplanar single-sided panels z-fight at grazing angles and vanish end-on. Faces offset ±t/2 plus caps give a convincing slab for ~4 extra quads (§7.1).
3. **Placement math gets simpler, not harder** — physically offset face segments make nearest-face capture fall out of the existing distance test with no side-of-line logic (§6.1).

Schema: `positive()`; UI minimum ~25 mm; editable in the inspector.

### 5.5 Opening pairing — `connectsToObjectId` (opening→opening)

```ts
// Split the opening union so an illegal blocked-zone connection is
// unrepresentable in TS, not just rejected by the runtime schema.
export type ConnectableOpeningWallObject = WallObjectBase & {
  kind: "door" | "window";
  blocksPlacement: true;
  connectsToObjectId?: string;   // v3; replaces never-written connectsToWallId
};
export type BlockedZoneWallObject = WallObjectBase & {
  kind: "blocked-zone";
  blocksPlacement: true;
};
export type OpeningWallObject = ConnectableOpeningWallObject | BlockedZoneWallObject;
```

Existing consumers that treat all three kinds uniformly (validation, plan/elevation rendering, `createOpening.ts`) keep working — the union's common fields are unchanged; only `connectsToObjectId` narrows.

**Invariants** (project-level superRefine — pairing spans the flat `wallObjects` array):

- Symmetric double-pointer: if `a.connectsToObjectId === b.id` then `b.connectsToObjectId === a.id`. Enforced, not derived.
- Both endpoints exist; `a.id !== b.id`; both are openings of the **same kind**; kind is `door` or `window` — never `blocked-zone`.
- Both live on **perimeter** walls (`parseFaceWallId(wallId) === null`) of **different** walls. Same-room vs cross-room is not schema-enforced; geometry decides usefulness.
- **Geometric alignment is NOT a schema invariant.** Whether the pair lines up is a derived advisory status (§7.2). A schema that rejects a saved project because someone dragged a room is hostile; a warning badge is right.

**Lifecycle** (store edits, one commit each):

- `connectOpenings(aId, bId)` writes both pointers in one `applyEdit`.
- Deleting either opening — directly, or via its wall/room/partition cascade — clears the partner's pointer **in the same commit**. No dangling refs ever persist.
- Moving either side keeps the pairing; alignment status just degrades to "misaligned" (inspector warning, capped in 3D).
- Changing an opening's kind clears the pairing (with a toast).

### 5.6 Schema v3 + migration

`CURRENT_SCHEMA_VERSION = 3`, defined **once** with both changes — `freestandingWalls` and `connectsToObjectId` — even though pillars B and C ship in different slices, so users migrate a single time.

- `roomSchema` gains `freestandingWalls: z.array(freestandingWallSchema).default([])`, with superRefine: unique IDs; `roomId` matches the room; endpoints not coincident (length > 0); no `#` in IDs (the `#` ban also lands on wall/vertex IDs).
- `openingWallObjectSchema`: drop `connectsToWallId`, add `connectsToObjectId`; add the pairing superRefine at project level.
- **Migration now uses a stepwise chain.** `migrateProject` applies versioned migrations in a loop, so a v1 document walks 1→2→3 instead of relying on a single hardcoded legacy case. The v2→v3 step adds `freestandingWalls: []` to every `floor.rooms[].room`, strips any old `connectsToWallId` keys (never written by the app; discarding is safe), and bumps the document to schema v3. Migration tests cover both v1→v3 and v2→v3.
- `wallObjects[].wallId` is deliberately still not cross-checked in schema (dangling walls remain a runtime advisory); face IDs inherit that policy for consistency.

## 6. Domain behavior

### 6.1 Placement capture and snapping — zero changes to the resolver

`getFloorWalls(floor)` appends one `FloorWall` per partition face at the **offset** endpoints (centerline ± t/2 along that face's outward normal, lifted by the room's placement offset). Because faces are physically offset, nearest-face selection needs no side-of-line test: for a cursor at perpendicular distance *d* from the centerline on side A, the distance to face A's segment is |d − t/2| and to face B's is d + t/2 — the correct face always wins `findNearestWall`/`captureWall`, and break-free hysteresis (the 1.5× radius for the current wall) works per face ID exactly as for walls today. **`resolvePlanPlacement` is untouched.**

One addition at the call sites: the door/window armed tools capture "the nearest wall at any distance," so their candidate set is filtered to perimeter walls (`parseFaceWallId(...) === null`) — openings on partitions are disallowed in v1 (§2). A validation guard backs up the tool filter.

### 6.2 Validation

- `validatePlacement.ts` is keyed by `wallObject.wallId` against a per-wall geometry map; faces slot in by extending that map with face entries. Bounds (advisory), collision vs openings (blocking), artwork overlap (advisory) all work per-face automatically.
- Objects on face A vs face B have different `wallId`s, so they **never collide or warn against each other — correct**: back-to-back hangs on a partition are physically fine. No shared-x-extent rule for artworks.
- The existing "missing wall" advisory covers deleted partitions between validation runs; the store cascade (§6.5) makes that transient at most.

### 6.3 Polygon rooms — constructor, draw, reshape

**Constructor** — `createPolygonRoomPlacement({ roomId, name, heightMm, pointsFloorMm })` in `createRoom.ts`:

- Placement offset = polygon bbox min; vertices stored room-local (bbox-min origin), matching the rectangle constructor's convention.
- **Winding normalized to CCW at creation** (matching `deriveScene3d`'s signed-area test), and **only** at creation — never re-reverse a wall list post-creation, because wall objects' `xMm` depends on start/end identity. After creation, winding can only flip via self-intersection, which reshape blocks, so create-time normalization suffices.
- IDs `${roomId}-v-${n}` / `${roomId}-wall-${n}` (next index derived from existing IDs, like `getNextRoomNumber`); names "Wall 1..N".
- Rejects: <3 points; near-coincident consecutive points (<~10 mm); self-intersecting input (defense in depth behind the draw tool).
- **Collinear merge at close** (added 2026-07-08 after user testing): interior vertices whose adjacent segments are collinear and same-direction are dropped — including the wrap-around seam at the first point — so a straight run drawn in several strokes becomes one wall. Draw-time only; reshape keeps explicit vertex delete and never auto-merges.

New shared predicates in `src/domain/geometry/polygon.ts`: `segmentsIntersect`, `isSimplePolygon`, `isPointInPolygon` (the last also serves partition room-assignment and future camera containment).

**Draw state machine** — transient state in `App.tsx` alongside `activeTool` (mutually exclusive with it), preview rendered by `PlanView`. **No store writes until close** — the whole polygon commits as one `applyEdit("Add room")`, so undo removes the room atomically and Escape mid-draw costs nothing.

```
idle ─ arm "Draw room" ─▶ drawing { points: [] }
drawing:
  click        → candidate = snap(pointer)  [grid + axis-lock to previous point; Shift forces H/V]
                 segment would intersect a placed segment? reject (red preview), stay
                 else append
  click ≤ ~12px of points[0] AND points ≥ 3 → close
  Enter (points ≥ 3) → closing segment intersection-tested → close or reject
  Backspace    → pop last point
  Escape / mode switch → cancel, discard
close → createPolygonRoomPlacement → applyEdit → select room, wallContextId = first wall
```

Live segment-length readout follows the cursor (reuse `PlacementTooltip` + units formatting).

**Reshape** — new `src/domain/geometry/reshapeRoom.ts`, same result shape as `editRoom.ts`:

```ts
export function moveRoomVertex(project, roomId, vertexId, nextLocalMm: Point): GeometryEditResult;
export function splitWall(project, wallId, xAlongMm: number): GeometryEditResult & { newWallId: string };
export function deleteRoomVertex(project, roomId, vertexId): GeometryEditResult;  // stretch
export function moveRoomWall(project, roomId, wallId, offsetMm: number): GeometryEditResult;  // added 2026-07-08
```

- `moveRoomWall` (whole-wall drag, added after user testing — the Sims-style "shorten one arm of the L" gesture): the wall's line translates `offsetMm` along its left normal; the two neighboring walls **stay on their existing lines** and the moved wall's vertices land at the re-intersections, so neighbors keep their angles and only lengthen/shorten (user-confirmed over the rigid-translate alternative; identical for right-angle rooms). Rejections mirror `moveRoomVertex`: near-parallel neighbor (no stable intersection), non-simple result, vertices or wall length collapsing <10 mm. Objects keep `xMm` from the moved start vertex — advisory warnings, never auto-move. `changedWallIds` = the three walls.

- `moveRoomVertex` moves one vertex; both adjoining walls change length/angle. Returns `changedWallIds`; the store runs the existing `validateChangedWallPlacements` → advisory bounds warnings. **Never auto-clamp or auto-move objects** — this deliberately reuses `resizeWallPreservingAngles`' policy: objects keep `xMm` from start, overhang is flagged, the curator resolves it.
- **Self-intersection is block-commit, not warn.** During drag the tool tests `isSimplePolygon` with the candidate position; invalid positions render the outline in the danger token, and pointer-up **reverts to the last valid position**. Warn-and-allow is not viable — a non-simple polygon breaks signed area, winding, floor triangulation, and containment. Dragging a vertex onto a neighbor (<~10 mm) is likewise blocked; that's what delete/merge is for.
- `splitWall(wallId, xAlongMm)` inserts a vertex; the first segment **keeps the original wall ID** (preserving `wallContextId`, selection, and objects on that half); the second gets a fresh ID/name. Objects on the original wall with center `xMm > xAlongMm` are reassigned to the new wall with `xMm − xAlongMm` in the same commit. An object straddling the split goes with its center and picks up a bounds warning naturally.
- `deleteRoomVertex` (merge two walls, stretch goal): allowed only if the result stays ≥3 vertices and simple; the merged wall keeps the first wall's ID; objects from both walls are reprojected by floor-space center onto the merged segment via `projectPointToWall`, with bounds warnings as the backstop for anything degenerate.
- **Rectangle fast path untouched**: `RoomResizeHandles`/`RoomDimensionFields` keep gating on `getRectangleRoomDimensions`; a vertex-dragged rectangle that stops being one gracefully loses those affordances (already the behavior) and has reshape handles instead.

### 6.4 Free-standing wall operations

In `src/domain/geometry/freestandingWalls.ts`, all returning `GeometryEditResult` with `changedWallIds` containing **both face IDs** whenever length changes (feeding the existing revalidation path):

```ts
export function createFreestandingWall(project, roomId, startFloorMm, endFloorMm): { project; wallId };
export function moveFreestandingWall(project, wallId, deltaFloorMm): GeometryEditResult;       // translate
export function moveFreestandingEndpoint(project, wallId, end: "start" | "end", nextFloorMm): GeometryEditResult;
export function rotateFreestandingWall(project, wallId, angleDeg): GeometryEditResult;         // about midpoint
export function setFreestandingLength(project, wallId, lengthMm, anchor): GeometryEditResult;  // ResizeAnchor semantics
```

- Room assignment at creation: the room whose polygon contains the segment midpoint (`isPointInPolygon`). Endpoints outside the room polygon are an **advisory** warning, not a block — curators drag partitions near walls.
- Face A/B is fixed by the drawn direction (§5.3). An optional inspector "Flip sides" action swaps stored start/end **and** rewrites both faces' objects' `wallId`s and mirrors their `xMm` — one commit. Nice-to-have, not required for the slice (§10).

### 6.5 Store actions (`src/app/store.ts`)

All one-commit `applyEdit`, previews staying local to the component per the existing drag pattern:

- `addPolygonRoom`, `moveRoomVertex` (commit on pointer-up), `splitWall`, `deleteRoomVertex` (stretch).
- `addFreestandingWall`, `moveFreestandingWall`, `moveFreestandingWallEndpoint`, `rotateFreestandingWall`, `setFreestandingWallThickness` / `Length` / `Height`.
- `deleteFreestandingWall` — cascade: delete wall objects on both face IDs, clear any partner `connectsToObjectId` on deleted openings. `deleteRoom` grows the same cascade (its wall-object pruning extends to face IDs, and both cascades clear partners).
- `resizeRoomHeight` extends per the room-height contract in §5.2: partitions at the previous room height follow; explicitly overridden partition heights don't.
- `connectOpenings(aId, bId)`, `disconnectOpening(id)`.

Selection: a plan click on a partition selects the **partition** (centerline ID) for move/rotate/inspector; the inspector's "Side A / Side B" buttons set `wallContextId` to a face. `wallContextId` holding a face ID has **no semantic change** — it is still "the wall surface the sidebar/elevation shows," and `ElevationView` (fully prop-driven by `wallId`/length/height/objects) renders each face verbatim, mirror-correct per §5.3. The existing wall-switcher chip doubles as the face picker.

## 7. 3D derivation (`src/domain/geometry/scene3d.ts`)

### 7.1 Partition slabs

`Room3d` gains partitions; faces reuse `WallPanel3d` so `WallPanel.tsx` renders them with zero new mesh logic:

```ts
type FreestandingWall3d = {
  freestandingWallId: string;
  faces: [WallPanel3d, WallPanel3d];   // wallId = face ID; endpoints offset & oriented per §5.3
  capOutline: { start: Vec2; end: Vec2; thicknessMm: number; heightMm: number };
};
```

Face panels are single-sided facing *away* from the slab on each side — exactly the existing left-of-start→end contract, so dollhouse backface culling stays consistent (from side A you see face A; face B is culled). The render layer builds the top + two end caps (~3 quads) from `capOutline` so the slab doesn't read hollow. Artwork planes keep the existing ~20 mm offset off their face. `holes` stays empty in v1 (§2). Tests: assert both faces' outward normals via the existing point-probe technique, and that face B's panel-local x mirrors face A's.

**Camera and picking helpers must learn about partitions** — they currently scan only `room.walls`:

- `sceneBounds` (`ThreeDView.tsx:47`) frames the union of floor polygons + perimeter wall heights. It must also expand by each partition's cap outline endpoints and `heightMm` — a partition can be taller than its room's walls, and its endpoints can sit outside the room polygon (that's only advisory, §6.4), so bounds derived from the floor polygon alone can clip it.
- The eye-level preset's wall lookup (`ThreeDView.tsx:114`) finds the owning room via `room.walls.some(w => w.wallId === wall.wallId)` and probes room depth along the face's inward normal. It must also search partition faces (via `parseFaceWallId` → owning room), and the depth probe against the room's floor polygon still works because a face's outward normal points into the room on that side — but clamp to `EYE_MIN_STANDOFF_MM` for the advisory outside-the-polygon case, where the probe can come up empty.
- Click-to-select raycasting needs no change: face panels are `WallPanel3d`s carrying face IDs, and `selectWall(faceId)`/`wallContextId` already accept face IDs (§6.5).

### 7.2 Paired openings and see-through

The honest framing: with single-sided inward-facing walls, once two rooms abut, **every hole already "sees through"** — worse, you can see into room B through B's *solid* coplanar wall, because its backface is culled. Pillar C's 3D job is less "enable see-through" than **make non-connected geometry stop lying**.

- `Hole3d` gains `treatment: "open" | "capped"` (plus optional `connectedRoomId` for tests/debugging).
- `treatment = "open"` iff the opening has a `connectsToObjectId` partner **and** the pair passes the alignment test. The clear opening punched on both sides is the **intersection** of the two openings' floor-space extents — a 900 mm door paired with a 1000 mm door shows a 900 mm clear opening, not a mismatched overlap. With zero-thickness coplanar walls, both sides punching the same hole automatically stops the partner's wall strip from occluding.
- `treatment = "capped"`: the render layer fills the hole with a recessed neutral panel (~30 mm behind the wall plane, slightly darker token; windows get a translucent tint), so an unpaired doorway reads as "opening to nowhere," not a portal.

**Alignment test** — pure, unit-tested, in a new `src/domain/geometry/openingConnections.ts`:

```ts
// The clear opening is computed once as a floor-space segment, then projected
// into each wall's local x. One shared interval cannot serve both sides:
// paired walls are anti-parallel, so wall-local x runs in opposite directions
// and the two sides' intervals are mirrored, not equal.
export type OpeningAlignment =
  | {
      status: "aligned";
      clearA: { xMinMm: number; xMaxMm: number };   // local to opening A's wall
      clearB: { xMinMm: number; xMaxMm: number };   // local to opening B's wall
    }
  | { status: "misaligned"; reason: "angle" | "gap" | "no-overlap" | "height" };
export function evaluateOpeningPair(project, aId, bId): OpeningAlignment;
```

In floor space: (1) wall directions anti/parallel within **2°**; (2) perpendicular distance between the wall lines ≤ **250 mm** (back-to-back or a thin shared wall); (3) the openings' projected intervals overlap by ≥ **50% of the smaller opening's width** and ≥ **300 mm** absolute; (4) vertical extents overlap. Tolerances are named constants in the module — starting values to tune against real floorplans, not gospel. The same function drives the `OpeningInspector` status badge and the plan-view link glyph, so 2D and 3D can never disagree.

## 8. UI

- **Toolbar**: "Draw room" (polygon mode) and "Partition" (drag a centerline inside a room) join the armed-tool family — same `App.tsx` state lifting, mutual exclusivity, and Escape/disarm conventions as door/window/blocked-zone. The rooms panel "+" keeps the one-click rectangle: **the fast path is untouched.**
- **Partition tool**: drag draws the centerline (grid + axis-lock snapping like polygon draw); release creates at 100 mm thickness and room height. Plan rendering: filled slab rect; A/B labels when selected; body drag = move; endpoint handles = resize/re-angle; rotation via inspector angle field (a rotate handle is stretch).
- **Reshape mode**: entered via an "Edit shape" button in `RoomInspector` (double-click on the room outline as a shortcut). Draggable vertex handles; small "+" midpoint handles arm `splitWall`; Delete on a selected vertex merges (if implemented); Escape exits. Outside reshape mode, clicks keep their current meanings, per `plan.md` §4.2.
- **Inspectors**: new `FreestandingWallInspector.tsx` — length, angle, thickness, height, flip A/B (optional), delete, and "View side A / side B" buttons that set `wallContextId`. `OpeningInspector.tsx` gains a "Connects to" section: candidate list pre-filtered by `evaluateOpeningPair` viability (same-kind openings on near-parallel nearby walls), connect/disconnect, and a live aligned/misaligned badge with the reason.
- **Rooms panel** (`RoomsPanel.tsx`): partitions listed under their room, with the two faces as elevation-navigable rows — consistent with walls-as-rows today.

## 9. Slices, in order, each shippable

### Slice 1 — Polygon draw (no migration)

`polygon.ts` predicates · `createPolygonRoomPlacement` · draw mode + preview · `addPolygonRoom`.
**Accept:** draw an L-shaped room; its walls appear in the rooms panel; artwork is placeable on every wall via plan and elevation; 3D renders the correct floor and inward-facing walls; undo removes the room in one step; closing a self-intersecting polygon is impossible.

### Slice 2 — Reshape

`reshapeRoom.ts` (`moveRoomVertex`, `splitWall`; stretch `deleteRoomVertex`) · vertex/midpoint handles · store actions.
**Accept:** drag a rectangle's corner to make an L; objects on changed walls get bounds warnings and never silently move; splitting a wall keeps the original wall's ID, objects, and context; self-intersection is unreachable by drag; rectangle rooms keep dimension fields and resize handles until they stop being rectangles.

### Slice 3 — Free-standing walls (schema v3, both halves per §5.6)

Entity + migration · `freestandingWalls.ts` (faces, ops) · face injection at the four choke points · partition tool + inspector + panel rows · 3D slab.
**Accept:** draw a partition mid-room; hang artwork on both sides at the same x with no warnings; each face has a correct mirror-consistent elevation reachable from the panel and inspector; the partition moves and deletes with its room; deleting it removes both faces' objects in one undo step; 3D shows a capped slab with art on both sides, framed by the camera even when the partition is taller than the room's walls; doors/windows cannot be placed on it; editing room height carries a default-height partition along but leaves an overridden one alone; a v1 and a v2 project file both open and land at schema v3.

### Slice 4 — Paired connections (data + 2D)

`connectsToObjectId` edits (`connectOpenings`/`disconnectOpening` + delete cascades) · `openingConnections.ts` alignment · inspector "Connects to" + plan link glyph.
**Accept:** pair a door↔door and a window↔window across two abutting rooms; deleting one side clears the other in the same commit; dragging a room flips the status to misaligned with the right reason; blocked-zones and cross-kind pairs are impossible.

### Slice 5 — 3D see-through

`Hole3d.treatment` · caps for unpaired/misaligned holes · clear-opening intersection for aligned pairs.
**Accept:** an aligned pair reads as a true opening from eye level in either room; unpaired and misaligned openings read as capped, not portals; you cannot see through a solid coplanar wall.

## 10. Risks / open edges

- **Openings through partitions** (deferred): a through-cut needs a representation decision — one stored object with a mirrored phantom extent on the opposite face (`xB = length − xA`) in validation and scene3d, or two paired objects reusing §5.5's machinery. Sketch, don't decide, until a real need appears.
- **`rotationDeg` locked to 0**: pairing requires abutting walls anti-parallel as drawn. Unlocking rotation is its own project (`getFloorWalls` currently lifts by translation only).
- **Alignment tolerances** (2° / 250 mm / 50% / 300 mm) are starting values; tune against real floorplans.
- **Vertex-merge reprojection** is approximate by design; advisory warnings backstop it.
- **Visual inconsistency**: zero-thickness perimeter walls vs thick partitions, in plan and 3D. Accepted for now; a future "wall thickness everywhere" option would unify.
- **Flip A/B UX**: swapping sides must migrate both faces' objects (mirror `xMm`, swap face IDs) — decide whether that's worth it or whether "the drawn direction is what you get" suffices.
- **Fixture churn**: `sampleProject.ts` and the broad store/schema test fixtures need v3 updates — mechanical but wide.
