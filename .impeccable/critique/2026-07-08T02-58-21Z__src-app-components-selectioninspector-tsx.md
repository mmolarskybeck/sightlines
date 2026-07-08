---
target: inspector
total_score: 31
p0_count: 0
p1_count: 2
timestamp: 2026-07-08T02-58-21Z
slug: src-app-components-selectioninspector-tsx
---
Method: dual-agent (A: adfde3afd9312c8c7 · B: a5bd8958171b2a680)

# Critique: Selection Inspector (right pane)

Target: `src/app/components/SelectionInspector.tsx` (+ ArtworkInspector, WallInspector, RoomInspector, OpeningInspector, FloorObjectInspector, LengthField, RoomDimensionFields)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | LengthField feedback is exemplary; successful commits only silently reformat — no in-panel save acknowledgement |
| 2 | Match System / Real World | 4 | n/a — fluent curator language throughout ("Space evenly", "Calculated", "Applies to every wall in Main Gallery") |
| 3 | User Control and Freedom | 3 | Escape neither reverts a field edit nor deselects; invalid length sticks with no in-field revert |
| 4 | Consistency and Standards | 3 | Destructive actions styled three ways; Opening/Floor inspectors borrow the 3-column artwork grid and break |
| 5 | Error Prevention | 3 | Good guards and two-step "Remove all", but "Delete door"/"Remove from wall" are one-click, no confirm |
| 6 | Recognition Rather Than Recall | 3 | Aspect-lock is a 14px unlabeled padlock — pure recall/hover |
| 7 | Flexibility and Efficiency | 3 | Steppers only in arrange fields; no keyboard delete; no fast deselect |
| 8 | Aesthetic and Minimalist Design | 3 | Clean restraint undercut by cramped Opening grid and dense enabled-arrange state |
| 9 | Error Recovery | 3 | Plain, specific messages; but invalid state shown by red helper text only, input border unchanged |
| 10 | Help and Documentation | 3 | Strong contextual help; explanations live only in hover tooltips (dead on iPad); global Help disabled |
| **Total** | | **31/40** | **Good — address weak areas, solid foundation** |

## Anti-Patterns Verdict

**Not AI slop.** Reads as a deliberately-built studio instrument: domain-real arrange modes, live imperial/metric conversion, uncertainty badges, gated bulk destruction. A user fluent in Linear/Figma-grade tools would trust this pane on first contact. The one "is this broken?" tell is a genuine CSS regression in the Opening/Floor inspectors, not generated-form blandness.

**Deterministic scan:** clean — `detect.mjs` returned **zero findings** across all 8 target files (exit 0).

**Browser injection evidence:** preflight mutation succeeded; injected detector reported 3 page-wide findings, **all outside the inspector**: `cramped-padding` on `.checklist-controls` (left checklist panel, `src/styles/global.css:1015`), plus `bounce-easing` and `transition: width` hits that don't exist anywhere in `src` (framework-level vars). Treat all three as out-of-scope for this target. Detector's own header said "2 anti-patterns" while printing 3 lines — internal tally bug in the detector, noted. Evidence tab was closed after collection; no overlay left open.

## Overall Impression

A genuinely trustworthy precision instrument with one visible wound. The LengthField primitive and the curator-first copy carry real credibility; the broken Opening/Floor two-field grid, inconsistent destructive treatment, and hover-only explanations (on a product that promises iPad parity) are what stand between 31/40 and mid-30s.

## What's Working

1. **`LengthField` is tool-grade** — focus hint with accepted formats, live unit-conversion hint, plain-language inline errors that preserve typed text, `aria-live`/`aria-invalid`/`aria-describedby`, commit-on-blur/Enter. This one primitive carries the pane's credibility.
2. **Copy speaks curator, not engine** — "Space evenly / From wall edges / Between works", "Calculated" companion readouts, "Applies to every wall in Main Gallery."
3. **Disclosure discipline** — controls appear only when meaningful (arrange session, aspect-lock, Apply/Cancel); destructive bulk action gated behind a two-step confirm.

## Priority Issues

- **[P1] Opening/Floor inspector grid is visibly broken.** `OpeningInspector` and `FloorObjectInspector` reuse `.artwork-dimensions-grid` (field / narrow-lock / field) for 2-field X/Y and W/H rows; "X (from wall start)" wraps to four lines beside a cramped input. The most literal "broken" tell in the pane, on a core editing surface. **Fix:** dedicated equal 2-column grid for two-field rows; shorten labels. **Command:** /impeccable layout
- **[P1] Inconsistent destructive treatment; quietest deletes are unconfirmed.** "Remove all" is red + two-step; "Delete door"/"Remove from wall" are grey one-click. Users can't predict which deletes are safe. **Fix:** one destructive language — confirm all object-removing actions or give an in-panel undo affordance; unify styling. **Command:** /impeccable harden
- **[P2] Aspect-lock undiscoverable.** 14px unlabeled padlock between Width and Height; hover-only meaning. **Fix:** "Lock ratio" label in the Dimensions heading or inline. **Command:** /impeccable clarify
- **[P2] Invalid length not reflected on the input itself.** Red helper text only; border stays normal/petrol; no Escape-to-revert. **Fix:** destructive border on `aria-invalid`; Escape restores last committed value. **Command:** /impeccable harden
- **[P2] Enabled arrange state exceeds working memory.** Mode segment + sub-toggle + field + readout + Apply/Cancel = 5–7 simultaneous controls. **Fix:** defer the secondary toggle until the primary value is touched. **Command:** /impeccable distill

## Persona Red Flags

**Alex (power user):** no keyboard delete; steppers only in arrange fields (inconsistent accelerator); Escape doesn't deselect; multi-select can't bulk-edit dimensions.

**Sam (accessibility):** mostly strong (real labels, aria wiring, visible petrol focus rings) — but error signalled by red text only; wrapped labels and 32px controls degrade at 200% zoom; the grey subject-type tag (~0.55 L) risks failing 4.5:1.

**Curator on iPad (project persona):** door/window/blocked-zone explanations live only in hover tooltips — unreachable by tap, despite PRODUCT.md's explicit no-hover requirement; touch targets below 44px (32px inputs, 14px lock, adjacent check/X confirm buttons); cramped Opening X/Y fields fiddly one-handed.

## Minor Observations

- Dimension placeholders truncate in narrow fields ("e.g. 24 1…").
- Read-only "Kind" renders as a disabled-looking input; plain text or a chip would read less broken.
- Placed artwork stacks two forms (ArtworkInspector + "Position on North wall") with a visible seam.
- "Room height" under a wall is conceptually off; the "applies to every wall" hint rescues it.
- "Calculated" tag's meaning isn't self-evident on first encounter.

## Questions to Consider

1. In plan view a wall is always selected and Escape can't clear it — should "deselect" become a real action, or should the empty state be removed as dead code?
2. The live unit-conversion hint is the pane's biggest trust moment — why doesn't it echo on Centerline and "Calculated" readouts too?
3. On iPad with no hover, how does a curator ever learn what "Blocked zone" means?

---

*Method note: Assessment A live-inspected all six inspector variants in its own browser tab; the enabled arrange state couldn't be triggered with sample data (its two artworks sit on different surfaces) and was assessed from source. Assessment B's scoped CLI scan was clean; its three browser findings were attributed page-wide, outside the target.*
