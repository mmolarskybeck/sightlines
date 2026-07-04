⏺ Here's my read after going through both docs and the source tree.

  Where you are: MVP 1A is done, 1B is done, and you're further into 1C than
  progress.md's "Later" section suggests — openings and collision validation
  (both 1C items) just landed. What's genuinely left in MVP1:
  multi-select/grouping/group drag, equal distribution, floor objects, the 3D
  preview, and checklist sorting/fields. The vertex-reshape item is real but
  gated on designing a reshape mode, so it's not the natural next move.

  Best next slice: multi-select → group drag → equal distribution, as one arc

  This is the highest-leverage next feature work for three reasons:

  1. The machinery is hot. You just built the exact substrate it needs — the
  pointer-drag/local-preview/one-commit lifecycle, the shared resolveArtworkSnap
  path that openings and artworks already share, and transaction-bounded undo.
  Group drag is "the same drag, N objects, one command"; group-centerline snap
  is one more target computation into the existing resolver. Doing this now
  while that context is fresh is much cheaper than after a detour into 3D or UI
  work.
  2. It completes the elevation editing story. Right now a curator can place and
  nudge single works; multi-select + distribute-evenly is the plan's own
  callout (§8) as "one of the most common curatorial moves." After this slice,
  the elevation view is functionally done for MVP1, which makes it a stable
  target for any visual pass.
  3. Equal distribution is nearly free once selection exists — pure domain math
  plus one applyEdit command, very testable, very your-architecture.

  Then 3D preview as the slice after. It's read-only, architecturally
  independent (a third disposable projection of the same data), and it benefits
  from placements and openings being complete — doors can render as actual gaps.
  It's also the single biggest "this feels like the real product" moment left
  in MVP1, which matters given how you're feeling about the app's look.

  On the UI/UX pass: yes, but a bounded structural one — not a polish pass

  The instinct "don't polish while features are still landing" is right, but it
  applies to polish (micro-interactions, empty-state finesse, theming details),
  not to structure. The case for doing a structural pass now rather than later:

  - The information architecture is essentially complete. Checklist sidebar,
  plan/elevation tabs, gallery/wall list, three inspectors, toolbar — every
  major MVP1 surface except the 3D view already exists. A
  layout/hierarchy/density pass now won't be thrown away; the same pass in three
  months just covers more components.
  - Roughness compounds. Every new feature (selection toolbar, distribution
  controls, 3D view chrome) gets bolted onto whatever shell exists. If the shell
  has coherent idioms — a panel pattern, a form-row pattern, a toolbar pattern,
  spacing/type tokens — new features inherit them for free. If it doesn't, each
  feature adds to the restyle debt.
  - You've already started. The design system configuration + global styles
  commit means the token layer exists; a pass now capitalizes on that instead of
  letting it drift.

  What I'd scope it to: design tokens finalized, app-shell layout (panel widths,
  toolbar organization, tab treatment), visual hierarchy inside the inspectors
  and checklist, and consistent form-field/button/badge idioms. Explicitly out
  of scope: animation, dark-mode finesse, onboarding, tablet adaptation (that's
  MVP3 by design). Aim for "restrained, dense, task-focused" per your own design
  notes — one or two focused sessions, not a redesign project.

  Suggested order: structural UI pass first (so the selection/distribution UI
  lands into a coherent shell), then multi-select/group/distribute, then 3D
  preview, then a second, lighter polish pass at the MVP1→MVP2 boundary — which
  pairs naturally with MVP2's "prominent save-backup UX" item, since that's UX
  work anyway.

  If you want to start the structural pass, I'd kick it off with the impeccable
  skill against the running app so the critique is grounded in what actually
  renders. Want me to do that, or start on the multi-select slice instead?

✻ Cogitated for 1m 12s

※ recap: You asked what to build next in Sightlines. I recommended a bounded structural UI pass first, then the multi-select/group-drag/equal-distribution slice, then 3D preview. Next action: tell me which to start, UI pass or multi-select. (disable recaps in /config)