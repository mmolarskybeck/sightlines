---
name: verify
description: Build/launch/drive recipe for verifying Sightlines changes end-to-end in a real browser.
---

# Verifying Sightlines

Single-package Vite + React app; the surface is the browser at the dev server.

## Launch

```bash
npm run dev -- --port 5199 --strictPort   # run in background; ready in ~1s
```

`.claude/launch.json` defines the same thing for Impeccable live mode (port 5173, autoPort) when preview tools are available.

## Drive (no preview tools available)

System Chrome via puppeteer-core works well — install it in a scratch dir
(`npm i puppeteer-core`, no browser download) and launch with:

- `executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
- a fresh `userDataDir` per run — this is what gives you a clean IndexedDB/localStorage origin.

Useful selectors: `.project-title` (title input), `button[title="Undo"|"Redo"]`,
`.error-banner`, `.checklist-panel input[type="file"]` (multi-image intake; the
JSON import input in the topbar is the single-file `accept=.json` one),
`.checklist-row` / `.checklist-title` / `.checklist-tag`, `.room-group`, `.wall-row`.

## Gotchas that cost time

- **Fixture images:** generate real PNGs with the browser's own canvas
  (`about:blank` page → `canvas.toDataURL` → write base64 to disk), then feed
  them through `elementHandle.uploadFile(...)`. `uploadFile` bypasses the
  input's `accept` filter — handy for testing rejection paths (.txt etc.).
- **Seeding a pre-upgrade IndexedDB:** the app opens the DB on boot, so to
  create an old-version database first, block the bundle with request
  interception (abort URLs containing `main.tsx`), `goto` the app origin
  (index.html loads, no JS runs), seed via `page.evaluate`, close the DB,
  disable interception, then reload for the real boot/upgrade path.
- Mid-drag synthetic pointer testing must be one uninterrupted
  pointerdown→move→up sequence per eval; interleaving screenshots corrupts the
  gesture (noted in docs/progress.md).
- Check sidebar/panel horizontal overflow after UI changes:
  `sidebar.scrollWidth > sidebar.clientWidth` is a cheap probe; grid tracks
  need `minmax(0, 1fr)` or long content defeats text ellipsis.
- **HTML5 DnD (checklist → elevation):** synthetic works in Chrome —
  `new DataTransfer()`, dispatch `dragstart` on the row, then
  `dragenter/dragover/drop` (same DataTransfer, real clientX/Y) on the
  elevation surface, `dragend` on the row. React's delegated handlers fire.
  Payloads are unreadable during dragover by design; the app relays
  `draggingArtworkId` via App state for ghost sizing.
- **Pointer-drag on SVG placements:** drive with `page.mouse` down/move/up
  plus pauses (~100ms after down, ~30ms between moves) — listeners attach in
  a useEffect after pointerdown's render, and instant synthetic input can
  finish before they exist.
- **SVG hit-testing trap:** `fill: none` shapes are only hit on their stroke
  (default `visiblePainted`). If a click/drag mysteriously lands on
  `.wall-fill`, probe `document.elementFromPoint` at the target's center;
  the fix pattern is `pointer-events: all` on the intended hit rect.
- Wall-local mm → client px for input targeting:
  `new DOMPoint(xMm, viewBoxHeight - yMm).matrixTransform(svg.getScreenCTM())`.

## Flows worth driving

- Checklist-first path: fresh (roomless) project → upload via the checklist
  file input → rows/thumbnails → reload persistence → undo/redo → remove.
- Geometry: select wall → numeric length edit vs. drag handle agreement.
- Import: topbar JSON import with a bad file → calm error, project untouched.
