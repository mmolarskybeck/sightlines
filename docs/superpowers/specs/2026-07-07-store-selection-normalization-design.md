# Store selection normalization + arrange slice extraction — design

**Date:** 2026-07-07
**Status:** approved (brainstorm complete)
**Baseline:** main @ 5e45133, 733/733 tests, build clean

## Goal

One refactor slice with two parts:

1. **Warm-up follow-ups** (filed at kiss-dry-sweep branch finish, none merge-blocking):
   - Build assertion that no eager chunk ever statically imports the `three` chunk again.
   - Unit tests for the wheel-handler math in `useSvgViewportGestures`.
   - Replace the local `clamp` in `src/domain/snapping/planSnapTargets.ts` (~line 227) with the shared `clamp` from `src/domain/geometry/scalar.ts`.
2. **Store normalization** (the deferred big-ticket item): collapse the five overlapping
   selection slots into one discriminated union, and extract the arrange-session state
   into its own zustand slice. **Not** strictly behavior-preserving: the recorded
   selection warts get fixed (see Behavior changes).

## Current state (the problem)

`src/app/store.ts` (2,256 lines) holds five selection-ish fields:

| Field | Reality |
|---|---|
| `selectedObjectIds: string[]` | The canonical canvas selection (placement ids). |
| `selectedArtworkId: string \| null` | *Library* artwork id. Written directly by ChecklistPanel via `selectArtwork`, and mirrored from a single artwork placement by `legacySelectionSlots`. |
| `selectedOpeningId: string \| null` | Opening *placement* id; mirrored by `legacySelectionSlots`, or written directly by `selectOpening`. |
| `selectedRoomId: string \| null` | Truly exclusive room focus. |
| `selectedWallId: string \| null` | Not a selection: persistent sidebar context that survives artwork/opening selection; only `selectRoom`/full clears drop it. |

Plus `arrangeSession` (transient, non-undoable) with 7 actions, settle/auto-accept
logic woven through selection actions, and `lastArrangeMode`/`lastInsetAnchor`/
`lastEvenZone` idle defaults.

Known wart (recorded in 2d-zoom-pan M4 + final review): a checklist selection
(`selectArtwork`) writes only `selectedArtworkId`, so Fit-selected stays disabled
while the object shows highlighted — features disagree about what is selected.

Usage: ~260 non-test references to the five slots across 10 files
(App.tsx, PlanView, ElevationView, ChecklistPanel, RoomsPanel, RoomResizeHandles,
ThreeDView, WallPanel, SceneRooms, useArrangeNudgeShortcuts, arrangeReadout).

## Target model

New file `src/app/store/selectionSlice.ts`:

```ts
export type Selection =
  | { kind: "none" }
  | { kind: "objects"; ids: string[] }            // placement ids, length >= 1
  | { kind: "libraryArtwork"; artworkId: string } // checklist pick with no placement
  | { kind: "room"; roomId: string };

// state
selection: Selection;
wallContextId: string | null; // was selectedWallId — sidebar context, not a selection
```

Semantics:

- `wallContextId` keeps `selectedWallId`'s exact life: persists across object
  selection, cleared by room selection and full clears, falls back to first wall
  via `getSelectedWall`.
- Canvas selection (`selectObject` / `setObjectSelection`) → `{kind:"objects"}`.
  Empty ids normalize to `{kind:"none"}`; the slice exports one `selectObjects(ids)`
  normalizer so `{kind:"objects", ids:[]}` is unrepresentable.
- **Checklist artwork click** resolves against the live project:
  placed → `{kind:"objects", ids:[firstPlacementId]}` (same first-placement
  resolution the Delete handler uses today); unplaced →
  `{kind:"libraryArtwork", artworkId}` (inspector-only). This is the wart fix:
  Fit-selected, arrange, delete, and highlight all read the same selection.
- `selectOpening` → `{kind:"objects", ids:[openingPlacementId]}`. Openings are
  placements; the separate slot dies. The opening inspector derives from the single
  selected placement's kind.
- The four legacy fields are deleted as stored state. During migration they live on
  as derived selectors with the same names (the `legacySelectionSlots` logic becomes
  a pure derive: single artwork placement → its library id; single opening
  placement → its id). At the end, consumers read `selection` directly and the
  bridges are removed.
- Every selection transition still auto-settles a live arrange session, exactly as
  today (the settle table is unchanged).

## Arrange slice

New file `src/app/store/arrangeSlice.ts`: `ArrangeSession` type,
`beginArrangeSession`, `setArrangeAnchor`, `setArrangeEvenZone`,
`updateArrangeSession`, `setArrangeSessionPreview`, `acceptArrangeSession`,
`cancelArrangeSession`, the settle/auto-accept helpers, and
`lastArrangeMode` / `lastInsetAnchor` / `lastEvenZone`.

`store.ts` composes both slices via the standard zustand slices pattern
(`StateCreator<AppState, [], [], SliceState>`); project/undo/library/persistence
code stays in `store.ts` untouched — restructuring it is explicitly out of scope.

Cross-slice seams (why these extract together): selection changes auto-accept a
live arrange session, and arrange accept writes an undo entry via the project half.
Slices compose into one store, so the arrange slice's settle helper is invoked from
selection actions through `get()` — no event bus, no circular imports. The existing
settle-table comment moves to `arrangeSlice.ts` as its contract.

## Behavior changes (all deliberate, all disclosed)

1. **Wart fix:** checklist-selecting a *placed* artwork now selects its (first)
   placement — Fit-selected enables, arrange/nudge work, highlight and inspector
   agree.
2. Consequence of (1): Escape now clears a checklist selection of a placed artwork
   (it's an object selection), and Delete uses the normal placement path — the
   special `selectedArtworkId` resolution branch in App.tsx's Delete handler is
   removed. Unplaced checklist selections keep today's behavior (inspector only,
   Delete ignores); Escape clears them, matching "Escape clears selection".
3. Same fix applies to openings: `selectOpening` now lands in `{kind:"objects"}`,
   so a selected door/window/blocked-zone enables Fit-selected and clears on
   Escape (previously the legacy slot left Fit-selected disabled and Escape
   ignored it). Delete already worked via `selectedOpeningId`; it keeps working
   via the normal placement path.
4. Everything else is behavior-preserving, including undo semantics: selection is
   view state, never on the undo stack; arrange accept still produces one
   "Arrange on wall" entry.

## Migration order (each step lands green)

1. **Follow-ups** (independent, parallelizable):
   a. Chunk-graph assertion: post-build script over `dist/` that parses eager
      chunks' static imports and fails if any eager chunk statically imports the
      `three` chunk. Wire into `npm run build` (or `postbuild`).
   b. Wheel-math unit tests for `useSvgViewportGestures` (zoom-at-pointer,
      wheel/shift-wheel pan mapping, clamp interaction).
   c. `planSnapTargets.ts` local `clamp` → shared `clamp` from
      `domain/geometry/scalar.ts`.
2. **Extract arrange slice verbatim** — pure move, store shape identical.
3. **Introduce `selection` union + bridges** — union becomes source of truth
   inside the store; legacy four fields become derived selectors with the same
   names so all 10 consumer files keep compiling unchanged; `legacySelectionSlots`
   mirroring deleted; wart fix lands here.
4. **Migrate consumers** to read `selection` / `wallContextId` directly — grouped
   into a few review-sized tasks (e.g. App.tsx; 2D views; 3D + panels + hooks).
5. **Delete the bridges** — type system proves nothing still reads them; migrate
   remaining `store.test.ts` assertions off legacy fields in this same step.

## Error handling / invariants

- Stale-id hygiene unchanged: selection actions validate ids against the live
  project (`selectObject`'s dead-id no-op stays a no-op); foreign edits / undo /
  redo prune `selection.ids` the same way `selectedObjectIds` is pruned today.
- `boot` / project load resets selection to `{kind:"none"}` + first-wall context,
  matching the current reset block.
- A dangling `libraryArtwork` selection (library record deleted underneath) renders
  nothing, same as today's dangling `selectedArtworkId`.

## Testing

- Existing 733 tests are the safety net. `store.test.ts` assertions on legacy
  fields migrate in step 5 (bridge deletion), not before — they lock behavior while
  consumers move.
- New unit tests:
  - Selection-slice transition table: each action × each prior state → expected
    union value + wall context.
  - Arrange-slice settle matrix: selection change / view change / undo / foreign
    edit → accept vs cancel vs survive.
  - Checklist resolution: placed → objects, unplaced → libraryArtwork,
    dangling id → no-op.
  - Wheel-math tests (follow-up 1b).
- Chunk-graph assertion runs on every build.
- Browser verification (main session, real clicks) after consumer migration:
  checklist click enables Fit-selected (headline check), canvas multi-select +
  arrange session + Escape/Delete, room handles, 3D checklist→highlight flight,
  elevation selection.

## Process

Feature branch off main. Subagent-driven development per user workflow:
implementer subagents per task (sonnet/opus/haiku as fits), code review after each
task, browser verification from the main session. `git add` explicit paths only;
expect foreign commits from concurrent sessions in the same checkout.
