# Cloud Sync Plan — cross-device Dropbox sync

Design settled 2026-08-19. **Stage 1 (cloud project browser) built 2026-08-19**
(`feat/cloud-project-browser`, committed `8e7566f` + review-fix follow-up; see
`docs/status.md`); stages 2–4 are not built. This doc records the agreed architecture and staging so implementation
sessions can start from decisions, not re-derivation. It extends the shipped backup system described in
`docs/cloud-backup-providers.md` and supersedes that doc's "explicit future decision
required for conflict handling" — the decision is now made.

## Problem

Dropbox backup today is upload-only (the scopes deliberately exclude
`files.content.read`), so there is no way to pull a project onto another device.
In practice the user works around this by sending themselves share links — and every
share-link open forcibly mints a new project UUID (`forceProjectCopy`), which creates
a new `/backups/<Title> — <id8>/` folder with its own five-copy retention. Working on
one show across two devices therefore produces same-title, different-suffix fork
clusters that accumulate indefinitely (`/shares/` is never pruned, and deleting a
project locally never touches Dropbox).

Root cause: share links are being used as a poor-man's sync. The fix is a real pull
path, not smarter cleanup.

## The core decision

> **Sightlines does not merge exhibition layouts.** When two versions of the same
> project meet, the curator chooses which complete layout to use, saves both as
> separate projects, or postpones the decision. Artwork-library differences are
> reviewed separately, because artwork records may be shared across projects.

No wall-by-wall, room-by-room, or placement-by-placement diffing — ever. The layout
document is atomic. This keeps the system understandable (it is Dropbox's own
conflicted-copy model) and avoids building a merge engine for a single-user
cross-device tool. Real-time multiplayer remains explicitly out of scope
(`docs/plan.md` §12).

The artwork library is a separate layer: even a whole-project "use the other version"
still reconciles incoming artwork records against the local library through the
existing import conflict dialog. That dialog is library reconciliation, not layout
merging — its `mine` / `theirs` / `both` resolutions (including `both`'s
new-id-and-remap behavior in the import finalizer) are reused as-is. Copy should
explain that replacing an artwork record affects every project that uses that work.

## Dropbox layout: three separate concepts

| Purpose | Location (App Folder-relative) | Identity behavior |
|---|---|---|
| Synced project (canonical head) | `/projects/<full-project-id>/current.sightlines` | Same identity across the owner's devices |
| Recovery history | `/backups/<Title> — <id8>/…` (existing) | Immutable timestamped versions, keep 5 |
| Shared snapshot | `/shares/…` (existing) | Frozen handoff; always opens as a copy |

`/backups` and `/shares` keep their current contracts. Sync adds `/projects` as a
new, third concept — one canonical file per project, full UUID in the path (the
8-char folder suffix stays a backup-folder concern only).

## Sync mechanism

- **Revision-conditional writes.** Each device records the Dropbox `rev` of the
  canonical file its local copy is based on. Uploads use `WriteMode.update` with
  that rev and **autorename off**: if the remote has moved on, the write fails
  loudly as a conflict instead of overwriting or spawning `(1)` files. Timestamps
  are never used to establish ancestry (clocks disagree; upload order ≠ lineage).
- **Sync metadata**, persisted per project (IndexedDB, not localStorage), bound to:
  Dropbox **account ID** (not display name), file id/path, last accepted remote
  `rev`, the local content fingerprint corresponding to that revision, last
  successful pull/push timestamps, and a sync-protocol version. Binding to the
  account ID prevents stale bookkeeping being reused after reconnecting the browser
  to a different Dropbox account. The 32-bit backup fingerprint is a dirty-check
  heuristic, not sync lineage — sync lineage is the `rev`.
- **State machine**, evaluated on project-manager open, project open, window focus,
  manual refresh, and immediately before every upload:

| Local vs accepted base | Remote rev vs accepted base | Action |
|---|---|---|
| Unchanged | Unchanged | Synced |
| Changed | Unchanged | Upload via revision-conditional write |
| Unchanged | Changed | Download, validate, snapshot locally, then replace |
| Changed | Changed | Stop; present the whole-project conflict |
| Any | Linked file missing | Treat as deletion/conflict; never silently recreate |

- **Visible states**, because the tab-hidden flush is fire-and-forget and may not
  finish before unload: "Changes waiting to sync" / "Synced" / "Needs review".
  Device handoff is made reliable by the pull-check on open/focus plus the guarded
  write — not by trusting the unload-time upload.

## Conflict UX

Naming rule: always name the **direction** of replacement in project language, never
filesystem language. "Replace the project on this device" / "Replace the version in
Dropbox" / "Save both as separate projects" — never "override the file".

**Manual file import**, when the incoming package matches an existing local project id:

- **Save as a new project** (safest, default)
- **Replace the project on this device**
- **Cancel**

**Sync conflict** (both sides changed since the accepted base):

- **Use the Dropbox version** — replace this device's copy
- **Keep this device's version** — replace the version in Dropbox (guarded write;
  if the remote advanced again while the dialog was open, the conditional write
  simply fails and re-conflicts — no extra recheck machinery needed remotely)
- **Keep both versions**
- **Not now** — pauses sync for that project and shows a quiet persisted
  "Needs review" state (stored in sync metadata so a reload doesn't re-prompt)

**Keep both** semantics: the *divergent local copy* is saved as a newly named,
**unlinked** local project (sync off until deliberately enabled — it keeps
referencing the shared library artworks, so no artwork work is needed for the fork
itself); the Dropbox version pulls into the original, Dropbox-linked identity. The
canonical remote project is never silently overwritten by the fork. Artwork review
fires only on the pull, like any other pull.

In both contexts, the artwork-library review follows the project-level choice, only
if artwork records actually conflict.

## Replace mode is real new work

The current import commit path never overwrites anything — that is why
`packageSlice.ts`'s commit carries a "No recovery snapshot" comment, and why the
commit sequence is a non-atomic multi-step write (project record → assets →
artworks → repair re-persist). That rationale inverts the moment a replace mode
exists. Prerequisites for any replacement, in order:

1. Validate the entire incoming package (existing untrusted-package pipeline).
2. Resolve artwork conflicts **before** changing anything.
3. Create a recovery snapshot of the existing project (existing
   `projectSnapshots` store).
4. Re-check that the user hasn't switched projects or edited the target while the
   dialog was open.
5. Replace as one operation; if any prerequisite fails, the existing copy is
   preserved untouched.

## Trust and safety rules

- **Share links stay fork-only forever.** A matching project UUID inside an
  untrusted package proves nothing (anyone can craft it). A match may produce an
  informational "a project with this identity already exists on this device" — it
  never authorizes replacement. Replacement trust requires the project having been
  opened from the authenticated Dropbox account with its file id, account id, and
  rev recorded.
- **`/shares/` is never auto-pruned.** Share files back active links previously
  sent to collaborators; retention-style cleanup would silently kill them. Cleanup
  = reuse the existing link when project content is unchanged, plus a "Manage
  shared links" view with per-link revoke. (Optional clearly-stated expiration,
  later.)
- **Cloud-only projects are "Not on this device", never "orphaned".** A
  Dropbox-only project may be exactly what another device created and this one
  wants to open.
- **Deletion tiers**: v1 ships "Remove from this device" and (optionally) "Archive
  in Dropbox". "Delete everywhere" needs a remote tombstone/generation marker so
  an offline device can't resurrect the project — **deferred from v1**.
- **No auto-inference over legacy forks.** Same-title `/backups` folders are *not*
  assumed to be duplicates. The user designates one local copy as canonical per
  fork cluster (creating its `/projects/` file); legacy folders are left alone
  until manual cleanup.

## Fidelity promise (v1)

Auto-backup and shares build `mode: "display"` packages — original image bytes are
omitted. v1 sync keeps display tier, with this explicit promise:

> Dropbox sync includes the complete exhibition layout and optimized working
> images. Original image files remain on the device where they were added.

A device that already holds originals keeps them (asset blobs are stored per-tier;
pulls never delete tiers already present). A new device receives working-image
quality; the practical limitation is original-resolution export from that device,
not ordinary layout editing. Full-fidelity sync is the content-addressed-assets
phase (stage 4), not a v1 promise.

## Staged roadmap

1. **Cloud project browser (read-only semantics).** Add `files.content.read` to the
   scopes (reuse the existing scope-upgrade re-auth path — users reconnect once);
   list Dropbox backups in the project manager; "Open latest backup" when the
   project is absent locally (identity-preserving import); preview / save-as-copy
   when it already exists locally — no replacement yet. This alone kills the
   self-share-link workflow that generates fork clutter.
2. **Canonical single-user sync.** `/projects/<id>/current.sightlines`,
   account-bound sync metadata, rev-conditional writes, the state machine and
   conflict UX above, validation before pull, recovery snapshot before every
   replacement, replace-mode import path with its prerequisites. Poll points:
   project-manager open, project open, window focus, manual refresh, pre-upload.
   No server, no realtime.
3. **Sharing management + cautious cleanup.** Manage-shared-links view,
   reuse-link-when-unchanged, legacy `/backups` cleanup view that surfaces
   not-on-this-device folders and same-title clusters for *manual* judgment.
4. **Content-addressed cloud assets (optional).** Store each asset once, have
   project documents reference by hash — removes the every-edit-reuploads-a-full-
   zip cost and enables full-fidelity sync. Separate architectural phase; only if
   Dropbox space is a real problem.

Stage 1 should be described in UI as "cloud projects / restore", **not** "sync" —
the sync label starts at stage 2.

## Out of scope, permanently or for now

- Structural merge of walls/rooms/placements/saved views (permanently — the core
  decision above).
- Real-time multiplayer co-editing (permanently, per plan §12).
- "Delete everywhere" with tombstones (deferred past v1).
- Multi-account sync / sharing-based sync between different Dropbox accounts
  (App Folder access is single-account by nature; sharing to others stays
  snapshot-handoff).
