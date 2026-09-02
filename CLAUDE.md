# CLAUDE.md

Sightlines is a private-by-design exhibition planning tool: scaled room plans, wall elevations, artwork placement, and a derived 3D preview. Browser-first and local-first (Vite + React + TypeScript, Zustand, Zod, IndexedDB, React Three Fiber). No accounts, no Sightlines backend; optional Dropbox backup, share links, and cross-device sync through the user's own account. The author is a working curator dogfooding it on real exhibitions.

## Working rules

@AGENTS.md

Those rules apply to every session: feature branches named `feat/…`, leave completed work uncommitted for manual review, run the relevant checks before calling a chunk done, keep doc changes proportional, never edit skill packages under `.claude/skills/` or `.agents/skills/` during feature work.

## Where things are documented

Read the owning doc before changing an area, and update it when a shipped change makes it wrong.

| Doc | Owns | Update when |
| --- | --- | --- |
| `docs/status.md` | The single living status doc: current read of the app, dated sections per shipped round, Near-Term Order, follow-ups, deferred list. | A feature, fix round, or refactor ships. Add a dated section or bullet; refresh "Last refreshed" and Near-Term Order. |
| `docs/plan.md` | Product/architecture plan and roadmap source of truth: principles (§2), data model (§4), units/snapping (§5), sharing (§6), undo (§7), decisions (§8), roadmap (§9), storage risks (§11), import safety (§13). | An architecture decision, schema shape, or roadmap position changes. Roadmap status lives in §9. |
| `PRODUCT.md` | Users, positioning (workflow-first), constraints, design principles. | Positioning or audience changes — rarely. |
| `DESIGN.md` | Visual system: tokens, component grammar, overlay rules. | The visual system itself changes, not for one-off component tweaks. |
| `README.md` | Public overview, feature list, setup, roadmap summary. | A headline capability lands or the roadmap summary drifts. |
| `docs/export-spec.md` | PNG/PDF/checklist export behavior, dimension-line rules, documented PDF-vs-SVG divergences (§16). | Export behavior changes. |
| `docs/package-format.md` | `.sightlines` package format and import/merge rules. | The package manifest, tiers, or import behavior changes. |
| `docs/cloud-sync-plan.md` | Cross-device sync design, conflict UX, staged roadmap (stages 1–2 shipped, 3–4 designed). | Sync behavior or the remaining stages change. |
| `docs/cloud-backup-providers.md` | Dropbox scopes, rollout staging, production-approval gates, other providers' constraints. | Scopes, provider state, or rollout stage change. |
| `docs/deployment.md` | Cloudflare Workers deploy, env baking, Vercel mirror. | Deploy mechanics change. |
| `docs/privacy-preserving-analytics.md` | Analytics policy contract and event allowlist. | Any new telemetry event — update allowlist and public disclosures before it ships. |
| `docs/framing-dimension-contract.md`, `docs/measurement-tool-spec.md`, `docs/saved-views-collection-spec.md`, `docs/shared-openings-stage-6-8.md`, `docs/interaction-improvements-2026-08.md`, `docs/feedback-round-2026-08-28.md` | Feature contracts and decisions of record for those areas. | That feature's contract changes. |
| `docs/quick-todos.md` | Small open scraps that don't fit the roadmap. | Crossing one off or adding one. |
| `docs/archive/` | Frozen: build log through 2026-07-10, `3d-preview-spec.md`, `room-shapes-spec.md`, `icon-migration.md`. | Never — superseding rules are noted in `docs/status.md` instead. |

## Commands

```bash
npm run check        # tsc for app + worker
npm run test         # vitest (~3.7k tests, ~20 s)
npm run build        # tsc + vite build + chunk-graph assertion (three/pdf/fontkit/xlsx must stay lazy)
npm run test:e2e     # Playwright (chromium on 5199; storage specs also on webkit via 5198)
npm run check:nuls   # rejects raw NUL bytes — agents have embedded them in string literals before
npm run dev          # verify served code on 127.0.0.1, not localhost
```

Ad-hoc in-app verification uses the local `verify` skill (`.claude/skills/verify/driver.mjs smoke --port 5199`). One-off Playwright scripts live under `.playwright-mcp/` (gitignored) so `import "playwright"` resolves.

## Code map

- `src/domain/` — pure model, geometry, snapping, scene builders, schema + migrations, package build/extract/import. Never imports from `src/app/`.
- `src/app/store.ts` — the kernel: `applyEdit` undo/redo spine, `persist`, `setDocument`, `updateArtwork`. Behavior lives in `src/app/store/*Slice.ts` (placement, sharedOpening, floorObject, roomGeometry, artworkIntake, selection, arrange, documentMeta, projectManager, package, cloudBackup, cloudProjects, cloudSync).
- `src/app/components/<feature>/` — dialogs, elevation, imports, inspectors, library, measurement, panels, placement, plan, privacy, shared, three, toolbar, topbar, ui (shadcn primitives).
- `src/app/export/` — PNG snapshots, `pdf/`, `checklistPdf/`, `deliverExport.ts`. `src/app/cloud/` — provider seam (`provider.ts`) and the Dropbox implementation.
- `worker/` — Cloudflare Worker (static assets, SPA fallback, share-link relay). `landing/` — Astro marketing site at the apex. `e2e/` — Playwright specs. `fixtures/` — import corpora and the 10-room/200-work benchmark.

## Traps worth knowing before editing

- Every hook in `App.tsx` must sit above the `if (!project)` early return; `App.test.tsx` renders the real App and catches this.
- Additive optional schema fields do not bump the schema version; absence is often meaningful (`checklistView`, `imageFaces`, `monitorSupport`, `floorMemory`) — never default them in.
- Exports must consume `buildPlanScene`/`buildElevationScene` and the shared glyph modules; never re-derive geometry in an export path.
- `scene3d.ts` is one-directional; map 3D hits back through floor-space projection, not by inverting the scene.
- Two tabs, sync, and imports never merge layouts — whole-project choices only (`docs/cloud-sync-plan.md`).
