# Dropbox storage and recovery plan

Status: planning only; no implementation authorized by this document.
Created: 2026-11-09.

This plan extends [Cloud Sync Plan](cloud-sync-plan.md) and
[Cloud Backup Providers](cloud-backup-providers.md). Those documents describe the
existing system; the changes below are proposed unless explicitly marked agreed.

## Goal and agreed constraints

Make multiple projects practical on a free 2 GB Dropbox account, without asking
users to identify expendable files by navigating Dropbox folders. Preserve reliable
cross-device sync, recovery, and frozen shared snapshots.

User preferences confirmed during planning:

- Do not make a paid Dropbox upgrade the solution.
- Prioritize reducing repeated image storage as near-term work.
- Shared snapshots remain available indefinitely by default, subject to the owner
  retaining the file, Dropbox access, and the service remaining available.
- Offer optional automatic snapshot removal after 30 days, 90 days, or a custom
  period. Removal may run when Sightlines is open and connected to Dropbox; no
  always-running service or exact-deadline deletion is required.
- Explore smaller shared snapshots and image quality choices.
- Consider activity information to help users select old snapshots for removal.
- Implementation is a later task. This document does not authorize cleanup of
  personal files, migration, or code changes.

Still undecided: automatic backup count, whether history should span days/weeks,
milestone behavior, and the default image quality for new shares.

## Evidence from the supplied Dropbox export

Source: the user's `Downloads/Sightlines.zip`, inspected read-only on 2026-11-09.
This is an exported snapshot, not a live account inventory. Sizes below are decimal
MB; Dropbox and operating systems may display different units.

| Category | Packages | Bytes | Approximate MB |
| --- | ---: | ---: | ---: |
| Current synced projects | 7 | 205,448,650 | 205 |
| Automatic backups | 61 | 1,816,565,545 | 1,817 |
| Shared snapshots | 3 | 103,982,434 | 104 |
| Total | 71 | 2,125,996,629 | 2,126 |

Inspection opened every nested `.sightlines` ZIP, read its manifest, and hashed
the actual bytes of each asset entry with SHA-256. All 71 packages were readable.

- The packages represent 17 distinct project IDs, including seven synced heads.
  Similar titles and `(copy)` suffixes occur across different IDs.
- Embedded image payload totals 2,114,544,786 bytes across 24,142 image entries.
  There are only 735 distinct image blobs, totaling 60,213,220 bytes. Approximately
  97% of the image payload repeats bytes already present elsewhere in the export.
- Deduplicating within each project ID, but not between projects, would retain
  about 500 MB of images. Deduplicating across the account's Sightlines projects
  would retain about 60 MB. Related project copies make this distinction material.
- These figures concern image payload only. They are not a forecast of final
  storage after migration; manifests, protocol metadata, recovery records, shares,
  and temporary migration overlap also occupy space.
- No project exceeds five backups. The existing per-project cap appears to work
  in this snapshot, but older project identities retain their own allowances.
- Five backups for `NP2027 - 10.21` span about 25 minutes and occupy about 184 MB.
  Counting copies alone does not ensure history across a useful period.
- The three shared snapshots are approximately 32–37 MB and use display mode.
  The user's reported 65 MB shares are not in this export.
- Keeping the newest two backups per project ID would remove 1,023,298,801 bytes
  from this snapshot, preserving all heads and shares. This is a measured scenario,
  not a recommendation that these particular files are safe to delete now.

Shares are only 5% of this export. Backup image duplication is the primary target.

## Existing behavior and implementation entry points

| Concern | Current implementation |
| --- | --- |
| Provider methods and remote operations | `src/app/cloud/provider.ts`, `dropbox.ts` |
| Paths, scopes, five-copy retention selection | `src/app/cloud/dropboxAuth.ts` |
| Backup and share package creation | `src/app/store/cloudBackupSlice.ts` |
| Revision-conditional cross-device sync | `src/app/store/cloudSyncSlice.ts` |
| Cloud project listing and opening | `src/app/store/cloudProjectsSlice.ts` |
| Automatic backup timing | `src/app/hooks/useCloudBackupScheduler.ts` |
| Package building and import | `src/domain/package/` |
| Image derivatives | `src/domain/assets/imageIntake.ts`, `browserImageProcessor.ts` |
| Share UI and import | `src/app/components/dialogs/ShareProjectDialog.tsx`, `SharedProjectImportDialog.tsx` |

Current App Folder-relative locations:

- `/projects/<full-project-id>/current.sightlines`: canonical synced project.
- `/backups/<title> — <id-prefix>/…`: timestamped recovery packages, keep five.
- `/shares/…`: independent, frozen packages, no automatic retention.

Cloud sync, backups, and shares currently build display-mode packages containing
display images and thumbnails, excluding originals. Newly processed display images
use WebP at quality 0.82 with a maximum 1800-pixel longest edge; thumbnails use 400
pixels. Existing/imported assets must not be assumed to match today's processor.

Backup pruning runs after a successful upload. An already-full account may reject
the upload before cleanup runs. Pruning is best-effort and failures are not clearly
reported. Local project deletion does not establish that cloud data is disposable.

## Proposed design

### 1. Store image bytes once for internal cloud storage

Investigate an account-wide, content-addressed image store inside the Sightlines
App Folder. Hash the actual encoded bytes of each image tier, not artwork IDs,
filenames, or original-image metadata. Identical bytes can be reused across project
copies while distinct encodings and quality tiers remain distinct blobs.

Store lightweight project/recovery manifests referencing those immutable blobs.
Keep the local-first editing model and whole-project conflict choices. Preserve
Dropbox revision-conditional publication and account-bound sync metadata.

An internal cloud representation may differ from a portable `.sightlines` ZIP.
Manual exports remain self-contained, and old packages remain importable. Initially
keep shared snapshots self-contained too; sharing should not depend on the lifetime
of the sender's current project or recovery history.

Protocol requirements before implementation:

- Upload and verify all required blobs before publishing a manifest that uses them.
- Publish the authoritative project reference with a revision-conditional write.
  Failed uploads must leave the previous complete version usable.
- Treat indexes as rebuildable caches, not the sole proof that data exists or is
  unreferenced. Resolve records by full project ID; title and eight-character
  prefixes are display/discovery aids, not deletion authority.
- Validate remote manifests and referenced blobs, constrain references to the
  expected namespace, and enforce bounded download/assembly limits.
- A missing/corrupt blob must produce an actionable recovery error, never silently
  replace a working local project with incomplete data.
- Prove safe operation with two devices publishing simultaneously. A local lock
  or a single scan of current references is insufficient for remote garbage
  collection: an in-flight writer may be about to publish a reference.
- Specify coordination for publication and deletion, interrupted operations,
  leases or equivalent protection, grace periods, and fresh reachability checks.
  Delay automatic blob deletion until that protocol is demonstrated safe.
- Recovery versions and pinned milestones remain roots for all their referenced
  images. Do not automatically expire an offline machine's protection without a
  defined revalidation/re-upload path before it publishes again.

Exact remote paths and protocol versioning are outputs of the technical design,
not settled by this document.

### 2. Manage storage by project inside Sightlines

Show one identifiable project row with title, thumbnail where available, stable
identity details when needed, current synced status, recovery versions, and shares.
Show bytes by category and account capacity where supported. Do not imply that
Sightlines can inspect unrelated Dropbox files.

Offer separate actions for cleaning recovery history, removing shared snapshots,
and deliberately removing a cloud project. A cleanup preview must identify retained
versions, affected links, estimated reclaimable bytes, and scope across devices.
Shared blobs require shared/unique accounting; do not sum logical project sizes and
present that as actual physical storage or guaranteed reclaimable space.

Routine cleanup never deletes a current synced head, pinned milestone, or persistent
share. Missing from this device, an old timestamp, a similar title, and identical
images are not evidence that an entire project is expendable. Keep local deletion
separate from removal in Dropbox. Offer a verified self-contained archive before
deliberate cloud-project removal, and account for another device recreating data.

Cleanup runs independently of uploads, including at quota exhaustion. Process only
explicitly eligible records, recheck changed candidates, report partial failures,
and refresh actual usage afterward. A batch deletion is not an atomic transaction.

### 3. Make retention configurable and useful

Proposed interim option: retain two recent recovery packages instead of five, with
a preview before applying it to existing data. Do not change the default until the
user chooses the desired recovery model.

Evaluate recent versions plus daily/weekly spacing and user-pinned milestones.
Keep retention settings in Dropbox, bound to the account, so devices agree. Specify
how setting revisions, older clients, concurrent cleanup, and paused/offline devices
interact. Changing backup frequency alone does not reduce a full five-copy footprint.

Never delete the last known usable recovery point simply to attempt an upload.
Make cleanup failures visible without claiming a successful upload failed.

### 4. Add explicit share lifetime and image quality

Lifetime choices: keep until removed (default), remove after 30 days, remove after
90 days, or a custom period. Persist the policy remotely so either connected device
can process overdue removals. Record an explicit due date, distinguish it from
last activity, and recheck policy changes before deleting.

Explain that removal runs during a connected Sightlines session, stops the link,
and reclaims the snapshot's storage. No background credential service is required.
Existing shares remain persistent until the owner changes their policy. Saved
recipient copies are unaffected. Native Dropbox link expiration is not the free
account solution, and expiring a link alone does not delete its file.

Proposed quality choices:

| Choice | Purpose |
| --- | --- |
| Compact | Smaller derivatives for general viewing and discussion |
| Standard | Existing display-tier quality for closer inspection |
| Include originals, when available | Explicit source-image handoff; larger package |

Generate compact derivatives for the snapshot without degrading stored project
images. Choose dimensions/quality after visual comparison on fine detail, text,
transparency, frames, and close 3D views. Show estimated package size before upload;
do not promise savings before measuring. Surface unavailable originals clearly.

If unchanged content is shared again with the same quality and compatible lifetime
policy, offer reuse of an existing snapshot. Never silently update a frozen share,
change an existing link's lifetime, or apply a lower quality to old snapshots.

### 5. Treat activity as an optional later enhancement

Do not assume Dropbox's shared-link metadata provides reliable last-viewed data.
Sightlines could record a minimal successful-download timestamp through its share
flow, requiring persistent server-side metadata and an explicit privacy design.
It cannot observe subsequent use of a recipient's saved copy or every direct
Dropbox access. Historical activity starts unknown, not at zero.

Use wording such as “Last downloaded through Sightlines,” distinguish owner tests
and automated requests where practical, and avoid treating a request as proof a
person viewed the project. Offer inactivity-based review suggestions, not automatic
deletion of persistent links. Defer this work unless its value justifies new state.

## Migration and compatibility gates

Migration is material work, especially when the account is already full:

1. Inventory existing packages, identities, policies, and live revisions without
   changing anything. Preserve existing share files and URLs.
2. Define old-client behavior before publishing a new representation. Older
   clients must not overwrite migrated state, recreate legacy backups indefinitely,
   or garbage-collect data they cannot understand. Choose an enforceable rollout
   strategy; a version field alone does not stop an unaware old client.
3. Estimate temporary headroom and choose a resumable, bounded migration unit.
   Account-wide image upload can itself exceed available quota. If necessary,
   offer user-reviewed backup cleanup or a verified local archive first; never
   delete the only remote recovery copy to make speculative room.
4. Upload referenced images and a manifest, then verify reconstructed project
   content, image hashes, identity, and revision behavior. Persist migration progress
   remotely so another device can resume safely.
5. Remove eligible legacy internal packages only after durable verification and
   explicit migration policy permit it. Retain recovery/rollback information until
   the replacement is usable across devices. Do not maintain two competing heads.
6. Handle interruption, quota failure, reconnect to a different account, remote
   edits, deletion, and a stale second device without losing either version.

Evaluate using Dropbox's native revisions to reduce standalone recovery packages
as an alternative or complement. Revision history does not count against quota,
but availability depends on the plan's recovery window and needs a usable restore
flow. Do not replace recovery guarantees solely on that assumption.

## Implementation phases and exit criteria

Each phase is a separate reviewable chunk with relevant tests and uncommitted work
for manual review. No phase begins solely because this plan exists.

1. **Technical design and measurement.** Build a disposable prototype of shared
   blobs plus project manifests. Compare account-wide and per-project savings,
   network/file-operation costs, reconstruction time, quota headroom, and legacy
   compatibility. Settle concurrent publication/collection and migration protocols.
   Exit: reviewed design, measured storage results, and failure-case evidence.
2. **Storage inventory and safe interim cleanup.** Add category/identity-aware
   inventory, previews, independent cleanup, and selected retention settings.
   Exit: current projects and persistent shares remain protected; full-account and
   partial-failure flows work; predicted and actual reclamation are reconciled.
3. **Deduplicated internal storage and migration.** Implement sync/recovery format,
   reconstruction, compatibility handling, and resumable migration. Enable automatic
   blob collection only after concurrency safety is established.
   Exit: cross-device round trips and recovery preserve every retained version;
   substantial savings require no image quality loss.
4. **Share controls.** Add remote lifetime policies, connected-session removal,
   quality choices, size estimates, and compatible snapshot reuse.
   Exit: old links remain unchanged; optional deletion works across machines;
   compact quality passes visual review.
5. **Optional activity suggestions.** Revisit only after the core storage work.

The first prototype is the primary near-term investigation. The manager can ship
before migration so users have visibility and a safe way to create headroom.

## Verification required during implementation

- Unit tests: byte-hash reuse, distinct tiers, reference validation, retention,
  policy revisions, identity matching, storage accounting, and date eligibility.
- Provider/integration tests: interrupted upload/publication, missing blobs, quota,
  pagination, partial deletion, account changes, simultaneous writers/collectors,
  stale clients, and resumable migration.
- Package round trips: old packages still import; portable exports remain complete;
  restored manifests preserve project and artwork/library reconciliation behavior.
- Playwright specs using `e2e/fixtures.ts`: cleanup preview and consequences,
  protected current projects, restore, share quality/lifetime, and reconnect flows.
  Use `npm run test:e2e` for committed browser-level regression verification.
- Measure logical and physical usage on an authorized disposable dataset; do not
  use the user's original Dropbox folder for destructive testing. The supplied
  ZIP is a private evidence source, not a repository fixture or committed asset.
- Before shipping, run relevant checks/tests, `npm run check:nuls`, and the build
  with its bundle-size budget. Update existing runbooks when shipped behavior
  changes; do not rewrite them to describe proposed features as available.

Success means users can understand and reclaim space without guessing which
working project to delete, while repeated project edits stop creating repeated
stored image payloads. Exact capacity targets follow prototype measurements.

## External references to recheck before implementation

- [Dropbox App Folder permissions](https://www.dropbox.com/developers/reference/developer-guide)
- [Shared-link listing and permissions](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/sharing/list-shared-links)
- [Native link-expiration plan restrictions](https://help.dropbox.com/share/set-link-permissions)
- [Version history and quota](https://help.dropbox.com/delete-restore/version-history-overview)

The current scopes cover the basic inventory/delete operations already used by
backup pruning. Inspecting existing shared links requires evaluating `sharing.read`
and a one-time reconnect for older grants. Reverify API scopes and account-plan
restrictions when implementation starts.
