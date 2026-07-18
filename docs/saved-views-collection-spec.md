# Saved views collection & thumbnails

**Status: shipped (Phases A–C, feat/export, 2026-07-17).** Outstanding: open
questions 2 (per-row Export image) and 3 (iPad regeneration cadence) below, and
the full-resolution open/download non-goal (§7). This spec closes two deferrals from
`docs/export-spec.md`: the saved-view **thumbnail cache** (§8.2 there defined
its contract but no slice built it — the Export dialog renders placeholder
tiles today) and the **left-pane Saved views collection** (§3.3 there named it
"the planned eventual home for browsing saved views by thumbnail, opening one
at full resolution, renaming, downloading, and deleting"). The SavedView data
model (§8) ships unchanged; everything here is presentation and derived cache.

## 1. What this is

Two connected pieces:

1. **Thumbnails** — every consumer of a Saved view (the Export dialog today,
   the collection pane below) shows a small rendered preview of the *current*
   exhibition from the stored camera pose, cached and regenerated lazily.
2. **The collection pane** — a left-pane surface, opened from the rail, where
   the user browses their Saved views by thumbnail, opens one in 3D, renames,
   and deletes. Once it lands, the Export dialog's rows shrink to
   inclusion-only, per export-spec §8.4.

## 2. Vocabulary

| Concept | User-facing term | Avoid |
|---|---|---|
| The bookmark object | Saved view | Snapshot, camera, bookmark (as a noun) |
| The rail pane | Saved views | Views (collides with Plan/Elevation/3D view modes) |
| The Export dialog section | 3D views | — (it names a *page type* in the document; see §8 open questions) |
| Opening one | Open in 3D | Restore, load, go to |

## 3. Thumbnail cache

### 3.1 Contract (restating export-spec §8.2)

A Saved view is a camera bookmark, not a picture. Its thumbnail renders the
**current** project from the stored pose — never a frozen capture from save
time — so a bookmark whose room has since been emptied *shows* an empty room,
and the user can exclude or delete it on evidence. Thumbnails are a **derived
cache outside the project**: never in project JSON, undo history, or
`.sightlines` packages.

### 3.2 Storage

A new `savedViewThumbnails` object store in the existing `sightlines`
IndexedDB (bump `DB_VERSION` 2 → 3 in `database.ts`; the upgrade handler
already guards each `createObjectStore` by existence, so the migration is one
guarded line). Entries:

- **Key:** `${projectId}:${viewId}`.
- **Value:** `{ blob, projectUpdatedAt }` — the rendered PNG plus the
  project's `updatedAt` stamp at render time.

Persisting (rather than memory-only caching) is deliberate: reopening the app
and glancing at the pane must not force the three.js chunk to load and N
scenes to render when the project hasn't changed. A stale-but-present
thumbnail also beats a placeholder while regeneration runs (§3.4).

Deletion: a view's entry dies with the view (any path — pane, dialog, undo of
a save); a project's entries die with the project, alongside its
workspace-preference record (export-spec §6.3's cleanup rule). Undoing a view
deletion recreates the entry lazily like any missing thumbnail.

### 3.3 Freshness

A thumbnail is fresh iff its stored `projectUpdatedAt` equals the project's
current `updatedAt`. This over-invalidates — a checklist metadata edit bumps
`updatedAt` without changing any rendered pixel — and that is accepted:
correct-but-conservative beats a bespoke "relevant changes" classifier that
silently goes wrong when a new edit type ships. The cost is bounded by §3.4's
laziness rules, and a stale thumbnail still displays while its replacement
renders, so over-invalidation never flashes placeholders.

Renaming a view does not invalidate (the title isn't in the pixels). Poses
are immutable after creation, so pose changes can't invalidate.

### 3.4 Rendering and regeneration

Rendering reuses **`SavedViewRenderHost`** — the invisible, queue-serialized,
pose-driven offscreen renderer the PDF path already uses. Its mount condition
generalizes from "Export PDF flow engaged" to "any thumbnail consumer visible
or thumbnail work pending": the Export dialog, the collection pane, or a
just-saved view awaiting its first render. Idle projects with no consumer on
screen pay nothing, same as today.

- **Laziness:** regeneration happens only while a consumer is visible (or as
  the save-time seed below). Nothing renders in the background of Plan work.
- **Debounce:** while a consumer is visible and the project is being edited,
  stale thumbnails re-render no more often than once per ~2s of edit quiet,
  oldest-stale first, one at a time (the host's existing sequential queue —
  chosen for iPad memory, export-spec §16 — is exactly right here).
- **Seed at save:** the Save view action queues that view's first render
  immediately, so its thumbnail exists before the user next opens the dialog
  or pane.
- **Size:** one canonical size, 296×184 px (4× the dialog's 74×46 cell,
  ~16:10). Consumers downscale; nothing upscales. One size keeps the cache
  single-entry-per-view and the queue arithmetic dumb.
- **Failure:** fail open. A render error logs, keeps the placeholder (the
  existing cube-on-grid tile), and never blocks the dialog, the pane, or an
  export — the same posture as the PDF font fallback.
- **Degenerate poses** (export-spec §8.4) get no thumbnail; their rows keep
  the placeholder plus the existing advisory.

### 3.5 Delivery to components

A hook (`useSavedViewThumbnails(project)`) owns cache reads, staleness
checks, regeneration requests through the host handle, and object-URL
create/revoke — mirroring `useAssetImageUrls`'s lifecycle discipline. It
returns `Record<viewId, objectUrl>`, which is precisely the `thumbnailUrls`
prop `ExportPdfDialog` already accepts and currently never receives. Wiring
the dialog is therefore zero dialog changes.

## 4. The collection pane

### 4.1 Rail

`leftPanel` grows a third member: `"checklist" | "rooms" | "savedViews"`,
with the same toggle semantic (active icon collapses the pane). Rail order:
checklist, rooms & walls, **saved views**, then the Artwork Library (a view
swap, not a pane) and the issues button. Icon: `BookmarksSimpleIcon` — the
plural sibling of the `BookmarkSimpleIcon` already on the Save view menu
item, so the save action and its home share a visual root. Labels: "Show
saved views" / "Hide saved views".

### 4.2 Rows

Each row: thumbnail (96×60, from the shared cache), **room label · title**
(live-resolved room label, exactly as the dialog and PDF compose it), and the
"Saved view *n*" subtitle only when the title has been renamed away from that
default (the dialog's rule). Hover/focus reveals the same rename and delete
icon actions the dialog uses today, with the same tooltips; rename is the
same inline commit-on-Enter/cancel-on-Escape form. Rows follow the app's
selectable-row grammar (checklist rows are the reference), in creation order
— the one order every consumer shares (export-spec fourth-round decision).

Deleting stays a plain action with no confirm dialog: it routes through
`applyEdit`, so standard project undo is the recovery path, consistent with
deletion from the Export dialog today.

An invalid-pose row keeps the advisory ("Invalid camera pose.") and its
delete action but is not openable — there is no valid camera to fly to.

### 4.3 Opening a view

Clicking a row (or pressing Enter on it) opens the view: switch to the 3D
view mode if not already there, then move the camera to the stored pose using
the existing pose-flight animation (`ThreeDViewActions` gains a
`flyToPose(pose)`; the internal `applyPose` + flight machinery already
exists). When 3D isn't mounted yet, the pose applies as the initial camera —
a handoff through App, not a race against mount. Under reduced motion the
flight is a cut, matching the app's motion rules. Opening is read-only: it
never writes the project, and navigating away from the pose afterward changes
nothing about the Saved view.

### 4.4 Empty state

The pane teaches its one gesture, in the dialog hint's voice:

> No saved views yet. In the 3D view, choose Export → Save view to bookmark
> the current angle.

### 4.5 Count

The pane header shows the count ("Saved views · 3"), matching the
checklist header's pattern. Invalid views count — they exist and need
managing — but are visibly flagged in their rows.

## 5. Export dialog slimming

Once the pane ships, the dialog's 3D views rows drop their rename and delete
actions, keeping checkbox + thumbnail + composed label + invalid advisory —
completing export-spec §8.4's stated end state ("when it lands the dialog
keeps only inclusion"). One management home; the dialog decides only what's
in the document. The dialog's empty hint stays, since a user can reach the
dialog without ever having opened the pane.

## 6. Phases

- **Phase A — Thumbnail cache + dialog wiring (shipped d15e71d).** DB v3 store
  (`DB_VERSION = 3`, `savedViewThumbnails`, `IndexedDbSavedViewThumbnailRepository`,
  wired 2c9a192), host mount generalization, save-time seed,
  `useSavedViewThumbnails`, pass `thumbnailUrls` to the dialog. Ships alone as a
  visible win (the dialog's placeholders become previews).
- **Phase B — Rail + pane (shipped 0aef712).** The `savedViews` left panel
  (`SavedViewsPanel`, `BookmarksSimpleIcon` on the rail): rows, open-in-3D
  (`flyToPose`), rename, delete, empty state. Depends on A for thumbnails.
- **Phase C — Dialog slimming (shipped 1555c5e).** Removed dialog row
  rename/delete (the dialog's Saved-view rows are now inclusion-only); copy
  alignment pass across pane/dialog/menu. Depends on B (never remove the only
  management surface before its replacement exists).

## 7. Non-goals

- **No full-resolution open/download from a row yet.** The eventual "open at
  full resolution, download" from export-spec §3.3 stays deferred;
  `renderSavedView(view, size)` makes it a cheap later addition (a row action
  that renders and saves through the existing image-delivery path), but it
  adds file-delivery plumbing this slice doesn't need. Opening in 3D +
  Export image already covers the need manually.
- **No reordering.** Creation order everywhere, per the export spec.
- **No thumbnails in `.sightlines` packages** — derived cache stays derived;
  an imported project regenerates lazily.
- **No frozen "as saved" comparison view.** Current-state rendering is the
  model; a history feature is out of scope.
- **No phone-tier pane redesign.** The pane inherits the left panel's
  existing responsive behavior.

## 8. Open questions for review

1. **Dialog section title.** Resolved as proposed: the Export dialog section
   stays **"3D views"** (naming the *page type*) while the pane is "Saved
   views" (naming the *objects*) — the shipped dialog keeps the "3D views"
   label. The one-string rename to "Saved views" remains available if the
   split ever reads as two features; the page-type framing would then live
   only in the PDF itself.
2. **Per-row Export image.** Pull the deferred download action into Phase B
   after all? It's the only §3.3 capability this spec doesn't deliver.
3. **Regeneration cadence.** Is ~2s edit-quiet debounce right on iPad, or
   should the pane regenerate only on open/focus (never live during edits)?
4. **Rail icon.** Resolved: shipped with `BookmarksSimpleIcon` (the proposed
   option), preserving the pairing with the `BookmarkSimpleIcon` on the Save
   view action. Alternatives (`CameraIcon`, `StackIcon`) read more literal but
   would have broken that pairing.
5. **Save view's home.** Resolved: moved to the 3D camera toolbar
   (`ThreeDCameraTools`), joining Overview / Eye level / Focus selection
   behind a hairline divider. Camera actions now live together, and the
   pane is where saved views are *found*. See §9 for the full restructure.

## 9. Export menu restructure (decided and implemented)

Recorded here because §8.5 depended on it. The question on the table was
whether the Export button should split into two topbar buttons (outputs vs
package). **Decision: no — one Export button, restructured menu**, plus a
separate move that the original framing didn't anticipate (see below).

Three reasons against splitting:

- Topbar space is already contested (the toolbar has five density tiers
  fighting for it).
- Two sibling buttons split around the word "export" force the user to learn
  which button owns which output *before* clicking; a grouped menu teaches at
  the point of choice.
- Frequency: image and PDF are recurring deliverables; the `.sightlines`
  package is occasional backup/handoff, and occasional actions don't earn
  top-level chrome.

The real problem isn't button count — the menu mixes three altitudes (*a
picture of this view*, *a document of the project*, *the project file
itself*) plus one item that isn't an export at all (Save view). Proposed
restructure:

1. **Keep the image and PDF groups as the menu's core.** Trim the redundant
   copy: today "Export image" (group label) + "Export image (PNG)" (item) +
   "Export image of 3D view" (subtitle) says the same thing three times. The
   PNG/JPG pair could collapse to one item — that is literally export-spec
   §16's one open item (inline format choice vs. remembered preference).
2. **Reframe the package group as what it is** — project backup/portability,
   not another output. Retitle to "Project backup," possibly collapsing
   Standard/With originals into a submenu. Keep it *in* this menu rather than
   exiling it: PRODUCT.md principle 5 wants portability visible in the
   experience, and it's already double-homed (Settings has a package-export
   affordance too).
3. **Move Save view out** to the 3D camera cluster, per §8.5 — camera actions
   together, now that the pane (§4) is where saved views are found.

**What actually shipped — a hybrid, not the plan above.** Rather than
"keep the image group in this menu, trimmed" (point 1), the current-view
snapshot action became its own topbar button (`CameraIcon`, beside Export;
a caret-triggered PNG/JPG split in 3D) and left the menu entirely. This is
not the outputs-vs-package split this section argued against — that split
was rejected because it forces the user to learn *which button owns which
output* before clicking, organized around the word "export." This split
instead separates by verb: "capture what's on screen right now" (snapshot
button) vs. "produce a project-level document or file" (Export menu). The
Export menu is now project-level only: Export PDF… first, then a "Project
backup (.sightlines)" submenu holding Standard / With originals / Without
images (point 2, collapsed to a submenu as proposed). Save view moved to
the 3D camera toolbar per point 3 and §8.5.

Status: implemented (feat/export).
