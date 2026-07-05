# Sightlines

## 1. Product Summary

**Sightlines** is a professional web-based exhibition planning tool for curators, exhibition designers, and artists. It allows users to create scaled gallery layouts, arrange artworks on wall elevations, place simple floor-based objects, and preview installations in basic 3D.

The app should prioritize **precision, clarity, and curatorial workflow** over architectural complexity. It is not intended to be a full CAD program, SketchUp replacement, or interior design suite. Its strength should be the ability to move fluidly between:

1. **Bird’s-eye room planning**
2. **Wall-by-wall elevation layout**
3. **Simple 3D preview with saveable camera positions**

The guiding principle:

> The 2D plan and wall elevation data are the source of truth.
> 3D is a derived preview layer, not the primary editing environment.

---

## 2. Core Goals

Sightlines should allow users to:

* Create and manage multiple private exhibition projects.
* Associate artwork/image uploads with specific projects through a "checklist" feature.
* Draw simple room layouts in bird’s-eye view.
* Define wall lengths, wall heights, doors, windows, and blocked wall zones.
* View each wall as a scaled elevation.
* Drag artworks from a side panel onto wall elevations.
* Automatically snap artworks to a configurable centerline height, such as 58 inches.
* Override centerline placement manually.
* Add labels and wall text as scaled draggable wall objects.
* Group artworks and labels together.
* Drag, align, and center groups as units.
* Add simple floor objects such as sculptures, plinths, vitrines, benches, and cases.
* Preview the room in simple 3D.
* Save camera views.
* Export layouts for presentation or sharing.

---

## 3. Recommended Stack

### Application Framework

Use:

```txt
Next.js + React + TypeScript
```

Rationale:

* The app needs accounts, private projects, permissions, uploads, possible signed upload routes, future sharing links, admin tools, rate limiting, and possibly payments.
* These needs make Next.js more appropriate than a static Vite app long-term.
* The core editor canvas can still be a client-only React experience inside a Next.js app.

### UI Layer

Use:

```txt
shadcn/ui + Radix UI + Tailwind CSS
```

Rationale:

* Good fit for professional app UI.
* Allows custom visual identity.
* Strong ecosystem and AI-agent support.
* Good for drawers, side panels, command palettes, context menus, dialogs, popovers, and tabs.

### 2D Rendering

Use:

```txt
Konva / react-konva
```

Rationale:

* Good fit for canvas-based 2D manipulation.
* Suitable for room plans, wall elevations, scaled objects, drag/drop, snapping, selection, measurement guides, and collision detection.

### 3D Rendering

Use:

```txt
React Three Fiber + three.js
```

Rationale:

* Good React-native way to build simple 3D previews.
* Can derive 3D room geometry from the same project model used by the 2D editor.
* Supports orbit/walkthrough cameras and saved viewpoints.

### State Management

Use:

```txt
Zustand
```

or possibly:

```txt
TanStack Store
```

Rationale:

* The editor needs a predictable shared state model.
* Canvas object state should not be the source of truth.
* The app should store plain project data and render that data into 2D/3D views.

### Backend / Database / Auth

Use:

```txt
Supabase Auth
Supabase Postgres
Supabase Row Level Security
Supabase Storage or Cloudinary
```

Rationale:

* Supabase is a strong fit for account-based apps with private user data.
* Row Level Security should enforce privacy at the database level.
* Storage can be linked to users/projects.
* Cloudinary may still be useful if image transformations, optimization, and delivery are important.

---

## 4. Product Architecture

The app should have three major editing/viewing modes.

### A. Project Dashboard

The dashboard allows users to:

* View all projects.
* Create a new project.
* Duplicate a project.
* Delete/archive a project.
* Open recent projects.
* See storage usage and project metadata.
* Eventually manage collaborators or shared snapshots.

Each project is private by default.

---

### B. Bird’s-Eye Room Plan View

The bird’s-eye plan is where users define the room layout.

Core features:

* Draw simple polygonal/rectilinear room shapes.
* Support rectangular and irregular box-like rooms.
* Show wall lengths.
* Allow users to name walls.
* Allow users to set wall heights.
* Add doors and windows to walls.
* Add floor objects such as sculptures, plinths, vitrines, benches, and cases.
* Add camera positions.
* Select a wall to open its elevation view.

Constraints:

* No curved walls in initial versions.
* No complex architectural modeling.
* No sloped floors or ceilings.
* No realistic doors/windows in 3D beyond simple placeholders.
* No full CAD-level precision tools.

---

### C. Wall Elevation View

The wall elevation is the primary curatorial layout surface.

Each wall elevation should be rendered as a rectangle:

```txt
width = real wall length
height = real wall height
```

Users can:

* Drag artworks from a side panel onto the wall.
* Place works at real scale.
* Snap works to a configurable centerline height.
* Align works to wall center, edges, neighboring artworks, groups, and grid.
* Add wall labels.
* Add wall text.
* Add doors, windows, and blocked zones.
* Prevent artwork placement over doors/windows/blocked zones.
* Select, multi-select, group, ungroup, drag, nudge, and align objects.
* Enter precise dimensions and placement values in an inspector.

The elevation view should feel closer to Figma/Keynote/Illustrator than to a physics toy. Precision matters more than playful movement.

---

### D. 3D Preview View

The 3D view should be a derived preview.

It should show:

* Room footprint extruded into vertical walls.
* Artworks placed on walls.
* Labels represented as simple wall cards.
* Doors/windows represented as simple openings or outlined rectangles.
* Floor objects represented as boxes, plinths, vitrines, or simple image-wrapped objects.
* Saved camera positions.
* Orbit/pan camera navigation.
* Optional eye-height camera preview.

Initial 3D should not support full editing. Users may be able to select an object and jump back to its wall/floor editor, but direct 3D editing should be delayed.

---

## 5. Core Data Model

The app should be built around plain project data, not canvas state.

Recommended conceptual model:

```ts
type Project = {
  id: string
  ownerId: string
  title: string
  unit: "in" | "ft" | "cm" | "m"
  defaultWallHeight: number
  defaultCenterlineHeight: number
  createdAt: string
  updatedAt: string
}
```

```ts
type Room = {
  id: string
  projectId: string
  name: string
  height: number
  points: Array<{ x: number; y: number }>
}
```

```ts
type Wall = {
  id: string
  roomId: string
  name: string
  startPointIndex: number
  endPointIndex: number
  height: number
  defaultCenterlineHeight?: number
}
```

```ts
type Asset = {
  id: string
  ownerId: string
  projectId: string
  storagePath: string
  thumbnailPath?: string
  originalFilename?: string
  mimeType: string
  widthPx?: number
  heightPx?: number
  createdAt: string
}
```

```ts
type Artwork = {
  id: string
  projectId: string
  title: string
  artist?: string
  date?: string
  medium?: string
  dimensionsText?: string
  width: number
  height: number
  depth?: number
  assetId?: string
}
```

```ts
type WallObjectBase = {
  id: string
  projectId: string
  wallId: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  locked?: boolean
  groupId?: string
}
```

```ts
type ArtworkWallObject = WallObjectBase & {
  kind: "artwork"
  artworkId: string
  centerlineHeight?: number
}
```

```ts
type LabelWallObject = WallObjectBase & {
  kind: "label"
  labelStyle: "object-label" | "wall-text" | "section-text"
  attachedToId?: string
  textPreview?: string
  centerlineHeight?: number
}
```

```ts
type OpeningWallObject = WallObjectBase & {
  kind: "door" | "window" | "blocked-zone"
  blocksPlacement: true
  label?: string
}
```

```ts
type WallGroup = {
  id: string
  projectId: string
  wallId: string
  name?: string
  objectIds: string[]
}
```

```ts
type FloorObject = {
  id: string
  projectId: string
  roomId: string
  label: string
  type: "sculpture" | "plinth" | "case" | "bench" | "vitrine" | "other"
  x: number
  y: number
  z: number
  width: number
  depth: number
  height: number
  rotation: number
  assetId?: string
}
```

```ts
type CameraView = {
  id: string
  projectId: string
  roomId: string
  name: string
  x: number
  y: number
  z: number
  targetX: number
  targetY: number
  targetZ: number
  fov: number
}
```

---

## 6. Centerline / Eyeline Behavior

Centerline hanging should be a core feature.

Each project should have a default centerline height, for example:

```txt
58 inches
```

Users should be able to change this globally:

```txt
Project Settings → Default centerline: 58 in / 60 in / custom
```

Wall-level overrides should be possible later.

Object-level overrides should be possible from the beginning or near the beginning.

Formula:

```txt
artwork top Y = centerline height - artwork height / 2
```

Example:

```txt
Centerline: 58 in
Artwork height: 24 in
Top edge: 46 in from floor
Bottom edge: 70 in from floor
```

Default drag behavior:

1. User drags artwork from side panel.
2. Artwork preview appears on wall.
3. Vertical center snaps to project/wall centerline.
4. User chooses horizontal position.
5. Measurement guides appear during placement.
6. User can drag off the centerline if desired.

Snapping should feel magnetic, not rigid.

Recommended snap behavior:

```txt
Close to centerline: hard snap
Near centerline: soft magnetic pull
Far from centerline: free movement
Modifier key: temporarily disable snapping
```

Possible controls:

* Inspector field: center height
* Inspector field: top edge
* Inspector field: bottom edge
* Right-click: set center height
* Command palette: “Set selected centerline to 58 in”
* Command palette: “Set selected centerline to 60 in”
* Command palette: “Align selected to project centerline”

---

## 7. Doors, Windows, and Blocked Zones

Doors and windows should be treated as wall openings/obstructions.

They are simple rectangles on wall elevations.

They should:

* Render visually as architectural constraints.
* Have real dimensions.
* Block artwork placement.
* Participate in collision detection.
* Be shown in 3D preview.
* Optionally be lockable.

The app should also support generic blocked zones for:

* Vents
* Light switches
* Security devices
* Wall text areas
* Thermostats
* Fire equipment
* Lender restrictions
* Any area where artwork cannot be placed

Collision behavior:

* If an artwork overlaps a door/window/blocked zone, placement is invalid.
* The artwork should show a warning outline or invalid state.
* The app should prevent final placement unless the user moves the object.
* Advanced override can be considered later, but not necessary in v1.

---

## 8. Labels and Wall Text

Labels should be first-class wall objects, not just annotations.

They should be draggable, scalable rectangles on wall elevations.

Visual appearance:

* Simple rectangle
* Thin border
* Light fill
* Grey lines implying text
* Optional title/preview text later

Label types:

```txt
Object label
Wall text
Section text
Custom label/card
```

Initial features:

* Add label from toolbar or context menu.
* Drag label like artwork.
* Snap label to centerline or custom height.
* Align label to artwork, group, or wall.
* Group label with artwork.
* Move label as part of group.

Future features:

* Attach label to artwork.
* Generate label from artwork metadata.
* Export checklist/label package.
* Use real text preview.
* Label templates.

---

## 9. Grouping

Grouping should be part of the core wall elevation system.

Users should be able to group:

* Multiple artworks
* Artwork + label
* Multiple labels
* Triptychs
* Salon clusters
* Wall text + object groups

Expected behavior:

* Select multiple objects.
* Group selected objects.
* Drag group as one unit.
* Center group horizontally on wall.
* Center group vertically on project centerline.
* Nudge group with keyboard.
* Ungroup.
* Lock group.
* Duplicate group later.

Selection behavior:

```txt
Click object → select object
Shift-click → add/remove from selection
Drag empty wall → marquee select
Cmd/Ctrl-G → group
Cmd/Ctrl-Shift-G → ungroup
Double-click group → edit inside group
Escape → exit group editing
```

Centerline snapping should support both individual objects and groups.

If one artwork is selected:

```txt
snap artwork center to 58 in
```

If a group is selected:

```txt
snap group bounding-box center to 58 in
```

This is crucial for professional layouts, because groups often need to be centered as compositions rather than as individual works.

---

## 10. Snapping, Guides, and Precision Controls

The editor should support several snapping systems:

### Snap Targets

* Project centerline
* Wall center
* Wall edges
* Grid
* Neighboring artwork edges
* Neighboring artwork centers
* Group edges
* Group centers
* Standard spacing intervals
* Label alignment guides

### Constraints

* Wall bounds
* Doors
* Windows
* Blocked zones
* Locked objects
* Optional minimum spacing rules later

Important principle:

```txt
Snapping suggests good positions.
Collision detection rejects invalid positions.
```

These systems should be implemented separately to avoid tangled logic.

Precision controls:

* Arrow key nudge
* Shift + arrow key larger nudge
* Optional modifier to disable snapping
* Inspector panel numeric fields
* Context menu commands
* Command palette commands

---

## 11. User Accounts, Permissions, and Privacy

Projects should be private by default.

Initial permission model:

```txt
owner
editor
viewer
```

Database tables should support:

```txt
profiles
projects
project_members
assets
rooms
walls
wall_objects
wall_groups
floor_objects
camera_views
project_snapshots
```

Rules:

* Users can see projects they own.
* Users can see projects where they are listed as members.
* Owners can edit, delete, duplicate, invite, and manage permissions.
* Editors can modify project contents.
* Viewers can only view.
* Public snapshot links should not expose the live project directly.

Use database-level Row Level Security so privacy is enforced even if client code has bugs.

---

## 12. Snapshot Sharing

Future sharing should use snapshots, not live project visibility.

A snapshot should be:

* Read-only
* Frozen at a specific moment
* Token-based
* Revocable
* Optionally expiring

Conceptual model:

```ts
type ProjectSnapshot = {
  id: string
  projectId: string
  createdBy: string
  snapshotJson: unknown
  publicToken: string
  expiresAt?: string
  revokedAt?: string
  createdAt: string
}
```

This avoids making live projects public accidentally.

Flow:

1. User creates private project.
2. User clicks “Create snapshot link.”
3. App freezes current project data into snapshot JSON.
4. App generates a public token.
5. Viewer can open read-only snapshot.
6. Owner can revoke link.

---

## 13. Uploads and Storage

Uploads should be associated with:

* User
* Project
* Asset record
* Artwork record, if applicable

Storage options:

### Option A: Supabase Storage

Pros:

* Integrates well with Supabase Auth and RLS.
* Easier to reason about user/project ownership.
* Good fit for private assets.

Cons:

* Less image-transformation power than Cloudinary.

### Option B: Cloudinary

Pros:

* Strong image delivery, optimization, thumbnails, transformations.
* Useful for image-heavy applications.

Cons:

* Signed uploads should be considered for production.
* Need careful cost controls.
* Client-side unsigned uploads require strict preset limits.

Recommended approach:

* Start with the simplest safe storage option.
* Enforce upload size limits.
* Generate thumbnails.
* Compress images before upload where possible.
* Track storage usage per user and per project.
* Add signed uploads before a public launch if using Cloudinary.

---

## 14. Rate Limiting and Cost Controls

The app should be designed to avoid unexpected costs.

Cost control features:

* Free account project limit.
* Free account storage limit.
* Max upload file size.
* Max images per project.
* Max projects per user.
* Max public snapshots.
* Max exports per day.
* Image compression before upload.
* Thumbnail generation.
* Storage usage dashboard.
* Admin view of high-usage accounts.
* Rate limit upload/signing/export endpoints.
* Consider invite-only beta before fully public launch.

Potential paid model later:

```txt
Free tier:
- limited projects
- limited storage
- limited exports
- private projects only or limited snapshots

Paid tier:
- more projects
- more storage
- more exports
- snapshot sharing
- collaboration
- advanced export tools
```

Do not assume the app can remain fully free if it gains real users. Image-heavy applications can become expensive, especially once uploads, exports, and public sharing are involved.

---

## 15. Admin Tools

Admin tools are not necessary for the first local prototype, but the system should allow them later.

Possible admin features:

* View users.
* View projects count.
* View storage usage.
* View upload volume.
* Disable abusive accounts.
* Delete inappropriate or excessive uploads.
* Inspect failed uploads/export jobs.
* Manage beta access.
* See public snapshot count.
* Monitor rate limit hits.

---

## 16. Exports

Exports are important for professional curatorial work.

Possible export formats:

### Early

* Export project JSON
* Export wall elevation as PNG
* Export floor plan as PNG
* Export 3D view screenshot

### Later

* PDF packet with floor plan + wall elevations
* Object checklist
* Wall-by-wall layout sheets
* Label placement map
* Camera view sheet
* Printable scale drawings

PDF/export generation may eventually require server-side jobs or background processing if layouts become complex.

---

## 17. MVP Scope

The first rebuild should prove the spatial workflow before adding all SaaS features.

### MVP 1: Local Spatial Prototype

No auth required.

Must support:

* Create simple room footprint.
* Show wall lengths.
* Select wall.
* Open wall elevation.
* Add artwork object with dimensions.
* Drag artwork onto wall.
* Auto-snap artwork to default centerline.
* Drag artwork off centerline.
* Add door/window rectangle to wall.
* Prevent artwork from overlapping door/window.
* Add simple wall label.
* Multi-select wall objects.
* Group selected wall objects.
* Drag group.
* Center group on centerline.
* Add simple floor object in plan view.
* Render simple derived 3D preview.

This phase answers the most important question:

> Does the new interaction model feel precise, stable, and curator-native?

### MVP 2: Project Persistence

Add:

* Save/load project locally.
* Autosave.
* Export/import project JSON.
* Image upload or local image attachment.
* Basic project dashboard.

### MVP 3: Accounts and Cloud Projects

Add:

* Supabase Auth.
* User profiles.
* Private projects.
* Supabase RLS.
* Project save/load from database.
* User/project-associated assets.
* Basic storage limits.

### MVP 4: Professional Workflows

Add:

* PDF/image export.
* Wall labels with metadata.
* Saved camera views.
* Better object list/checklist.
* Measurement reports.
* Improved snapping/spacing tools.
* Context menus.
* Command palette.

### MVP 5: Sharing and Monetization

Add:

* Read-only snapshot links.
* Revocable public tokens.
* Admin tools.
* Upload rate limiting.
* Export limits.
* Subscription or paid tier.
* Collaboration/permissions.

---

## 18. Features to Avoid at First

Do not include in the first serious rebuild:

* Curved walls.
* Complex CAD tools.
* Full 3D editing.
* Realistic lighting simulation.
* Complex collision physics.
* Multi-floor buildings.
* Doors/windows with swing arcs unless needed later.
* Real-time collaboration.
* Complex permissions beyond owner/editor/viewer.
* AI features.
* Payments before usage justifies them.

These can be considered later, but they should not distract from the core planning workflow.

---

## 19. UX Principles

Sightlines should feel:

* Precise
* Calm
* Professional
* Trustworthy
* Fast
* Curator-native
* Less like a toy
* Less like generic interior design software
* More like a lightweight exhibition planning instrument

The best interaction moments should be:

* Dragging an artwork onto a wall and seeing it snap cleanly to 58 inches on center.
* Clicking a wall in plan view and immediately seeing its elevation.
* Grouping several objects and centering the whole group as one composition.
* Seeing doors/windows prevent impossible placements.
* Dropping into 3D and immediately understanding the spatial relationship.
* Saving a camera view that approximates a visitor’s sightline.

---

## 20. Product Positioning

Sightlines is not:

```txt
A full CAD program
A SketchUp clone
A generic room planner
A museum collection database
A 3D modeling tool
```

Sightlines is:

```txt
A scaled exhibition layout tool for planning artworks, labels, wall relationships, floor objects, and sightlines across floor plan, elevation, and simple 3D views.
```

The professional promise:

> Sketch the gallery, define the walls, place the works, respect the architecture, and preview the installation before anything goes on the wall.

---

## 21. Recommended Build Order

Recommended initial build sequence:

1. Define project data model.
2. Build local project store.
3. Build bird’s-eye room plan renderer.
4. Build simple polygon/rectangular room creation.
5. Generate wall records from room footprint.
6. Build wall elevation renderer.
7. Add artwork dimension model.
8. Add side panel artwork drawer.
9. Implement drag-to-wall placement.
10. Implement centerline snapping.
11. Implement object inspector.
12. Add doors/windows/blocked zones.
13. Add collision detection.
14. Add labels as wall objects.
15. Add multi-select.
16. Add grouping.
17. Add group drag and group centerline snapping.
18. Add floor objects.
19. Add simple 3D preview.
20. Add saved camera views.
21. Add local save/load.
22. Add auth and cloud persistence.
23. Add uploads.
24. Add exports.
25. Add snapshots and admin tools.

---

## 22. Core Technical Principle

The most important technical rule:

> The canvas should render the layout.
> The canvas should not own the layout.

Konva shapes, React components, and Three.js objects should all be temporary visual representations of the underlying project data.

The data model should remain the source of truth.

This avoids the common failure mode where:

```txt
canvas state
database state
React state
drag state
3D state
```

all begin fighting each other.

Instead:

```txt
project data
→ 2D plan renderer
→ wall elevation renderer
→ 3D preview renderer
→ export renderer
```

That is the architecture that will keep the rebuild stable.

# Sightlines Spec Addendum: Artwork Dimensions, Checklist, and Exports

## 1. Artwork Image Upload and Dimension Handling

Sightlines should distinguish between an **uploaded image asset** and a **scaled artwork record**.

An image upload by itself only provides a visual file. It does not provide real-world scale.

Therefore, after upload, the app should prompt the user to enter dimensions before the image can be placed accurately on a wall elevation.

### Recommended Data Model Distinction

```ts
type Asset = {
  id: string
  projectId: string
  ownerId: string
  storagePath: string
  thumbnailPath?: string
  originalFilename?: string
  mimeType: string
  widthPx?: number
  heightPx?: number
  createdAt: string
}
```

```ts
type Artwork = {
  id: string
  projectId: string
  assetId?: string

  artist?: string
  artistLastName?: string
  title?: string
  date?: string
  medium?: string
  dimensionsText?: string

  width?: number
  height?: number
  depth?: number
  unit: "in" | "cm" | "ft" | "m"

  dimensionStatus: "known" | "approximate" | "unknown"
  sortOrder?: number
}
```

The key field is:

```ts
dimensionStatus: "known" | "approximate" | "unknown"
```

This allows the app to support professional accuracy while still letting users play with layouts before all metadata is complete.

---

## 2. Upload Flow

When a user uploads an artwork image, the app should create an image asset and then guide the user through creating an artwork record.

### Preferred Flow

1. User uploads image.
2. Image appears in the checklist/artwork panel as “Needs dimensions.”
3. User is prompted to add:

   * width
   * height
   * optional depth
   * unit
   * optional artist/title/date/medium
4. Once dimensions are added, the artwork becomes fully placeable at real scale.

### If User Knows Dimensions

The artwork is marked:

```txt
Dimensions: known
```

It can be placed normally on wall elevations and in 3D.

### If User Does Not Know Dimensions

User can choose:

```txt
I don’t know dimensions
```

Then the app creates an approximate placeholder artwork using a default size, for example:

```txt
24 × 30 in
```

or a user-selectable generic size:

```txt
Small
Medium
Large
Custom approximate
```

The object can be placed in the layout, but it should be visibly marked as approximate.

Possible visual indicators:

* Small warning/approximation icon
* Dashed outline
* “Approx.” badge in inspector
* “Unknown dimensions” label in checklist
* Tooltip: “This work is using placeholder dimensions.”

The goal is to allow sketching without pretending the layout is accurate.

---

## 3. Placement Rules Based on Dimension Status

### Known Dimensions

Works with known dimensions are placed at true scale.

They can participate fully in:

* snapping
* grouping
* spacing
* collision detection
* elevation export
* 3D preview
* checklist export

### Approximate Dimensions

Works with approximate dimensions can also be placed, but the interface should clearly indicate uncertainty.

They should still participate in layout logic, but exports should mark them as approximate.

Example export notation:

```txt
Dimensions approximate
```

or:

```txt
Approx. 24 × 30 in
```

### Unknown Dimensions

There are two possible approaches:

#### Option A: Unknown cannot be placed

This is the strict professional approach.

The artwork remains in the checklist but cannot be dragged onto a wall until dimensions are added or approximate dimensions are chosen.

#### Option B: Unknown can become approximate

This is the more flexible approach and probably better for Sightlines.

If a user tries to drag an unknown-dimension artwork onto a wall, the app should prompt:

```txt
This work needs dimensions before it can be scaled.
Add dimensions now, or use placeholder dimensions?
```

Options:

```txt
Add dimensions
Use approximate size
Cancel
```

Recommended behavior:

> Unknown works cannot be placed directly, but users can convert them to approximate works in one click.

---

## 4. Checklist Panel

Sightlines should include a **Checklist** panel that functions as the project’s artwork/object inventory.

This panel should show all works in the project, whether or not they have been placed on a wall.

Each checklist item should include:

* image thumbnail
* artist
* title
* date
* medium
* dimensions
* dimension status
* placement status
* wall/location if placed
* warning indicators if metadata is missing

Example checklist row:

```txt
[thumbnail]  Claude Cahun
             Untitled
             1928
             Gelatin silver print
             9 × 7 in
             Wall A · placed
```

For unknown/approximate dimensions:

```txt
[thumbnail]  Untitled
             Artist unknown
             dimensions unknown
             Not placed
             ⚠ needs dimensions
```

or:

```txt
[thumbnail]  Untitled
             Approx. 24 × 30 in
             Wall B · placed
             ◇ approximate scale
```

---

## 5. Checklist Sorting and Ordering

The checklist should support multiple sorting modes.

### Sort Options

* Artist last name
* Artist full name
* Title
* Date
* Medium
* Dimensions
* Placement status
* Wall/location
* Custom order

### Custom Order

Users should be able to manually rearrange checklist items.

This is important because curators often think in terms of checklist sequence, exhibition sequence, lender sequence, section sequence, or installation order.

Custom order should be stored as:

```ts
sortOrder: number
```

or in a separate ordered list if needed.

### Sorting UI

The checklist panel should include a clear sort control:

```txt
Sort by: [Custom order ▼]
```

Options:

```txt
Custom order
Artist
Title
Date
Medium
Wall
Placed / unplaced
Missing dimensions
```

When in custom order mode, users can drag checklist items to rearrange them.

When in another sort mode, drag-reordering should either be disabled or should prompt the user to switch back to custom order.

---

## 6. Checklist Metadata Editing

Users should be able to edit artwork metadata from the checklist panel.

Fields:

* artist
* artist last name
* title
* date
* medium
* dimensions
* dimension status
* notes
* lender/collection later
* section/group later

The checklist should also support quick warnings:

```txt
Missing dimensions
Missing image
Missing title
Approximate dimensions
Unplaced
Placed more than once
```

This makes the checklist useful not only as inventory, but as a project readiness tool.

---

## 7. Dragging from Checklist to Wall Elevation

The checklist/artwork drawer should be the source for dragging artworks into the elevation view.

Behavior:

1. User opens a wall elevation.
2. User drags artwork from checklist/sidebar.
3. If dimensions are known:

   * artwork appears at real scale
   * vertical center snaps to project centerline
4. If dimensions are approximate:

   * artwork appears at approximate scale
   * approximate indicator remains visible
5. If dimensions are unknown:

   * user is prompted to enter dimensions or use placeholder dimensions

This keeps scale accuracy central without blocking early-stage planning.

---

## 8. Export Features

Sightlines should support multiple export types.

### A. Checklist Export

Users should be able to export a clean checklist with thumbnails and metadata.

Possible formats:

* PDF
* rich text / DOCX
* HTML
* CSV
* JSON

The most important early exports are probably:

```txt
PDF checklist
CSV checklist
Project JSON
```

A polished PDF checklist should include:

* project title
* date exported
* artwork thumbnails
* artist
* title
* date
* medium
* dimensions
* placement/wall
* notes
* dimension status indicators

Approximate works should be marked clearly.

Example:

```txt
Claude Cahun
Untitled, 1928
Gelatin silver print
9 × 7 in
Wall A

Unknown artist
Untitled
Medium unknown
Approx. 24 × 30 in
Wall B
Dimensions approximate
```

### B. Elevation Export

Users should be able to export individual wall elevations.

Each elevation export should include:

* wall name
* wall dimensions
* artworks at scale
* labels/wall text
* doors/windows/blocked zones
* centerline guide optionally shown
* object metadata optionally shown
* scale marker
* date exported

Possible formats:

* PNG
* PDF
* SVG later

### C. Floor Plan Export

Users should be able to export overhead plans.

Exports should include:

* room footprint
* wall names
* wall lengths
* doors/windows if represented in plan
* floor objects
* camera positions
* optional labels

Possible formats:

* PNG
* PDF
* SVG later

### D. 3D View Export

Users should be able to export 3D preview images from saved camera views.

Early format:

```txt
PNG screenshot
```

Later:

```txt
PDF packet with multiple saved views
```

### E. Project Packet Export

A later professional export could generate a full installation packet:

* cover page
* checklist
* overhead plan
* wall elevations
* saved 3D views
* object list
* missing metadata report
* approximate dimensions report

This would be a strong professional feature for curators and exhibition teams.

---

## 9. Missing / Approximate Data Reporting

Because Sightlines is scale-sensitive, the app should help users identify uncertain data.

A project readiness panel or checklist filter could show:

```txt
Needs dimensions
Approximate dimensions
Missing image
Missing title
Missing artist
Unplaced works
Works overlapping blocked zones
Works outside wall bounds
```

This could later become part of export:

```txt
Project Notes:
3 works use approximate dimensions.
2 works are missing dates.
1 work is unplaced.
```

---

## 10. Revised MVP Additions

The MVP should include basic versions of these features.

### Add to MVP 1 or MVP 2

* Upload image asset.
* Create artwork record from uploaded image.
* Require dimensions for true-scale placement.
* Allow “use approximate dimensions.”
* Mark approximate works visually.
* Checklist panel with thumbnails.
* Basic metadata fields.
* Sort checklist by custom order, artist, title, date, medium.
* Drag artwork from checklist to elevation.
* Export project JSON.

### Add to Professional Workflow Phase

* PDF checklist export.
* PDF wall elevation export.
* PNG elevation export.
* PNG floor plan export.
* 3D screenshot export.
* Missing metadata report.
* Rich text/DOCX checklist export.
* Full project packet export.

---

## 11. Important UX Principle

Sightlines should let users sketch before they know everything, but it should never hide uncertainty.

The ideal behavior:

> You can use approximate dimensions to keep planning, but Sightlines will clearly mark what is approximate so nobody mistakes a sketch for a measured installation plan.

This keeps the app flexible for early curatorial thinking while preserving professional trust.
