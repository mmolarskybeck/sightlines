# Feedback round — 2026-08-28

Batch of improvements from colleague feedback + curator wishlist. Decisions of record and
deferred ideas live here; per-feature status lands in `docs/status.md` when built.

## In scope this round

1. **Export filename extension bug (Windows).** `triggerDownload`'s `showSaveFilePicker` call
   passes `suggestedName` only — no `types` filter — so on Windows with "hide extensions for
   known file types" (the default) the shell strips `.pdf`/`.png` and nothing re-appends it.
   Fix: thread a file-type descriptor (`description` + `accept` map) into `triggerDownload`
   and pass a `types` entry for every export.
2. **PDF export dialog discoverability.** Saved views / snapshots ("3D views") are dead last
   in a scroll container with no scroll affordance; in a 4-room project the section sits
   ~700–900px below a ~600px fold. A colleague never found it. Fix: keep every top-level
   section header visible without scrolling + add a real scroll affordance.
3. **CRT box monitor display for video works.** DECIDED (user, 2026-08-28):
   - UI = a plain always-visible **"Display" dropdown** (Framed image / Box monitor) — no
     medium auto-detect, no mode toggle.
   - Round 1 ships **CRT box monitor only**. Flatscreens and projections are already
     simulable as plain wall works (user's observation), so they wait.
   - Default black box, 4:3 screen, image on the front face; **default mounted on a simple
     white pedestal**, optionally directly on the floor.
4. **3D view: hand/pan tool + zoom in/out buttons.** Many users don't discover
   right-drag-pan / WASD. Add a viewport chip cluster like plan/elevation's
   `ViewportZoomControls`, plus a hand tool that makes left-drag pan instead of orbit.
5. **3D editing: pointer-drag of placed works.** DECIDED (user, 2026-08-28): full parity
   where feasible — floor objects slide on the floor, wall works slide along walls, reusing
   the drop-target mapping and existing single-commit move actions. (Reverses the
   "full 3D dragging remains out of scope" note in `docs/status.md`.)

## Deferred ideas (save for later)

- **Pedestal options**: colors/materials (black, grey…), custom pedestal dimensions, and
  possibly pedestal as a standalone placeable plinth object that other floor works can sit
  on (see also `docs/quick-todos.md` plinths note).
- **More display types in the Display dropdown**: wall-mounted flatscreen (slim black bezel,
  no frame options), projection (soft-edged image, maybe a projector cone/beam glyph).
  Reminder: both are already approximable today as plain wall works — only build these when
  the approximation actually falls short.
- **Medium auto-detect nudge**: one-time "Looks like a video work — display as monitor?"
  suggestion when the Medium field matches video/film/media keywords. Rejected as the
  primary mechanism (fragile), still fine as a discoverability nudge later.
- **CRT niceties**: subtle screen glow / emissive treatment so a "playing" monitor reads as
  lit in 3D; multi-monitor stacks / video walls.
- **Elevation ghosts for floor-resting artworks**: pre-existing gap — floor-resting works
  (baseHeightMm = 0) get no elevation ghost at all today. The CRT monitor work touches this;
  whatever isn't covered there should be generalized to all floor artworks.
- **Hand tool for plan/elevation**: 2D pan is gesture-only (space-drag, middle/right-drag).
  If the 3D hand tool tests well, consider adding the same button to plan/elevation for
  consistency.
- **PDF support/facing info**: PDF still carries no suspension or facing info for floor
  works (open note in status.md §projection board) — the monitor lands on the same gap.
- **`monitorSupport` not stashed in `ArtworkFloorMemory`** (known v1 lossiness, 2026-08-28):
  a monitor with an explicit "on floor" (no pedestal) choice that gets captured onto a wall
  and later dragged back to the floor reverts to the pedestal default — geometry re-seeds
  correctly, only the support choice is lost. `imageFaces` gets the memory treatment;
  matching it needs a `FloorMemory` field + two store sites.
