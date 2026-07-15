# Measure Tool and Reference Measurements — Behavior Spec

Status: Draft for implementation · Written: 2026-07-14

Decisions confirmed with Marina: one **Measure** tool in Plan and Elevation;
temporary by default; the tool stays armed after completion; one temporary
measurement at a time; temporary and saved measurements are selectable and use
the contextual right inspector; saved v1 measurements are fixed references,
not linked relationships; reference measurements are not snap targets; snap
feedback is visual and carries no explanatory target labels.

## 1. Goal

Let a curator answer a spatial question directly on the drafting surface —
"How far is it from here to here?" — without changing project geometry. When a
distance becomes useful as a planning benchmark, the curator can deliberately
keep it as a reference while trying other arrangements.

The feature has two implementation slices:

1. **Temporary Measure** — an armed, non-persistent point-to-point inquiry tool.
2. **Reference measurements** — explicitly saved, selectable project
   annotations that remain fixed while surrounding objects move.

The slices share one drawing interaction and one visual family. Slice 1 must be
useful by itself and must not require a project schema change.

## 2. Product model

### 2.1 Measurement versus geometry

A measurement reports geometry; it does not edit or constrain it. The distance
readout is therefore read-only. `docs/plan.md` §2's tactile/numeric pairing
applies to geometry edits, not to reported values.

Making the displayed distance editable would be ambiguous: the app would have
to decide which endpoint moves, whether the angle is preserved, and whether a
snapped object should move. That is constraint-based editing and is outside
this feature.

### 2.2 Temporary measurement

Meaning: **How far is this right now?**

- Exists only as transient view state.
- Never dirties, autosaves, exports, or enters project undo history.
- Is replaced when the user begins another measurement.
- Can be refined, selected, inspected, kept as a reference, or cleared.

### 2.3 Reference measurement

Meaning: **Keep this position and distance as a planning benchmark.**

- Is created only through the explicit **Keep as reference** action.
- Persists in the project and participates in undo/redo.
- Remains fixed when nearby artworks, openings, walls, or other objects move.
- Is positioned in model space, never screen pixels.
- Is visibly and textually identified as a reference so a fixed benchmark is
  not mistaken for a live relationship between objects.

### 2.4 Deferred linked measurements

A linked measurement would mean **Keep reporting the distance between these
features** and would update when attached objects move. It is not part of this
spec. Automatic dimension lines may already cover much of that need; arbitrary
attachment, broken-link, reassignment, and deletion behavior should only be
designed after demonstrated user demand.

## 3. Scope

### 3.1 Slice 1 — Temporary Measure

- Plan and Elevation only; Measure is unavailable in 3D.
- One toolbar tool named **Measure** with shortcut `M`.
- Click-click and click-drag creation.
- Live direct-distance readout.
- Endpoint snapping to visible geometry and grid candidates.
- Visual snap feedback without persistent or transient text labels.
- Shift constraint.
- Endpoint refinement.
- Selection and a contextual Measurement inspector.
- Keyboard and touch-complete interaction paths.
- No persistence, schema, import/export, print/export, or undo changes.

### 3.2 Slice 2 — Reference measurements

- **Keep as reference** from a completed temporary measurement.
- Project persistence and `.sightlines` round-trip.
- Optional name.
- Select, inspect, show/hide, lock/unlock, edit endpoints, and delete.
- Undo/redo for every mutation.
- Honest behavior through wall and room geometry changes.
- No PNG/PDF inclusion until export-annotation behavior is specified.

### 3.3 Non-goals

- No linked/following measurements.
- No editable distance value or geometric constraints.
- No clearance solver or minimum-clearance enforcement.
- No chain, area, angle-only, radius, or path measurement tools.
- No cross-wall Elevation measurement. An Elevation measurement belongs to one
  displayed wall surface.
- No reference-measurement snap targets.
- No dedicated Measurements left pane in these slices.
- No canvas labels explaining snap target kinds.

## 4. Vocabulary and copy

| Concept | User-facing term | Avoid |
|---|---|---|
| Toolbar action | Measure | Ruler |
| Temporary result | Measurement | Dimension line |
| Persisted fixed result | Reference measurement | Pinned span, guide |
| Persistence action | Keep as reference | Save measurement |
| Editing protection | Locked / Unlocked | Fixed (ambiguous with reference behavior) |

"Dimension lines" remains reserved for Sightlines' automatic derived
annotations. "Clearance" remains reserved for spatial clearance calculations.
"Guide" remains reserved for transient snapping/alignment feedback.

## 5. Interaction state model

Measure extends the app's mutually exclusive armed-tool state rather than
adding an independent boolean mode.

```text
inactive
  └─ activate Measure / press M → armed-empty

armed-empty
  ├─ pointer down on drawable geometry or empty canvas → drawing
  ├─ select existing reference measurement → armed-reference-selected
  └─ Escape / press M / choose another tool → inactive

drawing
  ├─ pointer move → live snapped preview
  ├─ complete second endpoint → armed-complete
  └─ Escape / tool or view change → armed-empty

armed-complete
  ├─ drag endpoint → refining
  ├─ Keep as reference → armed-reference-selected
  ├─ new canvas point → drawing, replacing the temporary result
  ├─ Clear / Escape → armed-empty
  └─ second Escape / press M / choose another tool → inactive

refining
  ├─ release / confirm → armed-complete or armed-reference-selected
  └─ Escape → restore the endpoint position from before refinement
```

The tool remains armed after completing or keeping a measurement because
measurement is commonly repetitive. The toolbar's armed treatment and the
crosshair over the drawable surface keep that state visible.

## 6. Pointer and event precedence

While Measure is armed, events resolve in this order:

1. **Endpoint handle of the selected measurement** — refine that endpoint.
2. **Existing temporary or reference measurement line or hit area** — select
   that measurement and show its inspector; do not begin a new measurement.
3. **Other visible canvas geometry** — begin a measurement point at the
   resolved position; do not change the underlying object's selection.
4. **Empty drawable canvas** — begin a measurement at that position.

This precedence lets users measure precisely from artwork, opening, and wall
geometry without ordinary object selection intercepting the click. Existing
measurements remain selectable because they belong to the active tool's own
interaction model.

This makes Measure a tool-specific working mode: while it is armed,
measurements are editable and everything else is measurable. A completed
temporary measurement is selected automatically, and clicking its body again
preserves that selection rather than replacing it. This deliberately differs
from a Photoshop-style lasso: a lasso result is application state, while a
Sightlines measurement is an inspectable canvas object and may become a
persistent project annotation.

An existing measurement's invisible selection hit area must be generous
enough to select without precision but restrained enough not to intercept
unrelated nearby starting points. Starting a new measurement exactly on top of
an existing line is an accepted rare conflict; no bypass modifier ships until
real use demonstrates the need.

UI outside the drawable canvas retains its normal interaction. Inspector
controls, toolbar buttons, rails, menus, and dialogs never place measurement
points.

## 7. Creation gestures

### 7.1 Click-click

1. The first click places endpoint A and begins a rubber-band preview.
2. Pointer movement previews endpoint B, snapping, guides, and distance.
3. The second click places endpoint B and completes the measurement.

Click-click is the primary low-precision and keyboard-compatible path.

### 7.2 Click-drag

1. Pointer down places endpoint A.
2. Drag previews endpoint B.
3. Pointer release places endpoint B and completes the measurement.

The implementation must distinguish a click from a drag using the app's shared
gesture/slop conventions so one physical action cannot place both endpoints by
accident.

### 7.3 Replacement

Only one temporary measurement exists. Beginning a new one immediately clears
the previous unkept result. No confirmation is required because the temporary
result has not been saved and **Keep as reference** is available before
replacement. Replacement is intentionally not undoable: temporary state never
enters project history, and adding a second hidden history would undermine the
single undo model. Users preserve a result by keeping it before beginning
another.

### 7.4 Degenerate measurement

A measurement cannot complete with coincident endpoints. A pointer gesture
that stays within the shared click/drag slop continues into the click-click
path rather than creating a zero-length drag result. If endpoint B resolves to
endpoint A during click-click creation or snapping, completion is ignored and
the tool remains in drawing state with endpoint A preserved. Continued pointer
movement is the recovery; no error message is necessary.

## 8. Cursor and visual feedback

- While Measure is armed, the cursor is a crosshair only over the drawable
  canvas and canvas geometry that can place a point.
- Existing measurement lines and endpoint handles retain selection/edit
  cursors so their affordances remain distinguishable.
- Snap feedback uses endpoint state plus the existing restrained guide visual
  language. It does not display labels such as "Artwork edge" or "Wall
  corner."
- Snap state must not rely on color alone. Endpoint shape, guide appearance,
  or another non-color cue must change while snapped.
- Handles have restrained visible marks and generous invisible hit areas.
- The direct-distance value follows the line without obscuring its endpoints
  or the measured geometry.

Temporary and persisted results share a visual family:

| State | Required distinction |
|---|---|
| Temporary complete/selected | Petrol active treatment, solid line, visible handles |
| Reference at rest | Neutral or muted treatment plus a non-color reference marker or line pattern |
| Reference selected | Selection treatment and handles when editable |
| Locked reference selected | Selection treatment without draggable handles; inspector states Locked |

Exact tokens and dimensions follow `DESIGN.md`; this spec does not create a new
color system.

## 9. Measurement geometry

### 9.1 Reported value

The primary value is straight-line endpoint distance in the active view's
model coordinate space. It uses `formatLength` and the project's existing unit
and display-precision settings. Display rounding never alters endpoint storage.

Horizontal delta, vertical delta, and angle are not required for v1. They may
be added only after confirming that they serve curatorial work rather than
turning the inspector into a CAD readout panel.

### 9.2 Plan coordinates

Endpoints use floor/project model coordinates. They are independent of zoom,
pan, and viewport size.

### 9.3 Elevation coordinates

Endpoints use wall-local coordinates: x is distance from the displayed wall's
start and y is height from the floor. Both endpoints belong to the current
wall/partition face. Changing to another wall does not reinterpret the
measurement on the new wall.

### 9.4 Artwork footprint

Measurement targets use the geometry Sightlines paints and treats as physical.
For wall artwork, that means the effective outer framed footprint through the
canonical framing adapter in `docs/framing-dimension-contract.md`, never a
hand-rolled widened rectangle. Floor artwork follows the framing contract's
deliberate image-footprint rule.

## 10. Snapping

Measurement reuses the app's visible geometry sources, precision system,
screen-to-world threshold conversion, deterministic tie-breaking, and
hysteresis principles. It does **not** reuse the existing axis-decomposed
`resolveSnap` contract as-is: placement targets align moving boxes to lines and
intentionally resolve x and y independently, while measurement targets resolve
one complete point.

### 10.1 One coherent point

An endpoint resolves to one nearest two-dimensional candidate. It must not
silently combine x from one semantic feature and y from another and then imply
that the composite point belongs to either feature.

Measurement therefore owns a point-candidate representation and a pure
single-winner resolver (for example, `resolveMeasurePoint`) that ranks eligible
candidates by priority, Euclidean distance, and stable id. A previously held
point target receives the same break-free hysteresis principle as other snaps,
but hysteresis is tracked for that one target rather than independently per
axis.

Candidate generation should derive from the same pure Plan/Elevation scene
geometry that drives painting, so visible geometry and measurable geometry
cannot drift. Existing generators may provide source geometry or shared math,
but explicit vertices, corners, and grid intersections are new 0-D candidates
rather than existing `SnapTarget` values reused unchanged.

### 10.2 Candidate families

Candidate families, in intended priority order:

1. Explicit vertices and corners: room/wall endpoints, object corners.
2. Object and wall edges, including framed artwork outer edges.
3. Object and wall centers.
4. Elevation floorline and centerline where applicable.
5. Visible grid intersections from the shared precision pair ladder.

Exact tie-breaking and thresholds remain deterministic and screen-correct at
any zoom. Priority, distance, stable id, and hysteresis must be unit-tested.

### 10.3 Snap bypass and constraint

- `Shift` constrains the proposed line to the app's established directional
  convention before snap resolution.
- `⌘`/`Ctrl` temporarily bypasses snapping, matching the convention already
  used by artwork placement. No Measure-only `Alt` convention is introduced.
- Reference measurements are not included in the candidate set.

## 11. Selection and inspector

The right inspector is the single editing surface for the currently selected
temporary or reference measurement. A canvas popover is not required.

### 11.1 Completed temporary measurement

Inspector content:

- Heading: **Measurement**
- Read-only direct distance
- Primary action: **Keep as reference**
- Secondary action: **Clear**

The inspector does not show name, visibility, lock, or type controls before
persistence.

### 11.2 Reference measurement

Inspector content:

- Heading: **Measurement**
- Optional name field
- Read-only direct distance
- Read-only type/status: **Reference**
- Visibility control: **Visible** / **Hidden**
- Editing protection: **Unlocked** / **Locked**
- Destructive action: **Delete measurement**

If Reference is the only saved type, type is explanatory status rather than a
select control. Supporting text, if needed, is: **Keeps its position when
surrounding objects move.**

### 11.3 Inspector continuity

Selecting a reference while Measure is armed:

- selects it and opens its inspector;
- does not disarm Measure;
- does not create or replace the temporary measurement;
- preserves the crosshair over other drawable canvas regions.

Selecting a non-measurement through another app surface follows ordinary app
selection behavior. The Measure tool's own canvas precedence remains as §6.

## 12. Reference persistence and editing

### 12.1 Coordinate ownership

- Plan references store floor/project model coordinates.
- Elevation references store the owning wall/partition-face id plus wall-local
  endpoint coordinates.
- References never store viewport or screen pixels.

The exact schema shape belongs to Slice 2 engineering design, but it must make
the coordinate space explicit and support project validation, migration,
package round-trip, and stable identity.

### 12.2 Keep as reference

Keeping a completed temporary measurement:

1. Creates one persisted reference in one undoable edit.
2. Preserves the two displayed endpoints exactly.
3. Replaces the transient selection with selection of the new reference.
4. Leaves Measure armed.
5. Opens the reference inspector.

Undo reverses the conversion, not merely the persisted half of it. If Measure
is still armed in the same view and wall context, undoing **Keep as reference**
removes the reference and restores its endpoints as the selected temporary
measurement. If the user has moved to a coordinate context where those points
cannot be represented safely, undo removes the reference without restoring
transient state. Redo recreates and selects the reference when it is visible in
the current context.

### 12.3 Endpoint editing

- An unlocked selected reference exposes endpoint handles.
- One endpoint moves at a time through the same snap resolver as creation.
- One completed endpoint drag creates one undo entry.
- Escape during a drag restores the pre-drag position without an undo entry.
- Locked references remain selectable but expose no draggable handles.

### 12.4 Visibility and deletion

- Hidden references do not render on the canvas but remain project data.
- A hidden selected reference cannot remain selected once it is no longer
  rendered; the inspector returns to the normal empty-selection state.
- Delete uses the app's existing reversible deletion convention and enters
  undo history. No confirmation is required when undo is available and clear.

### 12.5 Geometry changes

Reference means stationary relative to its coordinate surface, not attached to
nearby objects.

- Moving or deleting nearby artwork/openings does nothing to the reference.
- Resizing a wall does not clamp or silently move a reference; out-of-bounds
  endpoints receive an advisory state consistent with Sightlines' existing
  "flag, don't silently fix" rule.
- An out-of-bounds reference continues to report the distance between its
  stored coordinates. The advisory communicates that an endpoint is no longer
  on the valid surface; the value is neither blanked nor silently recalculated.
- Wall split, merge, reversal, partition-side flip, room deletion, and
  partition deletion require explicit deterministic cascade rules before Slice
  2 implementation begins. The behavior must preserve the same physical wall
  location where possible and must never leave a silently mislocated or
  dangling authoritative annotation.

The unresolved cascade design is an engineering decision gate, listed in §17.

## 13. Escape, mode, and view transitions

Escape acts on the most local active state first:

1. During endpoint creation: cancel the in-progress measurement; remain armed.
2. During endpoint refinement: restore the pre-drag point; remain armed.
3. With a completed temporary measurement: clear it; remain armed.
4. With no temporary work in progress: disarm Measure.

Changing to another armed tool cancels temporary Measure state and arms the new
tool. Switching Plan ↔ Elevation clears temporary Measure state but preserves
the armed Measure tool, matching the existing shared 2D opening-tool behavior:
the user changed where they are measuring, not whether they intend to measure.
No transient endpoint is transformed between floor and wall-local coordinate
spaces. Switching to 3D clears temporary Measure state and disarms the tool
because Measure is unavailable there. Persisted references remain untouched;
selection clears if the selected reference is not visible in the destination
view.

Pressing `M` toggles Measure. Text inputs, editable elements, dialogs, and
menus suppress the shortcut through the existing shortcut guards.

## 14. Keyboard, touch, and assistive technology

The feature must be operable without a precision drag.

- Click-click is available for mouse, pen, and touch.
- Touch targets for endpoint handles meet the app's accessible target sizing;
  visible marks may remain smaller than their hit regions.
- A focused endpoint can be moved with arrow keys using the shared project
  nudge increment; the modified larger-step convention should match other
  canvas editing.
- Enter confirms keyboard endpoint placement/refinement; Escape cancels as
  §13.
- Measurement lines and handles have programmatic accessible names that
  include role and current distance/endpoint, without adding visible canvas
  labels.
- Live distance changes during creation are announced politely and throttled
  enough not to overwhelm screen-reader users; the final value is announced on
  completion.
- Temporary, Reference, selected, locked, hidden, and out-of-bounds states are
  never communicated by color alone.
- `M` is documented in the tool tooltip and shortcut help. The app's future
  shortcut-remapping/disable strategy must include this single-character
  shortcut.

## 15. Collection management and export

No Measurements left pane ships in these slices. The current information
architecture is preserved:

- left pane: manage collections and working categories;
- canvas: create and manipulate spatial objects;
- right pane: inspect and edit the selected object.

A future **Measurements** collection becomes justified when users need bulk
visibility, locking, deletion, naming, navigation, or export management across
many saved references. Its absence does not block selection and inspection of
individual references.

PNG/PDF export inclusion is intentionally deferred. A later annotation-export
spec must decide visibility defaults, print styling, naming, scale, and whether
hidden references can be selectively included.

## 16. Acceptance criteria

### 16.1 Slice 1

- Measure is available and visibly armed in Plan and Elevation, absent in 3D.
- `M` toggles it without firing from editable UI.
- Crosshair appears only over point-placeable canvas regions.
- Click-click and click-drag produce the same endpoint geometry.
- Completing a measurement leaves the tool armed.
- Beginning another replaces the one temporary result.
- Replacing a temporary result is intentionally not undoable.
- Canvas geometry places points instead of changing underlying object
  selection while Measure is armed.
- Temporary and reference measurements retain selection precedence over point
  placement, and a completed temporary result is selected automatically.
- Coincident endpoints do not complete a zero-length measurement.
- Endpoints snap to one coherent visible feature with non-text visual feedback.
- `Shift` constrains and `⌘`/`Ctrl` bypasses snapping.
- Display uses project units/precision and the established framing footprint.
- Temporary selection opens the Measurement inspector.
- Escape follows §13 exactly.
- No temporary interaction dirties or mutates the project.
- The primary flow is complete with keyboard and touch input.

### 16.2 Slice 2

- Keep as reference preserves the displayed points and creates one undoable
  project edit.
- Undoing Keep restores the selected temporary measurement when its coordinate
  context remains safely representable.
- References remain stationary when surrounding objects move.
- References are not placement or measurement snap targets.
- Selecting one opens the Measurement inspector without disarming Measure.
- Name, visibility, lock, endpoint edits, and delete behave as §11–12.
- Locked references remain selectable but cannot be dragged.
- All mutations undo/redo atomically.
- Project JSON/schema and `.sightlines` packages validate and round-trip
  references without coordinate drift.
- Wall/room/partition topology changes follow the resolved cascade table and
  never create a silent dangling or mislocated reference.
- Out-of-bounds references continue reporting stored-coordinate distance while
  clearly carrying an advisory state.

## 17. Decision gates before implementation

### Resolved product decisions

- One tool; temporary by default.
- Tool stays armed after completion.
- One temporary measurement.
- Canvas click begins a new measurement while armed.
- Temporary and saved measurements are selectable and inspected on the right.
- Reference measurements do not become snap targets.
- No snap-target labels.
- Inspector first; collection pane later if management demand appears.

### Slice 1 engineering questions

- Which existing plan-mode variant/name best accommodates Measure while
  keeping all armed modes mutually exclusive?
- What point-candidate shape best derives corners, vertices, centers, and grid
  intersections from the existing scene geometry while supporting a new pure
  single-winner resolver and guide output?
- What exact Shift constraint angles match existing drawing behavior?
- What keyboard focus model best fits SVG endpoint handles and current canvas
  selection?

These questions may affect implementation shape but not the specified user
behavior.

### Slice 2 blocking engineering decision

Before persistence work, write and approve a topology cascade table for:

| Change | Required question |
|---|---|
| Split perimeter wall | Which segment owns each point, and how is wall-local x remapped? |
| Merge/delete vertex | How are points projected while preserving physical position? |
| Reverse/reorder wall | How is x mirrored? |
| Flip partition sides | Does the reference stay on the physical face or follow the face identity? |
| Delete wall/room/partition | Delete reference, preserve as floor reference, or block? |

Default principle: preserve the same physical location when that meaning is
unambiguous; otherwise surface an explicit advisory or delete through the same
undoable cascade. Never guess silently.

## 18. Verification plan

### Domain tests

- Candidate generation for Plan and Elevation visible geometry.
- Framed artwork outer corners/edges; floor artwork image footprint.
- Single-winner resolution, deterministic ties, thresholds, and hysteresis.
- Unit/precision formatting without storage rounding.
- Reference schema, validation, migrations, and package round-trip (Slice 2).
- Every approved topology cascade with points before/at/after the changed
  boundary (Slice 2).

### Component and store tests

- State transitions and Escape precedence.
- Click versus drag slop.
- Coincident-endpoint rejection.
- Event precedence over objects and existing measurements.
- Inspector content for temporary, reference, locked, and advisory states.
- No project mutation for temporary state.
- One edit/undo entry per reference mutation.
- Undo/redo of Keep with same-context restoration and cross-context fallback.
- Shortcut guards and view/tool transitions.

### Browser and device verification

- Plan and Elevation at multiple zoom levels and both unit systems.
- Mouse click-click, mouse drag, pen/touch click-click, and endpoint refinement.
- Keyboard-only creation, selection, adjustment, keep, and clear/delete.
- Crosshair containment to drawable regions.
- Dense wall with adjacent framed works/openings to assess snap predictability
  and visual clutter.
- iPad portrait with both rails visible to verify toolbar density and inspector
  usability.
- Screen reader announcement pacing during a live measurement.

### UX validation after Slice 1

Use realistic curatorial tasks rather than preference questions:

1. Measure the current width of an artwork grouping.
2. Measure from a framed edge to a door opening.
3. Make several measurements in succession.
4. Preserve a grouping width, then try another arrangement (prototype Slice 2
   if not yet implemented).

Observe whether users notice the armed state, predict snapping without labels,
understand replacement of the temporary result, and interpret **Keep as
reference** correctly. Revisit linked measurements only if users repeatedly
need a saved value to follow moved objects and automatic dimensions do not
answer that need.

## 19. Ethical review

The feature preserves user autonomy through temporary-by-default behavior,
explicit persistence, reversible saved edits, and visible distinction between
a fixed reference and a live report. It introduces no deceptive, coercive, or
attention-extractive pattern. The principal trust risk is an authoritative
number becoming spatially stale after topology edits; Slice 2 is blocked on
explicit cascade behavior to prevent that failure.
