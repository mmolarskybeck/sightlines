# Shared openings — Stages 6–8 handoff

Continuation doc for the "One physical opening, two faces" work. Full original plan:
`~/.claude/plans/structured-launching-stardust.md` (Stages 1–8, settled decisions, the
five architecture rules). **Read that plan's "Settled decisions" and "Architecture" sections
before starting** — this doc covers what is left and what has changed since it was written,
not the reasoning behind the design.

## State as of 2026-08-06

Branch `feat/shared-opening-invariant`, at commit `688628c`. Tree clean.

**Stages 1–5 are shipped and reviewer-signed-off.** Gate at time of writing:
178 test files / 2540 Vitest tests · `tsc` clean · 29 Playwright tests · no binary diffs.

| Stage | State |
|---|---|
| 1 Wall-level boundary analysis | shipped |
| 2 Deterministic analyzer | shipped |
| 2b Overlap policy | shipped |
| 3 Atomic direct opening edits | shipped |
| 4 Scoped reconciliation hooks | shipped |
| 5 Load repair + persistent conflicts | shipped |
| **6 Resolver** | **next** |
| **7 Inspector** | **next** |
| **8 Regression coverage + docs** | **next** |

### Why Stages 6–7 are not optional

Stage 3 was the first user-visible change: it began **refusing edits that previously
succeeded**. The plan's shipping boundary says Stages 3–7 ship together, because a refusal
with no resolver behind it is a dead end. Stage 5 made problems *visible* but not *fixable* —
a curator currently sees "This door appears on the Gallery 1 side of the wall but not on the
Gallery 2 side" with no way to act. **Do not release before Stage 7.**

### What Stage 5 shipped, in files

- `src/domain/placement/sharedOpeningAnalysis.ts` — `analyzeSharedOpenings`, `applySharedOpeningActions`,
  `SharedOpeningAction` (`adopt` | `create-twin` | `realign`), `SharedOpeningConflict`,
  the nine-value `SharedOpeningConflictReason` union.
- `src/domain/placement/sharedOpeningLoadRepair.ts` — link-only load pass. Applies `adopt`
  and `realign`; **never** `create-twin` on open. Returns `realignedIds` so the caller can
  validate what it moved.
- `src/domain/placement/sharedOpeningIssues.ts` — `selectSharedOpeningConflicts(project)`:
  analyzer conflicts **plus** every declined `create-twin` mapped to `missing-twin`.
- `src/domain/placement/openingPairs.ts` — `isStructurallyValidPair`, `normalizeOpeningPairs`.
- `src/app/store.ts` — `setDocument` (repair choke point + placement validation),
  `openLoadedDocument` (snapshot-then-persist ordering + lost-update guard),
  `reconcileGeometryEdit`, `reconcileSharedOpenings`.
- `src/app/components/placement/sharedOpeningIssueCopy.ts` — the nine reasons as curator
  sentences. **Presentation layer, deliberately not in `src/domain/`.**
- `src/app/components/placement/PlacementWarnings.tsx` — second, neutral-toned group for
  standing document issues, distinct from transient placement warnings.

---

## Stage 6 — Resolver

New store actions. **Scoping is enforced in the store, not the UI.**

| Action | Guard |
|---|---|
| `resolveSharedOpening(openingId, target: SharedOpeningTarget)` — replaces `connectOpenings` | Recompute the analysis and require `target` ∈ that conflict's `candidates`. `{kind:"opening"}` adopts; `{kind:"wall"}` creates the twin there — that is what makes an ambiguous boundary between two **empty** walls resolvable at all. Same kind, neither currently paired. Keep the existing error message strings verbatim so the current tests survive the rename. |
| `completeSharedOpening(openingId)` | Applies the `missing-twin` repair — the `create-twin` the load pass declined. Currently referenced only in a comment in `sharedOpeningIssues.ts`; not implemented. |
| `realignSharedOpening(openingId)` | **The selected half is authoritative** — mirror it onto the partner. If the partner's slot is blocked, **refuse and name the blocker**. Moving both to a nearest mutual span is out of scope for v1. This is also the only resolution for `paired-geometry-mismatch`: the analyzer deliberately picks no authoritative half for a width/height/y mismatch because there is no geometric basis for choosing — the user's selection supplies it. |
| `splitSharedOpening(openingId)` — replaces `disconnectOpening` | Only when `!areSharedBoundaryWalls`. Refusal copy: "These are two faces of one opening. Move the rooms apart, or delete it." |
| `keepThisOpeningOnly(openingId)` | Deletes the partner, clears the pointer, one undo step. Offered only on `boundary-lost`. |

**Building blocks that already exist:** `SharedOpeningTarget`, `areSharedBoundaryWalls`,
`applySharedOpeningActions`. `resolveSharedOpening` and `completeSharedOpening` do not.

### Test anchors — line numbers have drifted from the original plan

The plan cites pre-Stage-5 line numbers. Current locations in `src/app/store.test.ts`:

| Plan reference | Current | Action |
|---|---|---|
| `:3209` | **3877** `describe("opening connections")` | rewrite against the new actions |
| `:3222` | **3878** "connects and disconnects a same-kind pair…" | label becomes `"Resolve shared door"` |
| `:3337` | **4118** "atomically clears displaced partners when re-pairing" | **delete**, replace with "refuses to re-pair an already-paired opening" |
| `:3355` | **4136** "rejects cross-kind and blocked-zone connections…" | must survive the rename — keep its error strings verbatim |

The `wall-north` / `wall-south` fixture in that block is a **non-boundary** pair, so it
exercises the legacy path: the resolver rejects it at the candidate guard, and the test
becomes "a legacy pair can be split, undo restores it".

### The compile-error constraint — plan for it up front

`sharedOpeningIssueCopy.ts` uses a `const exhaustive: never = conflict.reason` default, and
its test fixture table is `Record<SharedOpeningConflictReason, Project>`. **Any new conflict
reason Stage 6 adds is a typecheck failure until its copy and fixture exist.** That is the
intended behaviour — it stops a new reason silently rendering a generic string — but it means
copy must be written in the same pass, not after. Put it in the brief.

---

## Stage 7 — Inspector

Pure `src/domain/geometry/sharedOpeningStatus.ts` returning a discriminated union, so
`App.tsx` stays thin and every state is unit-testable without a DOM.

| State | UI |
|---|---|
| `exposed` | **Nothing.** Today's "No door on a facing wall to pair with." is mechanism talk and goes. |
| `shared` | One quiet static line: `Connects Gallery 1 ↔ Gallery 2`. Reuses `.opening-connection-status`. No dropdown, no Disconnect. |
| `drifted` (live boundary) | Caution notice + **Realign** only. Split is refused here by design. |
| `boundary-lost` | Caution notice + **Keep both as separate doors** and **Keep this door only**. |
| `missing-twin` | Caution notice + **Complete shared opening**. |
| `ambiguous` | Caution notice + scoped Select captioned **Resolve shared opening**, fed from `candidates` (openings *and* empty walls). |
| `overhangs-common-span` / `paired-overhang` | Caution notice: the wall is shared, but the opening runs past where the two rooms actually meet. |
| `blocked` / `counterpart-occupied` | Caution notice naming the obstruction. No picker. |

**Deletions:** `openingConnectionCandidates` (now `App.tsx:1014`, passed at `:2310`) and the
`connectionCandidates` / `onConnect` Select. `alignmentLabel`
(`OpeningInspector.tsx:32`) survives for the drifted / boundary-lost notices;
`shortAlignmentLabel` (`:49`, used at `:322`) loses its caller.

### Carried-over defect Stage 7 must fix

Two problem doors on one wall currently produce **identical issue rows** ("Door in Gallery 1",
same message), and the rail's click only ever selects the first. We deliberately did **not**
patch this with positional copy — a wall-local measurement adds orientation and unit semantics
while still leaving the second row unactionable. The real fix belongs here: **every row selects
its own opening, shows selected state, and carries a stable differentiator for repeated
accessible names.** This is a clean deferral only if Stage 7 lands before release.

**Supersedes** the earlier connection-section redesign (stacked Select, aligned/misaligned
split). The geometry-field work from that pass is unaffected and stays: `Width`/`Height`
leading, `From wall start` / `From wall end`, `Center height`, the unified fit note, the
`h-8` select-height fix.

---

## Stage 8 — Regression coverage and docs

**Playwright** (per `AGENTS.md`): new `e2e/shared-openings.spec.ts` importing
`e2e/fixtures.ts`, run with `npm run test:e2e`. `driver.mjs` is for ad-hoc screenshots only.

1. Two abutting rooms, door on the shared wall → both halves; inspector reads
   `Connects Gallery 1 ↔ Gallery 2`; no dropdown.
2. Drag one half in plan → twin follows. Drag past the common span → refused, both unmoved.
3. Drag a room apart → pair survives, `boundary-lost`, both resolution actions work.
4. Drag two exposed aligned doors together → **one user-facing Undo reverses both the room
   move and the reconciliation.** That single-Undo behaviour is the user-visible contract;
   keep raw `undoStack` length assertions in Vitest.
5. Open a legacy one-sided door on an empty shared wall → `missing-twin` in the issues rail,
   **Complete shared opening** repairs it.
6. Save reaches "saved" — the desync class this replaces surfaced only at save time, as a raw
   `ZodError` banner.

**Vitest** keeps domain logic: Stages 1–2 characterization suites, `sharedOpeningStatus`, the
re-asserted store tests above, and 3D (`scene3d.test.ts:638` must still pass).

**Docs:** `docs/status.md` and `docs/plan.md` both still describe pairing as user-managed with
advisory geometry, which this architecture makes factually wrong. Update both. Leave
`docs/archive/room-shapes-spec.md` alone — it is archived.

---

## How to work this (learned over five review rounds)

### Review needs three independent forms of evidence

Any one can be green while the shipped result is broken. Both of these got past a fully green
suite in this work:

1. **Automated tests** for contracts.
2. **Real browser boot and interaction** for React lifecycle. A `useMemo` placed below
   `if (!project) return` in `App.tsx` passed 2540 tests *and* `tsc` while crashing every
   boot with "Rendered more hooks than during the previous render".
3. **Byte / file-type / textual-diff checks** for source integrity. A grouping-key delimiter
   was silently converted from the textual `\u0000` escape into a literal `0x00` byte, making
   the file binary to git. **`od -c` cannot detect this** — it renders both identically as
   `\0`. Use `file` (`data` vs `UTF-8 text`), `git diff --stat` (shows `Bin`), or a byte count.

### Verifying tests, not just running them

Break the fix, confirm the test fails, restore. Two tests in this work passed **vacuously**
until strengthened — most notably a snapshot-ordering test asserting "one snapshot exists",
which the bug satisfied by depositing a snapshot of the *repaired* document while the original
was gone. The fix was asserting the landed copy is the **pre-repair** original.

### Delegating

- Split by **file ownership with no shared files and no cross-dependency**. Sequence instead
  of parallelising whenever two tasks touch the same function or the same test file.
- Keep the integration seam (e.g. `App.tsx` wiring) in the main session, where verification is.
- **Forbid `git stash`, `git checkout`, and repo-wide resets in every brief.** An agent ran
  `git stash` here and nearly destroyed concurrent uncommitted work; the checkout is shared
  with parallel sessions.
- Re-verify teeth claims independently rather than accepting the report.

### Conventions that bit us

- A **copy layer belongs in `src/app/`, not `src/domain/`.** Putting it in domain forced the
  repo's first `domain → app` import. Check with
  `grep -rn 'from "../../app/' src/domain/` — should be empty.
- **User-facing copy says "project", never "document".** "Document" is internal vocabulary
  (`setDocument`, document swap); a curator reads it as a file.
- Perf: analysis is once per **committed** edit (room drags commit on release, not per frame).
  Measured 7.8 ms for the load repair and 0.9 ms for the conflicts selector on a
  10-room / 200-work project. Re-confirm against that benchmark if the scope of analysis grows.

### Working agreement

Leave each reviewed chunk **uncommitted** and report it for manual review before moving on
(`AGENTS.md`).
