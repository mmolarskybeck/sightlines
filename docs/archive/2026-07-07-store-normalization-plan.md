# Store Normalization & Duplicate Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the three filed follow-ups, collapse the store's five selection slots into one discriminated union with the arrange session extracted to its own slice, and add duplicate prevention (placement uniqueness + upload sha256 confirm).

**Architecture:** `src/app/store.ts` (zustand, 2,256 lines) keeps project/undo/library/persistence; two new slice files (`src/app/store/arrangeSlice.ts`, `src/app/store/selectionSlice.ts`) compose into it. Selection migrates via bridge fields: the union becomes the internal source of truth first (legacy fields become mirrors written by ONE function), consumers migrate file-by-file, then the mirrors are deleted. Duplicate prevention lands last, on the normalized store.

**Tech Stack:** React 18 + TypeScript strict, zustand 5, vitest (jsdom), Vite 6 build.

**Spec:** `docs/superpowers/specs/2026-07-07-store-selection-normalization-design.md` — read it before starting any task.

## Global Constraints

- Baseline: main @ commit `1df9727`, 733/733 vitest, `npm run build` clean. Every task ends with `npm test` and `npm run check` passing.
- Work on a feature branch (`refactor/store-normalization`) off main. `git add` **explicit paths only** — the user runs concurrent sessions in this checkout; never `git add -A`/`-u`. Unrelated working-tree changes may appear: leave them alone.
- Verbatim-move tasks (Task 4) MOVE code — cut/paste including comments, do not retype or "improve" while moving.
- Selection is view state: never on the undo stack, never persisted. Arrange accept produces exactly one "Arrange on wall" undo entry. Do not change undo semantics anywhere.
- No new dependencies.
- Behavior changes are ONLY those listed in the spec's "Behavior changes" section; anything else observable must stay identical.

---

### Task 1: Chunk-graph build assertion

The kiss-dry-sweep follow-up: assert at build time that no eagerly-loaded chunk statically imports the `three` chunk (the 3D stack must stay behind the lazy `ThreeDView` import). Regression vector: any future shared virtual module (like Vite's preload helper, the original culprit) can silently re-create a static `index → three` edge.

**Files:**
- Create: `scripts/assert-chunk-graph.mjs`
- Modify: `package.json` (build script)

**Interfaces:**
- Produces: `node scripts/assert-chunk-graph.mjs` exits 0 when the entry's static-import closure excludes `three-*.js`, 1 otherwise. Runs as part of `npm run build`.

- [ ] **Step 1: Write the script**

```js
// scripts/assert-chunk-graph.mjs
//
// Build invariant: the eager chunk graph must never reach the three chunk.
// The 3D stack (three.js + react-three fiber/drei) is reachable only through
// the lazy ThreeDView import; a static edge from any eagerly-loaded chunk
// (entry or its static-import closure) would put ~1MB of three.js on the
// critical path. This regressed once via Vite's preload helper being placed
// in the three chunk — see vite.config.ts manualChunks.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");

const html = readFileSync(path.join(dist, "index.html"), "utf8");
const entryMatch = html.match(/src="\/(assets\/index-[^"]+\.js)"/);
if (!entryMatch) {
  console.error("assert-chunk-graph: no entry <script> found in dist/index.html — build layout changed; update this script.");
  process.exit(1);
}

// Self-check: if chunk naming ever changes, fail loudly instead of silently
// asserting nothing.
const threeChunks = readdirSync(path.join(dist, "assets")).filter((file) => /^three-.*\.js$/.test(file));
if (threeChunks.length === 0) {
  console.error("assert-chunk-graph: no three-*.js chunk in dist/assets — chunk naming changed; update this script.");
  process.exit(1);
}

// Static import specifiers of a built chunk. Dynamic `import(...)` is masked
// out first so only static `import ... from "..."`, bare `import "..."`, and
// `export ... from "..."` edges remain.
function staticImports(file) {
  const source = readFileSync(path.join(dist, file), "utf8").replaceAll("import(", "__dynamic_import__(");
  const deps = new Set();
  for (const match of source.matchAll(/(?:import|from)\s*["']([^"']+)["']/g)) {
    deps.add(match[1]);
  }
  return [...deps]
    .filter((spec) => (spec.startsWith("./") || spec.startsWith("/assets/")) && spec.endsWith(".js"))
    .map((spec) => (spec.startsWith("./") ? path.posix.join("assets", spec.slice(2)) : spec.slice(1)));
}

const eager = new Set();
const queue = [entryMatch[1]];
while (queue.length > 0) {
  const file = queue.pop();
  if (eager.has(file)) continue;
  eager.add(file);
  queue.push(...staticImports(file));
}

const offenders = [...eager].filter((file) => /(^|\/)three-[^/]*\.js$/.test(file));
if (offenders.length > 0) {
  console.error(
    `assert-chunk-graph: FAIL — the eager chunk graph statically reaches the three chunk: ${offenders.join(", ")}\n` +
      "The 3D stack must load only via the lazy ThreeDView import. See vite.config.ts manualChunks."
  );
  process.exit(1);
}

console.log(`assert-chunk-graph: OK — entry closure (${eager.size} js file${eager.size === 1 ? "" : "s"}) does not reach three-*.js`);
```

- [ ] **Step 2: Wire into the build**

In `package.json`, change:

```json
"build": "tsc && vite build",
```

to:

```json
"build": "tsc && vite build && node scripts/assert-chunk-graph.mjs",
```

- [ ] **Step 3: Verify the pass case**

Run: `npm run build`
Expected: build succeeds and the last line is `assert-chunk-graph: OK — entry closure (N js files) does not reach three-*.js` (N is small — 2-3: index + vendor).

- [ ] **Step 4: Verify the fail case (temporarily sabotage, then revert)**

In `vite.config.ts`, temporarily delete the line `if (id.includes("vite/preload-helper")) return "vendor";`, run `npm run build`.
Expected: EITHER the script fails with `assert-chunk-graph: FAIL — ...` and exit code 1, OR it passes because current Rollup happens to place the helper eagerly anyway. If it passes, sabotage harder: change `return "three"` chunk regex line to also match `node_modules/zustand/` (forces a really-eager lib into the three chunk) and re-run — must FAIL.
**Revert the sabotage completely** (`git diff vite.config.ts` must be empty), re-run `npm run build`, expect OK.

- [ ] **Step 5: Commit**

```bash
git add scripts/assert-chunk-graph.mjs package.json
git commit -m "build: assert eager chunk graph never reaches the three chunk"
```

---

### Task 2: Wheel-handler math unit tests

The B1 follow-up: `useSvgViewportGestures`'s wheel handler (zoom/pan/normalization math) has no unit tests since the per-view copies were deleted. Test the math through the real native `wheel` listener.

**Files:**
- Modify: `src/app/hooks/useSvgViewportGestures.test.tsx` (add a `describe` block; reuse the existing `renderGestures` harness in that file)

**Interfaces:**
- Consumes: existing harness `renderGestures(opts)` returning `{ api, svg }`-style holder (read the file top — the harness renders a real `<svg>` with the hook wired), and the real viewport helpers `panBy`, `zoomAtPoint`, `WHEEL_ZOOM_SENSITIVITY` from `src/domain/viewport/viewport2d.ts`.

Facts the tests rely on (from `useSvgViewportGestures.ts:200-223`):
- Handler is registered as a native non-passive `wheel` listener on the svg.
- `norm(d) = e.deltaMode === 1 ? d * 16 : d`.
- ctrl/meta wheel → `zoomAtPoint(viewport, point, factor, bounds, size, limits)` with `factor = min(2, max(0.5, exp(-norm(deltaY) * WHEEL_ZOOM_SENSITIVITY)))`, anchored at `toSvgPoint(clientX, clientY)` — which needs `getScreenCTM`/`createSVGPoint`, absent in jsdom, so the zoom tests stub them.
- plain wheel → `panBy(viewport, { x: norm(deltaX), y: norm(deltaY) }, bounds, size)`.
- shift wheel with `deltaX === 0` → `panBy(viewport, { x: norm(deltaY), y: 0 }, ...)`.

- [ ] **Step 1: Write the failing tests**

Add to `useSvgViewportGestures.test.tsx` (adapt harness call names to the file's actual ones — read it first):

```tsx
describe("wheel handler math", () => {
  function dispatchWheel(svg: SVGSVGElement, props: WheelEventInit) {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...props });
    act(() => {
      svg.dispatchEvent(event);
    });
    return event;
  }

  // jsdom implements neither getScreenCTM nor createSVGPoint (toSvgPoint
  // returns null without them, which bails the zoom branch) — stub the
  // minimal identity-CTM surface the handler reads.
  function stubIdentityCtm(svg: SVGSVGElement) {
    const identity = { inverse: () => identity } as unknown as DOMMatrix;
    (svg as unknown as { getScreenCTM: () => DOMMatrix }).getScreenCTM = () => identity;
    (svg as unknown as { createSVGPoint: () => unknown }).createSVGPoint = () => ({
      x: 0,
      y: 0,
      matrixTransform(this: { x: number; y: number }) {
        return { x: this.x, y: this.y };
      }
    });
  }

  it("plain wheel pans by the raw pixel deltas", () => {
    const onViewportChange = vi.fn();
    const { svg } = renderGestures({ viewport: FIT_VIEWPORT, onViewportChange });
    dispatchWheel(svg!, { deltaX: 30, deltaY: 50 });
    expect(onViewportChange).toHaveBeenCalledWith(
      panBy(FIT_VIEWPORT, { x: 30, y: 50 }, DEFAULT_BOUNDS, DEFAULT_SIZE)
    );
  });

  it("shift+wheel with deltaX 0 pans horizontally by deltaY (Windows shift-scroll)", () => {
    const onViewportChange = vi.fn();
    const { svg } = renderGestures({ viewport: FIT_VIEWPORT, onViewportChange });
    dispatchWheel(svg!, { shiftKey: true, deltaX: 0, deltaY: 40 });
    expect(onViewportChange).toHaveBeenCalledWith(
      panBy(FIT_VIEWPORT, { x: 40, y: 0 }, DEFAULT_BOUNDS, DEFAULT_SIZE)
    );
  });

  it("shift+wheel with a real deltaX keeps both axes (macOS already flips)", () => {
    const onViewportChange = vi.fn();
    const { svg } = renderGestures({ viewport: FIT_VIEWPORT, onViewportChange });
    dispatchWheel(svg!, { shiftKey: true, deltaX: 25, deltaY: 5 });
    expect(onViewportChange).toHaveBeenCalledWith(
      panBy(FIT_VIEWPORT, { x: 25, y: 5 }, DEFAULT_BOUNDS, DEFAULT_SIZE)
    );
  });

  it("line-mode deltas (deltaMode 1) scale by 16 to comparable pixels", () => {
    const onViewportChange = vi.fn();
    const { svg } = renderGestures({ viewport: FIT_VIEWPORT, onViewportChange });
    dispatchWheel(svg!, { deltaY: 3, deltaMode: 1 });
    expect(onViewportChange).toHaveBeenCalledWith(
      panBy(FIT_VIEWPORT, { x: 0, y: 48 }, DEFAULT_BOUNDS, DEFAULT_SIZE)
    );
  });

  it("ctrl+wheel zooms at the pointer with factor exp(-deltaY * sensitivity)", () => {
    const onViewportChange = vi.fn();
    const { svg } = renderGestures({ viewport: FIT_VIEWPORT, onViewportChange });
    stubIdentityCtm(svg!);
    dispatchWheel(svg!, { ctrlKey: true, clientX: 100, clientY: 80, deltaY: 50 });
    const factor = Math.exp(-50 * WHEEL_ZOOM_SENSITIVITY);
    expect(onViewportChange).toHaveBeenCalledWith(
      zoomAtPoint(FIT_VIEWPORT, { xMm: 100, yMm: 80 }, factor, DEFAULT_BOUNDS, DEFAULT_SIZE, PLAN_ZOOM_LIMITS)
    );
  });

  it("per-event zoom factor clamps to [0.5, 2]", () => {
    const onViewportChange = vi.fn();
    const { svg } = renderGestures({ viewport: FIT_VIEWPORT, onViewportChange });
    stubIdentityCtm(svg!);
    dispatchWheel(svg!, { ctrlKey: true, clientX: 0, clientY: 0, deltaY: -500 }); // exp(5) → clamps to 2
    dispatchWheel(svg!, { ctrlKey: true, clientX: 0, clientY: 0, deltaY: 500 }); // exp(-5) → clamps to 0.5
    expect(onViewportChange).toHaveBeenNthCalledWith(
      1,
      zoomAtPoint(FIT_VIEWPORT, { xMm: 0, yMm: 0 }, 2, DEFAULT_BOUNDS, DEFAULT_SIZE, PLAN_ZOOM_LIMITS)
    );
    expect(onViewportChange).toHaveBeenNthCalledWith(
      2,
      zoomAtPoint(FIT_VIEWPORT, { xMm: 0, yMm: 0 }, 0.5, DEFAULT_BOUNDS, DEFAULT_SIZE, PLAN_ZOOM_LIMITS)
    );
  });

  it("ctrl+wheel without a CTM (jsdom default) is a no-op, not a crash", () => {
    const onViewportChange = vi.fn();
    const { svg } = renderGestures({ viewport: FIT_VIEWPORT, onViewportChange });
    dispatchWheel(svg!, { ctrlKey: true, deltaY: 50 });
    expect(onViewportChange).not.toHaveBeenCalled();
  });

  it("wheel events are preventDefault-ed (non-passive listener)", () => {
    const { svg } = renderGestures({ viewport: FIT_VIEWPORT });
    const event = dispatchWheel(svg!, { deltaY: 10 });
    expect(event.defaultPrevented).toBe(true);
  });
});
```

Extend the file's viewport2d import with `panBy`, `zoomAtPoint`, `WHEEL_ZOOM_SENSITIVITY` as needed. If `WheelEvent` is missing in the jsdom version, fall back to the file's existing `pointerEvent`-style synthesis (`new Event("wheel", ...)` + `Object.assign`), in which case drop the `defaultPrevented` assertion only if it cannot be expressed.

- [ ] **Step 2: Run to verify current behavior**

Run: `npx vitest run src/app/hooks/useSvgViewportGestures.test.tsx`
Expected: the new tests PASS immediately (they characterize existing shipped math — this is characterization testing, not TDD of new behavior). If any FAIL, do not "fix" the hook: read the failure, correct the test's expectation only if you misread the handler, and flag anything that looks like a genuine bug in your report instead of changing shipped behavior.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all tests pass (733 + new).

- [ ] **Step 4: Commit**

```bash
git add src/app/hooks/useSvgViewportGestures.test.tsx
git commit -m "test: characterize wheel-handler zoom/pan math in useSvgViewportGestures"
```

---

### Task 3: Deduplicate clamp in planSnapTargets

The C1 follow-up: `src/domain/snapping/planSnapTargets.ts` carries the last local `clamp` copy (~line 227); the shared one lives in `src/domain/geometry/scalar.ts`.

**Files:**
- Modify: `src/domain/snapping/planSnapTargets.ts`

- [ ] **Step 1: Replace the local clamp**

Delete the local function:

```ts
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
```

Add to the imports at the top:

```ts
import { clamp } from "../geometry/scalar";
```

(Verify signature parity first: `src/domain/geometry/scalar.ts:5` is `clamp(value, min, max)` with identical argument order — it is.)

- [ ] **Step 2: Verify**

Run: `npm run check && npx vitest run src/domain/snapping/planSnapTargets.test.ts`
Expected: tsc clean, tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/domain/snapping/planSnapTargets.ts
git commit -m "refactor(domain): use shared clamp in planSnapTargets"
```

---

### Task 4: Extract the arrange slice (verbatim move)

Pure move, zero behavior change: the arrange-session state, its seven actions, and the settle helpers relocate from `store.ts` into `src/app/store/arrangeSlice.ts`. The store's shape (`AppState`) is unchanged; store tests must pass untouched.

**Files:**
- Create: `src/app/store/arrangeSlice.ts`
- Create: `src/app/projectWalls.ts` (re-home 3 wall utils so the slice avoids a value-level circular import)
- Modify: `src/app/store.ts`

**Interfaces:**
- Consumes (injected from store.ts, unchanged): `commitWallObjectMoves(moves, label, allowOverlap, extras)`, `persist(project)`.
- Produces:
  - `src/app/projectWalls.ts`: `getProjectWalls(project)`, `getSelectedWall(project, selectedWallId)`, `getFirstWall(project)` — moved verbatim from store.ts bottom; `store.ts` re-exports `getProjectWalls` and `getSelectedWall` so existing importers keep working.
  - `src/app/store/arrangeSlice.ts`:

```ts
export type ArrangeSession = { /* moved verbatim from store.ts:62-94, comments included */ };

export type ArrangeSliceState = {
  arrangeSession: ArrangeSession | null;
  lastArrangeMode: ArrangeSession["mode"];
  lastInsetAnchor: ArrangeSession["insetAnchor"];
  lastEvenZone: ArrangeSession["evenZone"] | null;
};

export type ArrangeSliceActions = {
  beginArrangeSession: (mode: ArrangeSession["mode"]) => void;
  setArrangeAnchor: (anchor: ArrangeSession["insetAnchor"]) => void;
  setArrangeEvenZone: (zone: ArrangeSession["evenZone"]) => void;
  updateArrangeSession: (params: /* copy exact param type from store.ts:267-272 */) => void;
  setArrangeSessionPreview: (moves: { id: string; xMm: number; yMm: number }[]) => void;
  commitArrangeSession: (allowOverlap?: boolean) => void;
  cancelArrangeSession: () => void;
};

export type ArrangeSliceInternals = {
  commitWallObjectMoves: (
    moves: { id: string; xMm: number; yMm: number }[],
    label: string | ((movedCount: number) => string),
    allowOverlap: boolean,
    extras?: Record<string, unknown>
  ) => { status: "committed"; project: Project } | { status: "no-op" } | { status: "blocked" };
  persist: (project: Project) => Promise<void>;
};

export const ARRANGE_SLICE_INITIAL: ArrangeSliceState = {
  arrangeSession: null,
  lastArrangeMode: "inset",
  lastInsetAnchor: "both",
  lastEvenZone: null
};

export function createArrangeSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: ArrangeSliceInternals
): {
  actions: ArrangeSliceActions;
  settleArrangeSession: (outcome: "accept" | "cancel", allowOverlap?: boolean) => "committed" | "cleared" | "blocked";
  autoAcceptArrangeSession: () => void;
};
```

  Import `type { AppState }` from `"../store"` (type-only — circular-safe; export `AppState` from store.ts if it isn't already).

- [ ] **Step 1: Move the wall utils**

Create `src/app/projectWalls.ts`; MOVE `getProjectWalls`, `getSelectedWall`, `getFirstWall` (store.ts:2243-2256 region) verbatim with their imports (`getWallsWithGeometry`, types). In `store.ts`: delete the moved code, add

```ts
import { getFirstWall, getProjectWalls } from "./projectWalls";
export { getProjectWalls, getSelectedWall } from "./projectWalls";
```

Run `npm run check` — must be clean before continuing.

- [ ] **Step 2: Move the arrange code**

Create `src/app/store/arrangeSlice.ts` with the shape above. MOVE verbatim from store.ts (locate by name, not line number):
- The `ArrangeSession` type + its comment block (store.ts:62-94).
- `settleArrangeSession` and `autoAcceptArrangeSession` (store.ts:458-537) — these become closures inside `createArrangeSlice`, reading via `get()` and `internals.commitWallObjectMoves` / `internals.persist`.
- The seven actions `beginArrangeSession`, `setArrangeAnchor`, `setArrangeEvenZone`, `updateArrangeSession`, `setArrangeSessionPreview`, `commitArrangeSession`, `cancelArrangeSession` (store.ts ~1909-2131) — into the returned `actions` object.
- `sameIdSet` (used only by `beginArrangeSession`) and the settle-table comment.
- The domain imports those bodies use (`arrangeOnWall`, `solveEqualArrangement`, `getOpenSpaceBounds`, `insetForGap`, etc. — let tsc tell you the exact list) plus `getProjectWalls` from `"../projectWalls"`.

- [ ] **Step 3: Compose in store.ts**

In `createAppStore`, after `commitWallObjectMoves` is defined:

```ts
const arrange = createArrangeSlice(set, get, { commitWallObjectMoves, persist });
const { settleArrangeSession, autoAcceptArrangeSession } = arrange; // used by selection/view actions — destructure whichever callers need
```

In the returned state object, replace the four arrange state fields and seven actions with:

```ts
...ARRANGE_SLICE_INITIAL,
...arrange.actions,
```

`AppState`'s arrange fields/actions now come from `ArrangeSliceState & ArrangeSliceActions` (intersect them into the `AppState` type; delete the now-duplicate declarations). Keep a re-export for existing importers:

```ts
export type { ArrangeSession } from "./store/arrangeSlice";
```

Callers inside store.ts that used `autoAcceptArrangeSession()` / `settleArrangeSession(...)` keep the same call syntax via the destructured locals. `pushEditEntry`'s `arrangeSession: null` and `setDocument`'s stay as plain state writes — no change.

- [ ] **Step 4: Verify no behavior change**

Run: `npm run check && npm test`
Expected: tsc clean, ALL existing tests pass WITHOUT modification (this is the proof of verbatim-ness). Then `git diff --stat` — store.ts should shrink by roughly the size of the new files combined.

- [ ] **Step 5: Commit**

```bash
git add src/app/store.ts src/app/store/arrangeSlice.ts src/app/projectWalls.ts
git commit -m "refactor(store): extract arrange session into store/arrangeSlice"
```

---

### Task 5: Selection union + single-writer mirrors (wart fix lands here)

The union becomes the store's source of truth for selection. The five legacy fields become **mirrors** — still real state (so all 10 consumer files compile and behave unchanged), but written exclusively by one pure function. `legacySelectionSlots` dies. The checklist/opening wart fixes land here (spec "Behavior changes" 1-3).

**Files:**
- Create: `src/app/store/selectionSlice.ts`
- Create: `src/app/store/selectionSlice.test.ts`
- Create: `src/test/inMemoryRepositories.ts` (extract the three `InMemory*` repo classes + fake image processor from `store.test.ts` so new test files reuse them; `store.test.ts` imports them — mechanical move, no logic change)
- Modify: `src/app/store.ts`

**Interfaces:**
- Produces (all from `src/app/store/selectionSlice.ts`):

```ts
export type Selection =
  | { kind: "none" }
  | { kind: "objects"; ids: string[] } // placement ids, length >= 1 by construction
  | { kind: "libraryArtwork"; artworkId: string } // checklist pick with no placement
  | { kind: "room"; roomId: string };

export const NO_SELECTION: Selection = { kind: "none" };

// Pure derivation helpers — these OUTLIVE the migration (consumers use them
// after the mirrors are deleted in Task 9).
export function objectIdsOf(selection: Selection): string[]; // stable [] identity for non-objects
export function roomIdOf(selection: Selection): string | null;
export function getSelectedArtworkId(project: Project | null, selection: Selection): string | null;
export function getSelectedOpeningId(project: Project | null, selection: Selection): string | null;

// THE single writer: every selection state change in the store goes through
// this. Returns the union + context + all five legacy mirrors.
export type SelectionWriteFields = {
  selection: Selection;
  wallContextId: string | null;
  selectedWallId: string | null;
  selectedArtworkId: string | null;
  selectedOpeningId: string | null;
  selectedObjectIds: string[];
  selectedRoomId: string | null;
};
export function selectionWrite(
  project: Project | null,
  selection: Selection,
  wallContextId: string | null
): SelectionWriteFields;
```

- [ ] **Step 1: Write the failing unit tests for the pure helpers**

`src/app/store/selectionSlice.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSampleProject } from "../../domain/sample/sampleProject";
import {
  getSelectedArtworkId,
  getSelectedOpeningId,
  NO_SELECTION,
  objectIdsOf,
  roomIdOf,
  selectionWrite,
  type Selection
} from "./selectionSlice";

// The sample project ships with placed artworks/openings — resolve real ids
// from it rather than inventing fixtures.
const project = createSampleProject();
const artworkPlacement = project.wallObjects.find((o) => o.kind === "artwork")!;
const openingPlacement = project.wallObjects.find((o) => o.kind !== "artwork")!;

describe("selection helpers", () => {
  it("objectIdsOf returns the ids for objects and a stable [] otherwise", () => {
    const sel: Selection = { kind: "objects", ids: ["a"] };
    expect(objectIdsOf(sel)).toEqual(["a"]);
    expect(objectIdsOf(NO_SELECTION)).toBe(objectIdsOf({ kind: "room", roomId: "r" })); // same identity
  });

  it("roomIdOf", () => {
    expect(roomIdOf({ kind: "room", roomId: "r1" })).toBe("r1");
    expect(roomIdOf(NO_SELECTION)).toBeNull();
  });

  it("a single artwork placement derives its library artworkId", () => {
    const sel: Selection = { kind: "objects", ids: [artworkPlacement.id] };
    expect(getSelectedArtworkId(project, sel)).toBe(artworkPlacement.artworkId);
    expect(getSelectedOpeningId(project, sel)).toBeNull();
  });

  it("a single opening placement derives selectedOpeningId", () => {
    const sel: Selection = { kind: "objects", ids: [openingPlacement.id] };
    expect(getSelectedOpeningId(project, sel)).toBe(openingPlacement.id);
    expect(getSelectedArtworkId(project, sel)).toBeNull();
  });

  it("multi-select and dangling ids derive neither single-select", () => {
    expect(getSelectedArtworkId(project, { kind: "objects", ids: [artworkPlacement.id, openingPlacement.id] })).toBeNull();
    expect(getSelectedArtworkId(project, { kind: "objects", ids: ["dead-id"] })).toBeNull();
  });

  it("libraryArtwork selection derives artworkId without a placement", () => {
    expect(getSelectedArtworkId(project, { kind: "libraryArtwork", artworkId: "lib-1" })).toBe("lib-1");
  });

  it("selectionWrite mirrors every legacy field", () => {
    const fields = selectionWrite(project, { kind: "objects", ids: [artworkPlacement.id] }, "wall-1");
    expect(fields).toEqual({
      selection: { kind: "objects", ids: [artworkPlacement.id] },
      wallContextId: "wall-1",
      selectedWallId: "wall-1",
      selectedArtworkId: artworkPlacement.artworkId,
      selectedOpeningId: null,
      selectedObjectIds: [artworkPlacement.id],
      selectedRoomId: null
    });
  });
});
```

Run: `npx vitest run src/app/store/selectionSlice.test.ts` — Expected: FAIL (module doesn't exist).

- [ ] **Step 2: Implement the pure module**

```ts
// src/app/store/selectionSlice.ts
import type { Project } from "../../domain/project";

// What is selected, as one value. Selection is view state (never undoable,
// never persisted — docs/plan.md §7 scopes undo to the document). Invalid
// combinations of the old five slots are unrepresentable here:
//   none           — nothing selected
//   objects        — 1+ placement ids (wallObjects/floorObjects entries);
//                    NEVER library artwork ids. [] is normalized to none.
//   libraryArtwork — a checklist pick that has no placement yet (inspector-only)
//   room           — plan view's room focus (resize/move affordances)
// The sidebar's wall context is NOT part of this union — it persists across
// object selection (see wallContextId at the use site).
export type Selection =
  | { kind: "none" }
  | { kind: "objects"; ids: string[] }
  | { kind: "libraryArtwork"; artworkId: string }
  | { kind: "room"; roomId: string };

export const NO_SELECTION: Selection = { kind: "none" };

const EMPTY_IDS: string[] = [];

export function objectIdsOf(selection: Selection): string[] {
  return selection.kind === "objects" ? selection.ids : EMPTY_IDS;
}

export function roomIdOf(selection: Selection): string | null {
  return selection.kind === "room" ? selection.roomId : null;
}

function findPlacement(project: Project, id: string) {
  return (
    project.wallObjects.find((wallObject) => wallObject.id === id) ??
    project.floorObjects.find((floorObject) => floorObject.id === id)
  );
}

// The library artwork the inspector should show: an explicit checklist pick,
// or the artwork behind a single selected artwork placement. Multi-select and
// dangling ids resolve to null — there's no single artwork to describe.
export function getSelectedArtworkId(project: Project | null, selection: Selection): string | null {
  if (selection.kind === "libraryArtwork") return selection.artworkId;
  if (!project || selection.kind !== "objects" || selection.ids.length !== 1) return null;
  const placement = findPlacement(project, selection.ids[0]);
  return placement?.kind === "artwork" ? placement.artworkId : null;
}

// The opening/blocked-zone placement the inspector should show — a single
// selected non-artwork placement (doors/windows/blocked zones, wall or floor).
export function getSelectedOpeningId(project: Project | null, selection: Selection): string | null {
  if (!project || selection.kind !== "objects" || selection.ids.length !== 1) return null;
  const placement = findPlacement(project, selection.ids[0]);
  return placement && placement.kind !== "artwork" ? selection.ids[0] : null;
}

export type SelectionWriteFields = {
  selection: Selection;
  wallContextId: string | null;
  selectedWallId: string | null;
  selectedArtworkId: string | null;
  selectedOpeningId: string | null;
  selectedObjectIds: string[];
  selectedRoomId: string | null;
};

// MIGRATION BRIDGE (delete with the mirror fields): the one place the legacy
// five slots are written. Every selection change in the store flows through
// here so the mirrors can never drift from the union.
export function selectionWrite(
  project: Project | null,
  selection: Selection,
  wallContextId: string | null
): SelectionWriteFields {
  const normalized: Selection =
    selection.kind === "objects" && selection.ids.length === 0 ? NO_SELECTION : selection;
  return {
    selection: normalized,
    wallContextId,
    selectedWallId: wallContextId,
    selectedArtworkId: getSelectedArtworkId(project, normalized),
    selectedOpeningId: getSelectedOpeningId(project, normalized),
    selectedObjectIds: objectIdsOf(normalized),
    selectedRoomId: roomIdOf(normalized)
  };
}
```

Run: `npx vitest run src/app/store/selectionSlice.test.ts` — Expected: PASS.

- [ ] **Step 3: Extract the in-memory repos for reuse**

Create `src/test/inMemoryRepositories.ts`; MOVE `InMemoryProjectRepository`, `InMemoryArtworkLibraryRepository`, `InMemoryAssetRepository`, and the fake image-processor helper from the top of `store.test.ts` (export each); `store.test.ts` imports them. Run `npm test` — all pass, no assertion touched.

- [ ] **Step 4: Route the store through the union**

In `store.ts`:

1. Add state fields `selection: Selection` (init `NO_SELECTION`) and `wallContextId: string | null` (init `null`) to `AppState` and the initial object. Keep the five legacy fields declared — they are now mirrors.
2. Add a doc comment on the legacy fields: `// MIRRORS of `selection`/`wallContextId` (Task 5 bridge) — written only via selectionWrite; consumers migrate off them, then they die.`
3. Rewrite every selection write to go through `selectionWrite`. The complete transition table (preserve `autoAcceptArrangeSession()` as the first line wherever it is today):

| Action | New body writes |
|---|---|
| `selectWall(wallId)` | `selectionWrite(project, NO_SELECTION, wallId)` |
| `selectArtwork(artworkId)` | Resolve first placement: `project.wallObjects.find(o => o.kind === "artwork" && o.artworkId === artworkId) ?? project.floorObjects.find(o => o.kind === "artwork" && o.artworkId === artworkId)`. Placed → `selectionWrite(project, { kind: "objects", ids: [placement.id] }, get().wallContextId)`. Unplaced/dangling → `selectionWrite(project, { kind: "libraryArtwork", artworkId }, get().wallContextId)`. **This is the wart fix.** |
| `selectOpening(id)` | Validate id is a live wallObject/floorObject (same tolerance as `selectObject`; dead id → no-op). Then `selectionWrite(project, { kind: "objects", ids: [id] }, get().wallContextId)` |
| `selectRoom(roomId)` | `selectionWrite(project, { kind: "room", roomId }, null)` — room focus still drops wall context |
| `selectObject(id, opts)` | Keep the existing live-id guard + additive toggle against `objectIdsOf(get().selection)`; write `selectionWrite(project, { kind: "objects", ids: next }, get().wallContextId)` (empty `next` normalizes to none) |
| `setObjectSelection(ids)` | Keep the live-id filter; `selectionWrite(project, { kind: "objects", ids: next }, get().wallContextId)` |
| `clearObjectSelection()` | No-op guard: `get().selection.kind === "none"` → return. Else `selectionWrite(project, NO_SELECTION, get().wallContextId)` |
| `setDocument(project, extras)` | Replace the five-field reset with `...selectionWrite(project, NO_SELECTION, getFirstWall(project)?.id ?? null)` |

4. `EditExtras` (store.ts:302-315): remove the five legacy keys; add `selection`-carrying extras by allowing `Partial<SelectionWriteFields>`. Then fix every extras call site — find them with `grep -n "selectedArtworkId:\|selectedOpeningId:\|selectedObjectIds:\|selectedRoomId:\|selectedWallId:" src/app/store.ts`. The two known interesting ones:
   - `placeArtwork` (extras `{ selectedArtworkId: artworkId, selectedOpeningId: null }`) → `{ ...selectionWrite(project, { kind: "objects", ids: [placement.id] }, get().wallContextId) }` — placing selects the new placement (spec wart-fix umbrella; previously it left any multi-select untouched and set only the inspector slot).
   - `placeArtworkOnFloor` (same shape) → same treatment with `floorObject.id`.
   - Every other write site of a legacy field (e.g. removal actions clearing selection): re-express as `selectionWrite(...)` with the equivalent union value. NO direct writes to the five fields may remain outside `selectionWrite` — verify with the grep; only the `AppState` type, initial object, and `selectionWrite` spreads may match.
5. Delete `legacySelectionSlots` (store.ts:2183-2210) — `selectionWrite` replaces it.
6. `undo`/`redo`: unchanged (they don't touch selection today; keep it that way).

- [ ] **Step 5: Add store-level transition tests**

Append to `src/app/store/selectionSlice.test.ts`, using `createAppStore` + the extracted in-memory repos (copy the store-construction pattern from `store.test.ts`'s `beforeEach`):

```ts
describe("selection transitions through the store", () => {
  // build: store booted with a sample project that has >=1 placed artwork,
  // >=1 opening, >=1 room, and one checklist artwork with NO placement
  // (add via the library repo + checklistArtworkIds, or importProjectJson).

  it("selectArtwork with a placed artwork selects its placement (wart fix)", ...); // selection.kind === "objects", ids = [placementId]; selectedObjectIds mirror matches
  it("selectArtwork with an unplaced checklist artwork selects libraryArtwork", ...);
  it("selectOpening lands in objects; dead id is a no-op", ...);
  it("selectWall clears selection but keeps it as context", ...); // selection none, wallContextId set, mirrors consistent
  it("selectRoom drops wall context; selectWall drops room", ...);
  it("selectObject additive toggles; removing the last id normalizes to none", ...);
  it("mirrors never drift: after every action above, selectedObjectIds === objectIdsOf(selection) etc.", ...);
  it("selection changes still auto-accept a live arrange session", ...); // begin session, selectWall, expect one "Arrange on wall" undo entry when preview moved
});

describe("arrange-session settle matrix", () => {
  // The spec asks for an explicit matrix. Some rows may already be covered in
  // store.test.ts — check first and add ONLY the missing rows, here:
  //   selection change → accept (undo entry when moved, silent clear when no-op)
  //   view-mode change → accept
  //   undo / redo      → session dropped, no extra entry
  //   foreign edit (any applyEdit) → session dropped
  //   collision-blocked auto-accept → session cancelled, error surfaced
});
```

Write real bodies (the sketch above names the behaviors; each `it` must construct state, act, and assert concrete values — follow `store.test.ts` idioms).

- [ ] **Step 6: Full verification**

Run: `npm run check && npm test`
Expected: tsc clean; ALL pass. Existing store.test.ts assertions about `selectedArtworkId`/`selectedOpeningId` after `placeArtwork` may fail — those two specific expectations change deliberately (placement now selected): update ONLY assertions that the spec's behavior-changes section covers, and say so in the commit body. Anything else failing = you broke behavior; fix the code, not the test.

- [ ] **Step 7: Commit**

```bash
git add src/app/store.ts src/app/store/selectionSlice.ts src/app/store/selectionSlice.test.ts src/test/inMemoryRepositories.ts src/app/store.test.ts
git commit -m "refactor(store): selection as one discriminated union; legacy slots become mirrors

Checklist artwork selection now resolves to its placement (Fit-selected wart
fix); openings fold into the objects selection; placing selects the placement."
```

---

### Task 6: Migrate consumers A — App.tsx + hooks

Move App.tsx, `useArrangeNudgeShortcuts`, and `arrangeReadout` off the mirror fields onto `selection` / `wallContextId` / the pure helpers. Rendered behavior identical except spec change 2 (Delete/Escape simplification).

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/hooks/useArrangeNudgeShortcuts.ts`
- Modify: `src/app/hooks/arrangeReadout.ts`

**Interfaces:**
- Consumes: `Selection`, `NO_SELECTION`, `objectIdsOf`, `roomIdOf`, `getSelectedArtworkId`, `getSelectedOpeningId` from `src/app/store/selectionSlice.ts`; `wallContextId` field.
- Produces: these three files contain ZERO references to `selectedWallId`, `selectedArtworkId`, `selectedOpeningId`, `selectedObjectIds`, `selectedRoomId` as store fields (child-component prop names may keep their names for now — Task 7/8 own those files).

**Mechanical mapping** (apply at every read site; find them with `grep -n "selectedWallId\|selectedArtworkId\|selectedOpeningId\|selectedObjectIds\|selectedRoomId" <file>`):

| Old read | New read |
|---|---|
| `selectedWallId` | `wallContextId` |
| `selectedObjectIds` | `objectIdsOf(selection)` (compute once per render into a local `const selectedObjectIds` to keep the diff small and identity stable) |
| `selectedRoomId` | `roomIdOf(selection)` |
| `selectedArtworkId` | `getSelectedArtworkId(project, selection)` (once per render) |
| `selectedOpeningId` | `getSelectedOpeningId(project, selection)` (once per render) |

**Semantic simplifications in App.tsx (spec change 2):**
- Delete-key handler (App.tsx:241-292): the `selectedOpeningId` branch and the `selectedArtworkId`-resolution branch DIE — a placed anything is now an objects-selection, so the `selectedObjectIds.length > 0` branch covers all of it. An unplaced checklist selection (`selection.kind === "libraryArtwork"`) is deliberately ignored (nothing to remove) — keep a one-line comment saying so.
- Escape handler: `if (selectedObjectIds.length > 0) clearObjectSelection()` becomes `if (selection.kind !== "none") clearObjectSelection()` — Escape now also clears libraryArtwork and room selections (spec change 2; room-clear was previously only reachable via other paths — disclose in commit).
- Placement-warning click (App.tsx:558-568): `selectArtwork(wallObject.artworkId)` → `selectObject(wallObject.id)` (selects the actual placement; openings keep `selectOpening(wallObject.id)`).

- [ ] **Step 1: Migrate the two hooks** (small, pure reads — mapping table only), run `npm run check`.
- [ ] **Step 2: Migrate App.tsx reads + the three semantic simplifications above.** Props passed down to children keep their current names/values (children still expect e.g. `selectedArtworkId` — feed them the derived locals).
- [ ] **Step 3: Verify** — `npm run check && npm test`; then `grep -n "selected\(Wall\|Artwork\|Opening\|Object\|Room\)Id" src/app/App.tsx src/app/hooks/useArrangeNudgeShortcuts.ts src/app/hooks/arrangeReadout.ts` shows only derived-local/prop names, no `useAppStore((s) => s.selectedX)` reads.
- [ ] **Step 4: Commit**

```bash
git add src/app/App.tsx src/app/hooks/useArrangeNudgeShortcuts.ts src/app/hooks/arrangeReadout.ts
git commit -m "refactor(app): App + hooks read the selection union"
```

---

### Task 7: Migrate consumers B — 2D views & panels

Same mechanical mapping as Task 6 for: `src/app/components/PlanView.tsx`, `ElevationView.tsx`, `ChecklistPanel.tsx`, `RoomsPanel.tsx`, `RoomResizeHandles.tsx`.

**Files:** Modify the five components above (and their App.tsx prop-wiring lines).

**Interfaces:**
- Consumes: same helper set as Task 6.
- Produces: component props renamed where they cross the boundary — a component that renders "the selected objects" takes `selection: Selection` or the derived value it actually needs (e.g. ChecklistPanel keeps `selectedArtworkId: string | null` as a prop — it genuinely wants the derived artwork id; PlanView/ElevationView take whatever they consume today, sourced from the union). Judgment rule: pass the DERIVED value the child actually uses, not the whole union, unless the child branches on kind.

- [ ] **Step 1: Migrate PlanView.tsx + its App wiring;** `npm run check && npx vitest run src/app/components/PlanView.test.tsx` (if present) pass.
- [ ] **Step 2: Migrate ElevationView.tsx + wiring;** check + relevant tests pass.
- [ ] **Step 3: Migrate ChecklistPanel.tsx, RoomsPanel.tsx, RoomResizeHandles.tsx + wiring;** check + tests pass.
- [ ] **Step 4: Full suite** — `npm test` all pass; grep the five files for `useAppStore((s) => s.selected` → zero hits.
- [ ] **Step 5: Commit**

```bash
git add src/app/components/PlanView.tsx src/app/components/ElevationView.tsx src/app/components/ChecklistPanel.tsx src/app/components/RoomsPanel.tsx src/app/components/RoomResizeHandles.tsx src/app/App.tsx
git commit -m "refactor(2d): views and panels read the selection union"
```

---

### Task 8: Migrate consumers C — 3D components

Same mapping for `src/app/components/three/ThreeDView.tsx`, `WallPanel.tsx`, `SceneRooms.tsx`.

- [ ] **Step 1: Migrate all three + any App wiring;** same mapping table and prop-derivation rule as Task 7.
- [ ] **Step 2: Verify** — `npm run check && npm test` pass; grep for legacy store reads in `src/app/components/three/` → zero.
- [ ] **Step 3: Commit**

```bash
git add src/app/components/three/ThreeDView.tsx src/app/components/three/WallPanel.tsx src/app/components/three/SceneRooms.tsx src/app/App.tsx
git commit -m "refactor(3d): 3D components read the selection union"
```

---

### Task 9: Delete the mirrors

The type system proves the migration: remove the five legacy fields, and whatever still reads them fails `tsc`.

**Files:**
- Modify: `src/app/store.ts`, `src/app/store/selectionSlice.ts`, `src/app/store.test.ts` (+ any straggler tsc finds)

- [ ] **Step 1: Delete the mirror fields** from `AppState` and the initial object. Change `selectionWrite`'s return type to `{ selection: Selection; wallContextId: string | null }` (drop the five mirror keys and `SelectionWriteFields`; keep the pure helpers — they are permanent API). Rename any store-internal reads tsc flags.
- [ ] **Step 2: Run `npm run check`** — fix every error by moving the reader to the union/helpers (there should be none outside store.test.ts if Tasks 6-8 were complete).
- [ ] **Step 3: Migrate store.test.ts assertions** — every `expect(store.getState().selectedX)` becomes an assertion on `selection` / `wallContextId` / helper output. The assertions LOCK the same behaviors; only the observed field changes. Do not delete test cases.
- [ ] **Step 4: Full verification** — `npm run check && npm test && npm run build` all clean. `grep -rn "selectedWallId\|selectedOpeningId\|selectedObjectIds\|selectedRoomId" src --include="*.ts" --include="*.tsx"` → zero store-field hits (prop names that survived by design are fine — list them in the report). `selectedArtworkId` remains only as prop/derived-local names.
- [ ] **Step 5: Commit**

```bash
git add src/app/store.ts src/app/store/selectionSlice.ts src/app/store.test.ts
git commit -m "refactor(store): delete legacy selection mirrors — union is the only selection state"
```

**CHECKPOINT (main session, not a subagent): browser-verify the refactor** via the project's /verify recipe — checklist click on a placed artwork enables Fit-selected (headline wart fix) and highlights the placement; unplaced checklist click shows the inspector only; canvas multi-select, arrange session begin/adjust/Escape-cancel/click-away-accept; Delete removes selected placement and opening; room handles; 3D checklist→highlight flight; elevation selection + tap-clear.

---

### Task 10: Placement uniqueness

Spec: an artwork gets at most one placement per project (wall or floor); enforced on new placements only. Store guard is the authority; checklist drag-disable is the UX.

**Files:**
- Modify: `src/app/store.ts` (`placeArtwork`, `placeArtworkOnFloor`)
- Modify: `src/app/components/ChecklistPanel.tsx` (row `isDraggable`)
- Modify: `src/app/store.test.ts` (new cases)

**Interfaces:**
- Produces: `ALREADY_PLACED_MESSAGE` (module const in store.ts, non-exported is fine; tests match on substring).

- [ ] **Step 1: Write failing store tests**

In `store.test.ts` (or a new `describe` in `selectionSlice.test.ts`'s file if store.test.ts placement suites live there — put them beside the existing `placeArtwork` tests):

```ts
it("placeArtwork rejects an artwork that already has a wall placement", async () => {
  // place once (succeeds), place again at a free spot
  await store.getState().placeArtwork(artworkId, wallId, 4000, 1500);
  const placementsBefore = store.getState().project!.wallObjects.length;
  await store.getState().placeArtwork(artworkId, wallId, 6000, 1500);
  expect(store.getState().project!.wallObjects.length).toBe(placementsBefore);
  expect(store.getState().error).toMatch(/already placed/i);
});

it("placeArtworkOnFloor rejects an artwork already placed on a wall (and vice versa)", async () => {
  await store.getState().placeArtwork(artworkId, wallId, 4000, 1500);
  await store.getState().placeArtworkOnFloor(artworkId, 1000, 1000);
  expect(store.getState().project!.floorObjects).toHaveLength(0);
  expect(store.getState().error).toMatch(/already placed/i);
});

it("a legacy project with duplicate placements still loads and its members still move", ...);
// build a project JSON with two placements of one artworkId, importProjectJson it,
// expect no error, then moveArtworkPlacement one of them — succeeds.
```

Run: fail (guard absent — second placement currently succeeds).

- [ ] **Step 2: Implement the guard**

In `store.ts`, near `OVERLAP_BLOCKED_MESSAGE`:

```ts
// One placement per artwork per project — trying layout variants is what
// project duplication is for (spec 2026-07-07). Enforced only on NEW
// placements; legacy projects that already contain duplicates keep them.
const ALREADY_PLACED_MESSAGE =
  "This artwork is already placed. To try another arrangement, duplicate the project and experiment there.";
```

In `placeArtwork`, after the `artwork`/wall guards and before `createArtworkPlacement`:

```ts
const alreadyPlaced =
  project.wallObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId) ||
  project.floorObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId);
if (alreadyPlaced) {
  set({ error: ALREADY_PLACED_MESSAGE });
  return;
}
```

Same block in `placeArtworkOnFloor` after its `artwork` guard.

- [ ] **Step 3: Disable dragging placed rows**

`ChecklistPanel.tsx:442`: `const isDraggable = artwork !== null;` → `const isDraggable = artwork !== null && !isPlaced;`. Add `title="Already placed — drag is disabled. Duplicate the project to try another arrangement."` on the row only when `isPlaced` (keep the existing placed tag as the visual cue; no new styling).

- [ ] **Step 4: Verify** — new tests pass; `npm test` full suite passes (existing tests that place the same artwork twice, if any, need their fixtures switched to distinct artworks — flag each in the report).
- [ ] **Step 5: Commit**

```bash
git add src/app/store.ts src/app/components/ChecklistPanel.tsx src/app/store.test.ts
git commit -m "feat: an artwork can be placed only once per project"
```

---

### Task 11: Upload duplicate detection

Spec: an uploaded image whose sha256 matches an existing checklist asset (or an earlier file in the same batch) is HELD for confirmation, not silently added. Assets already carry `sha256` (computed by the image processor; `optional` in the schema — treat a missing hash as never-matching).

**Files:**
- Modify: `src/app/store.ts` (`addArtworksFromFiles`, new state + 2 actions, `setDocument` clears)
- Modify: `src/app/components/ChecklistPanel.tsx` (confirm strip UI)
- Modify: `src/app/App.tsx` (wire props)
- Modify: `src/app/store.test.ts` (new cases; the in-memory asset repo + fake processor from `src/test/inMemoryRepositories.ts` already support fixed hashes)

**Interfaces:**
- Produces (store):

```ts
// AppState additions
pendingDuplicateUploads: { file: File; existingArtworkTitle: string }[]; // [] when none
confirmDuplicateUploads: () => Promise<void>; // intakes held files, skipping the dup check
dismissDuplicateUploads: () => void;
// addArtworksFromFiles gains an internal options bag:
addArtworksFromFiles: (files: File[], opts?: { skipDuplicateCheck?: boolean }) => Promise<void>;
```

- [ ] **Step 1: Write failing store tests**

```ts
it("holds an upload whose sha256 matches an existing checklist asset", async () => {
  // intake file A (fake processor returns sha "aaa"); then intake file B with the same sha
  await store.getState().addArtworksFromFiles([fileA]);
  const countAfterFirst = store.getState().libraryArtworks.length;
  await store.getState().addArtworksFromFiles([fileB_sameSha]);
  expect(store.getState().libraryArtworks.length).toBe(countAfterFirst); // NOT added
  expect(store.getState().pendingDuplicateUploads).toHaveLength(1);
  expect(store.getState().pendingDuplicateUploads[0].existingArtworkTitle).toBe(titleOfFileA);
});

it("catches a twin within one batch", async () => {
  await store.getState().addArtworksFromFiles([fileA, fileA_copy]); // same sha, one batch
  expect(store.getState().libraryArtworks.length).toBe(1);
  expect(store.getState().pendingDuplicateUploads).toHaveLength(1);
});

it("non-duplicates in a mixed batch intake normally", async () => { ... }); // [dup, fresh] → fresh added, dup held

it("confirmDuplicateUploads intakes the held files; dismiss drops them", async () => {
  // after a hold: confirm → library grows, pending cleared, checklist entry added (one undo entry)
  // after another hold: dismiss → pending cleared, library unchanged
});

it("a library asset without a sha256 never matches", async () => { ... }); // legacy-asset tolerance
```

The fake image processor must return a controllable `sha256` per file (extend `src/test/inMemoryRepositories.ts`'s fake with a `hashForName` map keyed on `file.name` if it doesn't already). Run: fail.

- [ ] **Step 2: Implement**

In `addArtworksFromFiles(files, opts = {})`, inside the `try` before the loop:

```ts
// Duplicate screen: exact content-hash match against the current library's
// assets (and earlier files in this batch). Legacy assets without a sha256
// never match. Held files are surfaced for confirmation instead of intaken —
// re-uploading the same image is usually a mistake, occasionally deliberate.
const skipDuplicateCheck = opts.skipDuplicateCheck === true;
const titleBySha = new Map<string, string>();
if (!skipDuplicateCheck) {
  for (const libraryArtwork of get().libraryArtworks) {
    try {
      const asset = await deps.assetRepository.getAsset(libraryArtwork.assetId);
      if (asset.sha256) titleBySha.set(asset.sha256, libraryArtwork.title);
    } catch {
      // A dangling assetId can't match anything — skip it.
    }
  }
}
const heldDuplicates: { file: File; existingArtworkTitle: string }[] = [];
```

Then in the per-file loop, right after `processed = await deps.imageProcessor.process(file)` succeeds:

```ts
if (!skipDuplicateCheck) {
  const existingTitle = titleBySha.get(processed.sha256);
  if (existingTitle !== undefined) {
    heldDuplicates.push({ file, existingArtworkTitle: existingTitle });
    continue;
  }
  titleBySha.set(processed.sha256, titleFromFilename(file.name)); // batch-internal twins
}
```

After the loop (before the `failures` block), surface the holds:

```ts
if (heldDuplicates.length > 0) {
  set({ pendingDuplicateUploads: [...get().pendingDuplicateUploads, ...heldDuplicates] });
}
```

New actions (place near `addArtworksFromFiles`):

```ts
async confirmDuplicateUploads() {
  const held = get().pendingDuplicateUploads;
  if (held.length === 0) return;
  set({ pendingDuplicateUploads: [] });
  await get().addArtworksFromFiles(held.map((entry) => entry.file), { skipDuplicateCheck: true });
},

dismissDuplicateUploads() {
  set({ pendingDuplicateUploads: [] });
},
```

`setDocument` extras: add `pendingDuplicateUploads: []` to its reset block (a held file belongs to the project it was dropped on). Initial state: `pendingDuplicateUploads: []`.

- [ ] **Step 3: UI**

ChecklistPanel: new props `pendingDuplicateUploads`, `onConfirmDuplicateUploads`, `onDismissDuplicateUploads` (wired from App.tsx next to `onAddArtworksFromFiles`). When non-empty, render a plain strip above the list (match the panel's existing flat/square styling — no pills, no new colors):

```
N image(s) look identical to works already in the checklist:
"Title A", "Title B". Add anyway?
[Add anyway]  [Don't add]
```

Exact copy: singular `This image looks identical to “{title}” already in the checklist. Add it anyway?`; plural `{n} images look identical to works already in the checklist: {comma-separated quoted titles}. Add them anyway?` Buttons: `Add anyway` / `Don't add`.

- [ ] **Step 4: Verify** — new tests pass, `npm run check && npm test` clean.
- [ ] **Step 5: Commit**

```bash
git add src/app/store.ts src/app/components/ChecklistPanel.tsx src/app/App.tsx src/app/store.test.ts src/test/inMemoryRepositories.ts
git commit -m "feat: warn-and-confirm when an uploaded image duplicates a checklist asset"
```

**CHECKPOINT (main session): browser-verify duplicate prevention** — placed checklist row won't drag (tooltip shows), second placement attempt via any path shows the blocked message, duplicate upload shows the confirm strip, "Add anyway" intakes it, "Don't add" drops it, mixed batch adds only the fresh file.

---

### Task 12: Branch finish

- [ ] **Step 1:** `npm run check && npm test && npm run build` — all clean (build includes the chunk assertion).
- [ ] **Step 2:** Final whole-branch code review (superpowers:requesting-code-review), fix findings.
- [ ] **Step 3:** Update `.superpowers/sdd/progress.md` ledger; merge per superpowers:finishing-a-development-branch (user decides merge/PR).
