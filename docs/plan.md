# Sightlines Rebuild Plan

## 0. Why this rebuild, in one paragraph

The first build had two architectural failures: it wasn't structured for eventual public deployment with accounts, and snapping was unreliable because it wasn't isolated from rendering. This rebuild fixes both by (1) going **local-first** — no hosted user images, no accounts in v1, which also sidesteps most cost and content-liability concerns until there's real demand — and (2) treating **project data as the single source of truth**, with snapping as a pure function and the canvas as a disposable view layer.

---

## 1. Product Positioning

> Sightlines is a private-by-design exhibition planning tool. Projects and artwork images stay on your device — no account required. You can export a project package at any time to back it up or share it manually, and generate a standalone viewer file anyone can open to look at your layout.

Not a CAD program, not a SketchUp clone, not a collection-management system. A scaled layout instrument for moving between bird's-eye plan, wall elevation, and simple 3D preview — and, deliberately, *not* a registrar/loan-tracking tool. Institutions keep using their own collections-management software for that; Sightlines is about spatial and curatorial thinking.

---

## 1.5 Core User Flow (north star)

This is the experiential shape every architecture decision below should serve. It's deliberately non-linear — the app should never force a single order of operations.

1. **Start a new project.** Name it. From here, two equally valid paths:
   - Define room layout first (draw shapes in bird's-eye view, set wall lengths), or
   - Skip straight to building the checklist.
2. **Room layout, if done now:** draw simple polygon/rectangular shapes; walls get lengths. Once drawn, walls are adjustable two ways — **draggable handles** for tactile adjustment, **numeric entry** for precision — both always available, both running through the same units module (§5).
3. **Bring in artwork**, via file browser or drag-into-drop-zone, any time, independent of whether rooms exist yet. Each upload creates a library `Artwork` record and is added to *this project's* checklist as unplaced. Metadata is auto-filled where available (filename, embedded EXIF/IPTC) but never required up front — title/artist/dims can all be added later, or never.
4. **Place without waiting for precision.** An artwork can be dragged onto a wall with placeholder dimensions before real ones are known, with a clear, consistent uncertainty indicator wherever it appears (plan, elevation, 3D, checklist).
5. **Keep iterating, in any order:** add more works, move them between walls, remove them, refine metadata, jump into 3D to check sightlines, jump back to plan view, export, reimport, repeat. Nothing is one-way.
6. **Pause and resume freely.** Autosave keeps local work current; explicit export/backup is always one click away and never required to keep working.
7. **Share for review without needing the recipient to have an account** — a self-contained `.sightlines` file, via Dropbox link or direct transfer (§6).

---

## 2. Architecture Principles (non-negotiable)

These are the things that broke last time, plus one added during planning that local-first apps need and cloud apps get for free.

**Canvas renders the layout; canvas does not own the layout.**
Konva nodes, R3F objects, and React components are disposable projections of plain project data. Project data → 2D plan renderer → wall elevation renderer → 3D preview renderer → export renderer. Never the reverse.

**Persistence sits behind a repository interface from day one**, even though there's only one local implementation right now.
```ts
interface ProjectRepository {
  load(id: string): Promise<Project>
  save(project: Project): Promise<void>
  list(): Promise<ProjectSummary[]>
  delete(id: string): Promise<void>
}
interface ArtworkLibraryRepository {
  list(): Promise<Artwork[]>
  get(id: string): Promise<Artwork>
  save(artwork: Artwork): Promise<void>
  delete(id: string): Promise<void>
}
```
Async even though it's local. This is what lets Cloud (if it ever happens) be a second implementation, not a rewrite — see §10.

**Snapping is a pure function, separate from collision.**
```ts
resolveSnap(
  proposed: Point,
  candidates: SnapTarget[],
  opts: SnapOptions & { previousSnapTargetIds?: { x?: string; y?: string } }
): { point: Point, activeGuides: Guide[], snapTargetIds: { x?: string; y?: string } }

validatePlacement(position: Rect, obstacles: Obstacle[]): { ok: true } | { ok: false, reasons: string[] }
```
No canvas access inside either. Operates in wall-local real-world units (x = distance from wall start, y = height from floor — center-anchored, not top-left). Pixel-to-world threshold conversion happens at the call site using current zoom. **Per-axis resolution:** x and y resolve independently. Each axis pools targets with that axis or "both", filters by threshold, sorts by priority → distance → id, and applies its own winner. This allows, for example, an artwork to ride the eyeline (y centerline snap) while simultaneously snapping its x to the grid. Explicit priority order when multiple targets are in range: floor (doors only, rank 0) > centerline (rank 1) > floor (other kinds, rank 1.5) > neighbor-center (rank 2) > neighbor-edge (rank 3) > grid (rank 4) with a stable tiebreak. Grid targets come from the shared precision system (§5.5), not from ad hoc renderer math. Hysteresis on break-free so it feels magnetic, not jittery — since hysteresis is inherently stateful (harder to break free of a snap than to enter one), the *caller* tracks the previous targets per axis and passes them in as `previousSnapTargetIds: { x?, y? }`; `resolveSnap` stays pure and testable rather than quietly accumulating state that would otherwise leak canvas/view concerns back into the snapping layer.

**Every persisted document is self-describing and versioned — there's no server to migrate it for you.**
A cloud app can run a migration script once, server-side, and every user is upgraded. A local-first app has files sitting on people's disks indefinitely, opened by whatever app version happens to load them. Every `Project`, `Artwork`, and `.sightlines` package carries a `schemaVersion`, and the app ships a small chain of migration functions (`v1→v2`, `v2→v3`, ...) run on load. This is what makes "add new fields later without breaking old files" (see §4) actually safe rather than aspirational.

Migration alone assumes the input is at least structurally sound — not a safe assumption for a file that arrived via import. Every load path (`.sightlines` import, a future Dropbox-synced file, anything read off disk) should run: parse → validate minimal shape → migrate to current schema → validate current schema → only then write to IndexedDB/OPFS. Zod (or similar) is a reasonable fit for the validation steps in a TypeScript codebase — this is cheap insurance against corrupted zips, half-written files, stale exports, and hand-edited JSON, and it's the same pipeline every import path (§13) needs anyway.

**Every geometry edit has a tactile path and a numeric path, and they always agree.** Draggable handles for rooms, walls, and wall objects exist alongside numeric-entry fields for the same values, both running through the same units module (§5). Neither is the "real" interface — a curator should be able to nudge a wall by eye or type `8'4"` and land in exactly the same place.

**Undo/redo is global across views, not scoped to whichever view triggered the change.** Since the intended workflow bounces constantly between 3D, plan, elevation, and checklist, a single command stack lives at the project level — undoing a metadata edit made in the checklist works the same whether the user is currently looking at the 3D preview or not.

---

## 3. Tech Stack (v1, browser-first, local-first)

| Layer | Choice | Notes |
|---|---|---|
| App framework | Vite + React + TypeScript | No Next.js — no server, so no reason to pay its complexity tax. Revisit only if Cloud happens. |
| UI | shadcn/ui + Radix + Tailwind | Tailwind's responsive utilities double as the basis for the tablet/phone layout — see §3.5. |
| 2D rendering | Konva / react-konva | Native touch event support — no new dependency needed for tablet. |
| 3D rendering | React Three Fiber + three.js | `OrbitControls` handles touch orbit/pinch/pan natively — see §3.5. |
| State | Zustand | Drop the TanStack Store hedge — Zustand fits this. |
| Local storage | IndexedDB (project docs, artwork library, metadata, thumbnails) + OPFS (larger image blobs) | localStorage only for trivial prefs (theme, last-opened project, default unit). |
| Project package format | `.sightlines` (zip: `project.json` + `assets/`) | Export/import/backup format; also the eventual desktop save format. The whole sharing mechanism — see §6. |
| Sync | Dropbox API, OAuth 2.0 + PKCE, no backend | See §6 — confirmed viable without a server. |
| Exports | Client-side: canvas→PNG, pdf-lib/jsPDF | No server, no function timeouts, no compute cost. |
| Desktop/mobile-native (optional, not v1) | Tauri | Supports iOS/Android from the same codebase as of Tauri 2.0, if native distribution is ever wanted — but still means App Store review, which cuts against the no-install positioning. PWA stays the primary path on iPad too — see §3.5. |

No Supabase, no R2, no auth, no backend in v1.

---

## 3.5 Platform Tiers: Desktop, Tablet, Phone

Three tiers, not one responsive breakpoint. iPad is a first-class target, not an afterthought — the app is touch-first there, not a shrunk desktop layout.

**Desktop (mouse/keyboard):** the full feature set, primary build-and-validate environment.

**Tablet (iPad, touch-primary):** full editing capability, adapted interaction layer:
- Touch-sized hit targets on handles (44×44pt minimum, well above mouse-precision sizing).
- Explicit gesture disambiguation: single-finger drag on an object moves it; single-finger drag on empty canvas pans; pinch zooms.
- No-hover alternatives for anything currently hover-dependent (snap-guide previews, tooltips) — tap-to-reveal or persistent visibility instead.
- On-screen equivalents for keyboard shortcuts (undo/redo, group/ungroup) rather than assuming ⌘Z exists.
- Side panels (checklist, inspector) become bottom sheets/drawers rather than fixed sidebars.
- Detected via pointer type (`pointer: coarse`) combined with viewport width, not width alone.
- **Dual-mode editing (§2) carries more weight here:** a finger is blunter than a mouse, so numeric entry becomes the primary precision path on tablet, with dragging handling gross positioning — not a new decision, just a reason the existing one matters more.
- **3D preview included, not cut.** `OrbitControls`' touch mapping (drag = orbit, pinch = zoom, two-finger drag = pan) is well-established and arguably more natural on tablet than desktop mouse. The deliberately simple 3D scope (boxes/planes, not photoreal) plus the display-tier image decision (§4.5, ~1600–1800px WebP textures) keeps GPU memory well within modern iPad capability. Validate with real device testing rather than assuming, but there's no architectural reason to exclude it.
- **iOS specifics:** no `beforeinstallprompt` — onboarding needs manual "tap Share → Add to Home Screen" instructions for users who want the storage-eviction protection that installing provides (§8/§11). File System Access API is entirely absent on iOS, so import/export via the native file picker/share sheet is the whole story there — already the planned fallback path regardless.

**Phone:** deliberately reduced — checklist browsing, viewing plan/elevation/3D, light repositioning, not the full precision toolkit. Phone screens don't support serious wall-elevation work regardless of touch quality. This tier's rendering/interaction needs overlap heavily with what a future zero-install viewer export (§6) would need, so building it now is a natural stepping stone toward that feature later, even though it's not a separate export format yet.

**Implementation note:** build the input-handling layer pointer-agnostic from MVP1, even before tablet-specific visual polish exists — retrofitting gesture disambiguation onto mouse-only drag handlers later is real rework, the same category of problem as the original snapping bug.

---

## 4. Data Model

### 4.1 Artwork is decoupled from Project

Artworks live in a **global Artwork Library**, not nested inside a single project. A project places artworks by reference (`artworkId`); it doesn't own them. This is what makes touring exhibitions and recurring permanent-collection pieces work without duplication — the same artwork record can be placed in multiple projects/venues.

There are three distinct concepts here, not two — easy to collapse by accident:
- **Library membership:** every `Artwork` record that has ever been created, project-independent.
- **Checklist membership:** which library artworks belong to *this* project's checklist. Dropping an image while working in a project adds it to the library *and* to that project's checklist as unplaced — this is what makes "upload now, place later, or never" work. Removing a work from a project's checklist unlinks it; it should not delete the library record, since the same artwork may belong to another project or a future tour stop.
- **Placement:** whether, and where, a checklisted artwork currently sits on a wall (a `WallObject` referencing `artworkId`).

```ts
type Dimensions = {
  widthMm?: number
  heightMm?: number
  depthMm?: number
  status: "known" | "approximate" | "unknown"
  displayUnit?: "in" | "ft" | "cm" | "m"   // preferred entry/display unit — not the measurement truth
}

type Artwork = {
  id: string                  // stable, client-generated UUID — never reused, never repurposed
  schemaVersion: number

  // core fields, present from v1
  artist?: string
  title?: string
  date?: string
  accessionNumber?: string
  locationOrLender?: string
  dimensions: Dimensions
  assetId?: string

  // open extension point — see 4.4
  metadata: Record<string, string | number | boolean>
}
```

Naming the mm fields explicitly (`widthMm`, not `width` + a separate `unit`) closes off the exact ambiguity the canonical-storage rule in §2 is meant to prevent — a bare `width: 20` field invites the question "20 what?" months later; `widthMm` doesn't. `unit` becomes purely a display/entry preference, never part of the measurement truth. Kept as one status for the whole `Dimensions` object in v1 rather than per-field (height known, depth unknown, etc.) — real museum data sometimes wants that granularity, but the structure doesn't block adding it later; it just isn't solved now.

A project's checklist is therefore: `checklistArtworkIds` (membership) joined against the library (for display) and against current wall placements (for placed/unplaced status) — not an array the project directly owns or duplicates.

### 4.2 Multi-room support, with rooms in a shared coordinate space

To support more than one gallery per exhibition — and eventually doorway sightlines between them — rooms can't be isolated, independently-anchored polygons. They need a shared coordinate system:

```ts
type Project = {
  id: string
  schemaVersion: number
  title: string
  unit: "in" | "ft" | "cm" | "m"
  defaultWallHeightMm: number
  defaultCenterlineHeightMm: number
  floor: Floor
  checklistArtworkIds: string[]   // checklist membership (§4.1) — references into the library
  wallObjects: WallObject[]       // all placements, flat at project level — see note below
  createdAt: string
  updatedAt: string
}

type Floor = {
  rooms: RoomPlacement[]   // each room positioned relative to a shared origin
}

type RoomPlacement = {
  roomId: string
  offsetXMm: number; offsetYMm: number; rotationDeg: number   // room's position within the floor
  room: Room
}

type RoomVertex = {
  id: string
  xMm: number; yMm: number
}

type Room = {
  id: string
  name: string
  heightMm: number
  vertices: RoomVertex[]   // local to the room's own origin
  walls: Wall[]
}

type Wall = {
  id: string
  roomId: string
  name: string
  startVertexId: string
  endVertexId: string
  heightMm: number
  defaultCenterlineHeightMm?: number
}
```

(Field names carry their unit — `offsetXMm`, `rotationDeg` — per the same rule as `widthMm` in §4.1: a bare `offsetX: 240` invites "240 what?"; the suffix doesn't.)

**Wall objects live in one flat `Project.wallObjects` array, not nested inside walls or rooms.** Each object references its wall by `wallId` — the same normalization move as walls referencing vertex IDs. Moving an object between walls is a field change, not a splice across two nested arrays, and cross-wall queries (validation after a geometry edit, "everything placed in this project") don't need tree traversal.

**Until room rotation is actually implemented in rendering and bounds math, the schema should constrain `rotationDeg` to 0.** The field exists so the data model doesn't assume rooms are axis-aligned forever, but a schema that accepts values the renderer silently ignores is worse than one that rejects them loudly — an imported file with a rotated room must fail validation, not draw in the wrong place. Relax the constraint in the same change that makes rotation real.

**Walls reference vertex IDs, not point indices.** An earlier draft used `startPointIndex`/`endPointIndex` into the room's points array — fragile, because inserting, deleting, or reordering a vertex silently shifts every index after it, breaking wall identity without any error. Giving each vertex a stable ID and having walls reference those IDs means index churn can't corrupt wall identity. It also defines a clear behavior for editing: dragging an existing vertex moves it in place (walls referencing it just follow); inserting a new vertex on an existing wall segment splits that one wall into two new walls, each still tracing back to real vertex IDs.

**Validate the structural invariants at the boundary, not deep in geometry math.** The geometry code assumes a room's walls form a closed loop in vertex order (`wall[i].endVertexId === wall[i+1].startVertexId`), and the model carries two redundant identity fields (`RoomPlacement.roomId` vs `placement.room.id`, `Wall.roomId` vs containment in `room.walls`). The schema should assert loop closure and identity agreement, so a hand-edited or corrupted file fails at import with a clear message instead of producing a wall-not-found error three function calls into a resize.

Doorway connections are modeled as a property on door-type wall objects:

```ts
type WallObjectBase = {
  id: string
  wallId: string
  xMm: number; yMm: number       // center-anchored — see §2
  widthMm: number; heightMm: number
  rotationDeg?: number
  groupId?: string
}

type ArtworkWallObject = WallObjectBase & {
  kind: "artwork"
  artworkId: string
  // optional per-placement override — doesn't touch the library record
  displayDimensionsOverride?: Dimensions
}

type OpeningWallObject = WallObjectBase & {
  kind: "door" | "window" | "blocked-zone"
  blocksPlacement: true
  connectsToWallId?: string   // present only for doors that connect two rooms
}
```

**Placement can override display dimensions without touching the library record.** A curator might need a framed size, a mat size, or a placeholder mockup size specific to one layout — without permanently editing the canonical `Artwork`, which may be shared across other projects or tour stops (§4.3). `displayDimensionsOverride` on the placement handles this; absent, the placement just uses the library artwork's own `dimensions`.

When two doors reference each other across rooms and their positions geometrically align within the shared floor coordinate space, the 3D renderer can treat the doorway as a true opening rather than a capped wall — letting a camera view actually see through it into the next room. This isn't a v1 feature, but the `Floor`/`RoomPlacement` structure needs to exist from the start, because retrofitting "rooms have positions relative to each other" after rooms have been isolated polygons for two MVP cycles is a real rewrite. Build single-room projects first; the data model just shouldn't assume there's only ever one room.

**Performance note:** your own estimate — a few rooms typically, a large show topping out around 10 rooms / 200 works — is comfortably within what Konva/R3F can handle, especially once display-tier images are used for canvas/3D rendering (full-resolution originals only touch export, and only when explicitly requested — see §4.5). The one thing worth deferring deliberately is *simultaneously* rendering every connected room's full 3D geometry at once; a reasonable default is to render the current room plus any rooms visible through an open sightline from the active camera, not the entire floor at all times. That's a renderer-level optimization to design for later, not a data-model concern now.

### 4.3 Touring / multi-venue exhibitions (planned for, not built yet)

The artwork-library decoupling in §4.1 is most of what multi-venue support needs. The remaining piece, left as a clean extension point rather than built now: a project today represents one venue's layout. A future `Exhibition` wrapper could hold a shared checklist (a set of artwork IDs) plus multiple `Project`s, one per tour stop, each placing some subset of that shared list in its own room layout. Because artworks are already library-level records referenced by ID, this wrapper is additive — it doesn't require artworks, rooms, or walls to change shape.

### 4.4 Extensible metadata without breaking old files

The `metadata: Record<string, string | number | boolean>` bag on `Artwork` is the answer to "add lux requirements or other fields later without migrating everyone's data." New optional fields can be introduced by convention (e.g., `metadata.luxLimit`) without a schema version bump, as long as the app treats unknown keys as opaque pass-through (read them if present, preserve them on save even if the current UI doesn't render them). Fields that need to become *structural* — validated, typed, shown in dedicated UI — get promoted into the core schema with a version bump and a migration function, per §2's versioning principle.

### 4.5 Image storage: tiered, not one resolution

Local-first changes what "image cost" means: it's the user's own disk and browser storage quota now, not your hosting bill. So this is a file-size/performance decision, not a cost one. Each upload generates three derivatives rather than being stored at one resolution:

```ts
type Asset = {
  id: string
  schemaVersion: number
  mimeType: string
  originalFilename?: string
  originalKey: string    // as uploaded, kept locally by default — not auto-included in exports
  displayKey: string     // ~1600–1800px wide, WebP ~80–85% — canvas/3D rendering, most exports
  thumbnailKey: string    // ~320–400px wide, WebP — checklist rows, fast lists
  widthPx?: number; heightPx?: number
  byteSize?: number      // original file size — supports "this project is getting large" warnings
  sha256?: string        // content hash — what §6's dedupe-on-import rule actually compares against
}
```

- **Display tier (~1600–1800px):** deliberately above a "just a glance" resolution — on a retina display, and especially when a 3D camera moves close to a wall, anything much softer than this undermines the core "judge how it'll actually look" purpose of the tool.
- **Originals** are kept locally (disk is cheap, it's not your bill) but are **not** included in exports by default.
- **Three export modes, not a binary toggle:** *with originals* (archival fidelity — final venue handoff, a press kit), *display tier only* (the default — good balance for backup/sharing), and *metadata/layout only, no images* (the lightest possible handoff — just the checklist and layout structure, useful when even display-tier image weight is more than the moment calls for). Since sharing now happens via full-file export + Dropbox link rather than email attachments (§6), file size from including originals is an acceptable tradeoff when the user actively chooses it.
- **Format:** WebP for thumbnail/display derivatives; originals stay as-uploaded, never force-recompressed.
- **Generation:** client-side via Canvas/OffscreenCanvas, ideally in a Web Worker so batch uploads don't freeze the UI. Thumbnail generates synchronously (the checklist needs it immediately); display-tier generation can defer to idle time.
- **Packaging detail:** when building the `.sightlines` zip, store already-compressed image entries with no additional compression (zip "store" mode) and reserve real deflate compression for the JSON — recompressing WebP/JPEG bytes wastes CPU for no size benefit.
- **`sha256` is what makes the dedupe-on-import rule in §6 actually implementable** — "identical image content already in the library under a different ID" requires something to compare, not just an intention to compare.

---

## 5. Units & Measurement System

This is core infrastructure, not a utility function — build it before the inspector panel or wall-length entry, since most of the editor depends on it.

**Canonical storage:** a single internal unit, stored as a double-precision float — millimeters is fine. Doubles carry far more precision (~15-17 significant digits) than any real fraction-of-an-inch needs; no fixed-point/integer scheme required.

**Parser** — `parseLength(input: string, contextUnit) → mm` — accepts free-form text: `66in`, `66"`, `5'6"`, `5ft 6in`, `24 3/8 in`, `5'6 1/2"`, `60cm`, `1.5m`, and bare numbers that fall back to the contextual default unit. Needs real unit tests, including edge cases like a bare fraction (`3/8"`) with no leading whole number.

**Formatter** — `formatLength(mm, settings) → string` — the reverse, driven by:
- primary display unit (in / ft / cm / m)
- optional secondary unit shown alongside, e.g. `5'6" (167.6 cm)`
- fraction granularity for imperial (nearest 1/4, 1/8, 1/16, 1/32)
- decimal precision for metric (nearest mm, 0.5mm, cm)
- feet-and-inches vs. decimal-inches as the imperial display form

**Two rules to bake in early:**
- **Round for display only, never for storage.** Settings change how a value is *shown*, never the underlying mm value. An explicit "snap this measurement to the nearest 1/8 in" is a deliberate user action, not a side effect of changing display settings.
- **Reformat on blur/Enter, not on keystroke.** Rewriting an input field mid-type causes cursor-jump bugs. Let the user type freely; optionally show a small live preview of the parsed value beside the field, and normalize the field's actual content only once they commit.

**Tie rounding granularity to grid/nudge snap increments** so there's one coherent notion of "how precise is this project," not separate settings that can drift apart.

Build as a small, dedicated, heavily-tested module (`units/length.ts`). The conversion math is trivial and exact (1in = 25.4mm); the parsing/formatting of human input is the bespoke, valuable part.

### 5.5 Precision Grid, Nudge, and Snap

The core principle: **one precision system, not three.** The visual grid, grid snap targets, keyboard nudge increments, and unit-format rounding preference should be different surfaces over the same project precision model. If the user is working to the nearest `1/8"` or nearest `5mm`, the finest zoomed-in grid should bottom out there, grid snap candidates should not offer a finer contradictory interval, and formatting should not imply a different precision than the editing tools use.

The active grid interval now generates actual `resolveSnap()` candidates — the lowest-priority snap tier. Snapping stays pure: the renderer/view computes the currently relevant grid targets from zoom, viewport, active coordinate space, and user precision settings, then passes them into `resolveSnap()` like any other target.

Grid intervals must be **semantic minor/major pairs**, not a flat sequence with inconsistent major-to-minor ratios. Each unit family carries a curated ladder of (minor, major) pairs where every major is a round human value and an exact 4–12× multiple of its minor:

**Imperial:** (½", 6") (1", 6") (3", 1') (6", 2') (1', 5') (2', 10') (5', 20')
**Metric:** (5mm, 5cm) (1cm, 10cm) (2cm, 20cm) (5cm, 50cm) (10cm, 1m) (20cm, 1m) (50cm, 5m) (1m, 5m)

This replaces the old heuristic where minor was the smallest table entry ≥ 32px and major was picked by magnitude thresholds — which at typical plan zoom produced sparse 15ft majors with near-invisible minors.

The grid should be **zoom-adaptive within the pair ladder**. As users zoom out, step upward to a coarser pair; as they zoom in, step downward until hitting the user's chosen precision floor. Selection stays dynamic: find the finest pair whose minor interval is ≥ a target pixel size on screen (shared default 8px, with per-view overrides: PlanView 12px, ElevationView 7px). The choice governs both rendering tiers and snap candidates. Draw two visual tiers at each level: a subtle minor grid at the active pair's base interval, and a stronger major grid at the pair's major (always ≥ 4× and ≤ 12× the minor). Generate or draw only lines that intersect the visible viewport; this matters once rooms and floors get large.

**Per-view density targeting:** Plan view at default zoom reads whole units/meters (1' + 5' imperial, 20cm + 1m metric); elevation reads finer because hang heights are an inches/centimeters activity (6" + 2' imperial, 10cm + 1m metric). The user's precision-floor preference still clamps the minor interval; snap targets and the visual grid still read the same interval (one precision system preserved).

Plan and elevation grids are separate grids in separate coordinate spaces:
- **Plan:** floor/room XY.
- **Elevation:** wall-local horizontal distance by height from floor.

Anchor the grid to geometry, not the screen. In elevation, `x=0` should be the wall start and `y=0` should be floor level. In the overall floorplan, the grid is a single continuous floor-reference grid spanning every visible room, including inactive rooms, so the whole venue reads against one shared coordinate field. When focused room-local editing and rotated rooms are supported via `RoomPlacement.rotationDeg`, a room-local grid can rotate with the active room for precision edits; that should be an intentional focused mode, not the default overall floorplan reference.

**Grid rendering: lines-only drafting style.** Grid is rendered as two-tier line hierarchy with no dots (a dot lattice colliding with major lines reads as awkward, not refined). Minor lines are pale 1px hairlines (`oklch(0.78 0.008 240 / 0.42)`), major lines are heavier 1.3px (`oklch(0.62 0.01 240 / 0.5)`). Grid always reads quieter than walls, keeping it an alignment reference, not a visual distraction.

**Plan view grid fills the entire visible workspace,** not just the wall layout rectangle. The SVG viewBox is letterboxed inside the canvas (preserveAspectRatio meet), so the grid extends to the full container extent in world coordinates (containerSize / pixelsPerMm, centered on the viewBox center), keeping the coordinate space continuous edge-to-edge.

**Elevation view grid is deliberately clipped to the wall rectangle** (0,0 → wallLength × wallHeight), floor-anchored with `y=0` at the bottom. Bare canvas around the wall figure is intentional — the wall reads as the figure, not a cropped view onto an infinite space.

`Show grid` and `Snap to grid` should be independent local app preferences. Sometimes a curator wants the visual reference without magnetic behavior, especially during rough composition. These preferences belong with view/workspace settings rather than `Project` or `.sightlines` data, so importing a shared file does not import someone else's working-style preferences.

The wall **centerline guide** is related but distinct. It is more important than an arbitrary grid interval in elevation view, because it encodes a curatorial installation convention. Keep it as a persistent highlighted guide, eventually with its own visibility/control treatment, rather than treating it as just another gridline that may or may not happen to coincide with the current grid interval.

Resolved floorplan behavior: inactive rooms show the same continuous reference grid as active rooms in overall floorplan view. Do not create disconnected per-room grids in that mode.

---

## 6. Sharing: File Portability + Sync

Kept deliberately simple for a single-user-focused build: sharing means moving `.sightlines` files, not a dedicated review/annotation workflow. Since the app itself is free, install-free, and account-free, a recipient can open a shared file by visiting the site and importing it — no separate zero-friction viewer format is required to serve that need.

**A per-project export needs to be self-contained, not just a reference into the local library.** Because artwork lives in a global library (§4.1), a naive export of `Project` alone would only carry `artworkId` references — meaningless on a different machine with a different (or empty) library. The on-disk package needs to be its own denormalized snapshot:

```ts
type SightlinesPackage = {
  schemaVersion: number
  exportedAt: string
  project: Project
  artworks: Artwork[]      // the subset actually referenced by this project's checklist
  // assets/ folder in the zip holds the corresponding image blobs
}
```

Import needs explicit merge rules against the recipient's own library, not silent overwrite-or-skip:
- same `artworkId`, identical content → reuse the existing library record
- same `artworkId`, differing metadata → prompt (keep mine / keep theirs / keep both as a duplicate)
- referenced asset missing from the package → import as a metadata-only artwork with a visible "missing image" warning, rather than failing the whole import
- identical image content already in the library under a different ID → dedupe by content hash rather than storing a second copy

- **`.sightlines` export/import** (§9, MVP2) is the whole sharing mechanism: attach it, Dropbox-link it, hand someone a USB drive, whatever's convenient. Larger files are fine — see §4.5, exports default to the display image tier, with full-resolution originals as an explicit opt-in; a Dropbox link absorbs any size that would be awkward over email.
- **Dropbox-folder sync**, for moving editable project files between people/devices without hosting anything yourself. Confirmed technically viable without a backend: Dropbox's recommended flow for client-only apps is OAuth 2.0 with PKCE, and pure browser apps are explicitly supported for offline access — Dropbox's own JS SDK ships a `pkce-browser` example doing exactly this, refresh token included. The real caveat isn't whether it's supported, it's storage risk: a refresh token sitting in browser storage is a more attractive XSS target than a short-lived access token, since it grants durable access rather than a few hours of it. Scope the app to app-folder-only permissions (not full-Dropbox access) so a compromised token has a small blast radius. This is last-write-wins file sync, not live co-editing; real-time multiplayer stays out of scope (§12).

**Deferred, not designed out:** a standalone zero-install viewer export (embedded JSON in a self-contained HTML file, à la §4's schema) and lightweight comment/annotation pins remain a clean future add if the "recipient shouldn't need to visit the app at all" case becomes a real ask. One constraint to remember if this is revisited: a browser-opened static HTML file can't rewrite itself in place across Safari/Firefox/Chromium — the flow would need to be "reviewer downloads an annotated copy or a separate comments file, curator reimports that," not an assumption that the same file mutates. Nothing in the current architecture blocks any of this later, it's just not being built now.

---

## 7. Undo/Redo

Because layout is one serializable document mutated through defined actions, this is cheap if designed in now and expensive to retrofit. Recommended approach: command pattern over the Zustand store — every mutation (move object, resize, group, delete, snap-commit) is a discrete action object with an inverse; maintain an undo/redo stack of these. Wire it in alongside the first drag-and-snap implementation, not after.

**One `applyEdit(command)` entry point, not N hand-rolled actions.** Every store action that mutates the project should be a thin command constructor feeding a single pipeline that stamps `updatedAt`, pushes onto the undo stack, and triggers save. This is one abstraction paying three rents: it removes the per-action boilerplate (read state → build next project → stamp → save), it *is* the undo/redo stack, and it's the seam where autosave-on-commit attaches. The cheapest moment to introduce it is while there are only a handful of mutating actions; every action added before it exists is a retrofit.

**Commit transactions, not pointer movement.** Dragging an artwork across a wall shouldn't produce hundreds of undo entries, one per `pointermove`. The pattern is `beginDrag` → live transient preview state (not committed, not undoable) → `commitMoveWallObject` on release → exactly one undoable command. Same shape for group drag, wall resize, and room reshape. Autosave should listen to committed document changes, not every transient update, for the same reason — otherwise it's writing to IndexedDB on every frame of a drag.

---

## 8. Things Worth Deciding Now, Cheap to Build In, Expensive to Retrofit

- **Image tiers:** see §4.5 for the full design — thumbnail/display/original, display used for rendering and default exports.
- **Sync conflict safety:** once Dropbox sync exists, never silently discard a version. At minimum, a version counter in the document and a "this changed elsewhere — keep mine / keep theirs / keep both" prompt.
- **Corruption/recovery baseline:** a partially-corrupted `.sightlines` zip or an interrupted IndexedDB write should fail loudly with a clear error, not silently lose data. Three concrete rules that follow from this: (1) **validate before save** — the repository never writes a document that fails the current schema, so invalid state can't persist and poison the next load; (2) **one corrupt record can't take down the list** — `list()` skips-and-reports a project that fails validation rather than throwing wholesale; (3) **boot never silently substitutes** — if the saved project can't load, say so visibly; don't quietly show a fresh sample while the user's data sits unreachable in IndexedDB.
- **Equal distribution / spacing:** alongside center/edge/neighbor snapping, add "distribute N selected objects evenly across a span" — one of the most common curatorial moves after grouping, and easy to miss if you only build the snap-target list from the original spec.
- **Toggleable visual grids in plan and elevation views.** Grid display is a view-layer alignment aid, not project geometry. It should be available in both bird's-eye plan and wall elevation views, share the same precision vocabulary as snap/nudge increments (§5.5), and be easy to turn on/off independently from snap-to-grid without changing persisted layout data.
- **Scale-accurate printed export:** a distinct export mode from PNG/PDF screenshots — true scale ratio (1:50, 1:25), correct paper size, tiling across multiple pages for walls longer than one sheet. Needed for anyone using a printed elevation with a tape measure on installation day.
- **One shared "approximate/unknown" indicator component, reused everywhere.** Plan view, wall elevation, 3D preview, and the checklist row all need to show dimension uncertainty — easy to implement inconsistently if each view treats it as a local concern. Build one visual language (badge/icon/outline treatment) and reuse it across all four surfaces.
- **Metadata intake assists, layered in over time:** auto-fill from embedded EXIF/IPTC on upload where present (cheap, real win — some museum scans already carry artist/title); later, bulk metadata import from a spreadsheet matched by filename. The extensible `metadata` bag (§4.4) absorbs whatever custom columns an institution's spreadsheet happens to have without forcing a schema change.
- **Room templates (maybe, later):** if curators reuse the same gallery across shows, saving a room as a reusable template avoids redrawing it. Not urgent; the `Floor`/`Room` split in §4.2 doesn't block adding this later.
- **Library-wide export, not just per-project.** Since artwork now lives in a global library shared across projects (§4.1), a single project's `.sightlines` export doesn't capture an artwork sitting in the library but not yet added to any project's checklist. Add `exportAll()`/`importAll()` to the repository interface (§2) alongside the per-project versions — cheap to design in now, painful to retrofit once real libraries exist.
- **PWA update mechanics.** No server to migrate everyone centrally — a browser tab can keep running stale cached app code via its service worker after a schema change ships. Plan an explicit "a new version is available — reload to update" prompt rather than silently swapping code under an open tab, and think through what happens if a migration runs while an old app version is still loaded.
- **A conscious telemetry decision, even if the answer is "none."** Knowing what's confusing or breaking for real users is valuable, but sits in real tension with "nothing touches our servers" — part of the product's positioning. Decide deliberately and disclose if anything is added, rather than drifting into it later and quietly undercutting the privacy story.

---

## 9. Revised MVP Roadmap

### MVP 1 — Spatial editor + checklist core
*No auth, no cloud, no export beyond project JSON.*

MVP1 bundles a lot — geometry, artwork/checklist, snapping/collision/undo, and 3D. Sequencing it as three internal sub-phases keeps the "boring" data layer (schema, units, wall identity, import/export semantics) stable *before* Konva drag behavior gets layered on top, rather than debugging both at once:

**1A — Geometry spine.** Units parser/formatter (§5) · versioned project schema + Zod validation (§2) · repository interface (§2) · single-room footprint editing with vertex-ID-based wall identity (§4.2) · wall elevation view (empty, no artwork yet) · toggleable plan/elevation visual grid (§5.5/§8) · local save/load, JSON export/import. No images, no 3D yet — this phase is about the domain model and geometry transforms being correct and boring.

**1B — Artwork placement.** Artwork library + project checklist membership (§4.1) · image intake + thumbnail/display tier generation (§4.5) · drag artwork onto wall, centerline auto-snap and optional grid snap (`resolveSnap`, §2/§5.5) · manual numeric placement · dimension-uncertainty indicator, consistent across views (§8) · undo/redo for placement actions, transaction-bounded (§7) · pointer-agnostic input from the start (§3.5), even before tablet visual polish exists.

**1C — Professional layout behaviors.** Doors/windows/blocked zones + `validatePlacement` collision (§2) · multi-select, grouping, group drag, group-centerline snap · equal-distribution spacing · floor objects (plan view only) · simple derived 3D preview, orbit camera · checklist panel: thumbnail, core fields, sort.

### MVP 2 — Project packages, sharing, polish
- `.sightlines` export/import as a self-contained `SightlinesPackage` (§6) — embeds the artwork snapshot the project actually needs, not just references into the local library — including library-wide `exportAll()`/`importAll()` alongside per-project export (§8)
- Import safety pipeline (§13) applied to every import path
- Prominent "Save backup" UX, `navigator.storage.persist()`, and a visible storage-status message — IndexedDB/OPFS are caches, not archives (§11)
- Saved camera views
- PNG export: elevation, floor plan, 3D screenshot
- PDF checklist export (client-side, pdf-lib)
- Missing/approximate-data readiness report

### MVP 3 — Tablet + professional workflow depth
- **Responsive/touch-adapted layout for iPad** (§3.5): touch-sized handles, gesture disambiguation, bottom-sheet panels, on-screen shortcut equivalents, 3D validated on real tablet hardware
- Multi-room UI: place additional rooms in the shared floor coordinate space
- Dropbox-folder sync (PKCE + offline access, app-folder-scoped — §6)
- EXIF/IPTC metadata auto-fill on upload; spreadsheet bulk metadata import matched by filename
- Full checklist metadata editing, all sort modes, drag-reorder in custom mode
- Scale-accurate PDF wall elevation + floor plan export (true ratio, tiling)
- Project packet export (cover page + checklist + plans + elevations + 3D views)
- Command palette, context menus, better inspector

### MVP 4 — Multi-room sightlines + phone tier
- Doorway connections between rooms (`connectsToWallId`)
- 3D camera sightlines through aligned doorways
- Room-visibility-scoped 3D rendering for performance
- Phone tier: checklist browsing, plan/elevation/3D viewing, light repositioning (§3.5) — reuses much of the tablet-viewing groundwork

### Backlog (not scheduled — revisit only on real demand)
- Accounts, Supabase/RLS, hosted cloud projects, public snapshot links
- Real-time multiplayer co-editing (explicitly distinct from file sync — see §6)
- Standalone zero-install viewer export + lightweight annotation pins (§6) — clean to add later, not needed while sharing is file-based
- `Exhibition`/multi-venue wrapper UI (data model supports it; no UI yet — §4.3)
- Room templates
- Admin tools, rate limiting, subscriptions
- Registrar-level metadata (lux limits, insurance, condition reports) — left as future `metadata` bag entries, not built now; institutions keep using dedicated collections-management software for this

---

## 10. The Cloud Seam (build for it without building it)

Even though Cloud is backlog, the decisions already made keep that door open without costing anything today:

- The `ProjectRepository`/`ArtworkLibraryRepository` interfaces mean a future Supabase+R2 implementation is additive, not a rewrite.
- The `.sightlines` document shape **is** the shape a hosted project's layout JSON would take.
- Schema versioning (§2) means old local files and a future server-side migration story use the same mechanism.

---

## 11. Two Things to Watch That Aren't Fully Solved by "Local-First"

**Browser storage is a cache, not an archive.** IndexedDB/OPFS can be evicted, and OPFS is invisible to the user — no Finder window to recover from. The MVP1/MVP2 export and backup UX needs to be prominent, not buried. Two concrete, cheap things worth doing rather than leaving implicit: call `navigator.storage.persist()` on project load to request durable storage (not a guarantee, but it measurably reduces eviction risk on the browsers that honor it), and show a plain-language, always-visible status somewhere in the UI — "This project is saved locally in your browser. Export a backup for long-term safekeeping." — rather than assuming the export button alone communicates that.

**The File System Access API (in-place save to a synced folder) is effectively Chromium-only.** Firefox has formally declined it, Safari has no committed timeline. Given the desktop audience skews Mac/Safari, this is the practical argument for keeping Tauri as a live option for a "real save/open" desktop experience — the only path to uniform real-disk access across platforms — even though the recommended path stays browser-first, and iPad specifically stays PWA-first per §3.5 rather than a native wrapper.

**There's a second, independent reason browser-first has to stay the primary path, not just a stepping stone to a desktop app: institutional IT lockdown.** Museum, university, and gallery IT departments frequently block installing unsigned or unapproved desktop software outright — for exactly the audience this tool targets (small institutions, university galleries, independent curators working on shared or managed machines). A browser app is usable immediately regardless of that policy; a Tauri-only app would fail before a curator ever got to try it. This reinforces, rather than changes, the existing browser-first decision — it's just a sharper reason for it than the Safari file-access gap alone.

Put together, the save/open experience should be explicitly designed around three named capability tiers rather than one assumed baseline:
- **Chrome/Edge — enhanced mode:** real file-system pickers, closer to true in-place open/save where the File System Access API is available.
- **Safari/Firefox — portable mode:** import/export `.sightlines` packages as the whole story, autosave to IndexedDB/OPFS between exports. This is graceful degradation, not a second-class experience — it's the same package format either way.
- **Tauri (later) — full file mode:** true native open/save for power users on machines where installing it is actually possible.

---

## 12. Explicitly Deferred

- Real-time multiplayer co-editing — distinct from, and much more expensive than, the file-sync approach in §6
- Standalone zero-install viewer export + annotation pins — clean to add later; not needed while sharing is file-based (§6)
- Cloud accounts/hosting — backlog, revisit only if demand is real
- Registrar-level metadata fields — `metadata` bag supports adding them later without a rewrite; not building the structured UI for them now

Even fully local, a lightweight ToS and privacy policy are still worth having before any public release — local-first reduces legal surface, it doesn't zero it out, especially once a sync feature involving a third-party OAuth provider is added.

---

## 13. Import & File Safety

Local-first doesn't mean no attack surface — it means the attacker model shifts from "network attacker" to "malicious or corrupted file." A `.sightlines` package is a user-supplied zip containing JSON and images; treat it as untrusted input, not a trusted extension of app state, on every import path (file import, a future Dropbox-synced file, anything read off disk):

- Reject zip path traversal (entries that resolve outside the expected extraction target).
- Cap extracted file count and total uncompressed size before extracting, not after — guards against decompression-bomb-style files.
- Reject unsupported MIME types rather than trusting a file extension.
- Validate image dimensions before decoding, so a maliciously huge image can't exhaust memory on decode.
- Sanitize any freeform text before it's ever rendered as HTML (artist/title/notes fields, and any future comment text) — never execute scripts sourced from imported project data.
- Handle a corrupt or missing individual asset by degrading gracefully (missing-image warning, per §6's merge rules) rather than failing the whole import.
- Run every import through the parse → validate → migrate → validate pipeline from §2 before writing anything to IndexedDB/OPFS.

None of this is paranoia for a niche case — every shared `.sightlines` file, by design (§6), is something that arrived from outside the app.
