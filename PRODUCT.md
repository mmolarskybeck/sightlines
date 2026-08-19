# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Sightlines is for curators, exhibition planners, gallery directors, preparators, and small institution teams planning spatial layouts for exhibitions. They may be working on desktop at a desk, on an iPad in a gallery, or on managed institutional machines where installing native software is difficult. Their job is to move between checklist thinking and spatial thinking without surrendering privacy, precision, or speed.

## Product Purpose

Sightlines is a private-by-design exhibition planning tool for scaled room layouts, wall elevations, artwork placement, and simple 3D preview. Projects and images stay on the user's device in v1, with explicit backup/export paths instead of accounts or hosted media. Success means a user can start with either a room or a checklist, iterate non-linearly, trust snapping and measurements, pause and resume locally, and share a portable project package when needed.

## Positioning

The claim is workflow, not technology: a super user-friendly, intuitive way to plan exhibition layouts without having to use complex 3D or CAD software. Collaboration is deliberately non-technical — share a link to a project, a colleague makes edits to the exhibition plan and easily sends back a new share link or an exported PDF. Sightlines is designed around real museum and gallery workflows, making them simple for curators, artists, and small teams without specialist skills. Privacy and portability (local-first storage, portable .sightlines packages, the user's own Dropbox rather than a Sightlines server) support that simplicity; they do not lead it.

## Operating Context

Planning moves between a works checklist and spatial views (plan, wall elevations, 3D preview) in any order. Sharing and collaboration are file- and link-based: portable .sightlines packages, Dropbox shared-project links that a colleague opens, edits, and re-shares, and composed PDF exports (room plans, elevations, 3D views) for installation and handoff documents. Projects persist locally in the browser with optional backup to the user's own Dropbox. Checklists can arrive as spreadsheets from collections workflows.

## Capabilities and Constraints

Confirmed functionality: scaled rooms (rectangles and drawn outlines), shared walls, doors/windows/blocked zones, partitions, display cases, wall texts, artwork placement on walls and floors with snapping and dimension lines, measurement tools, 3D navigation, PDF/PNG export, spreadsheet checklist import, .sightlines package export/import with per-artwork conflict resolution, Dropbox backup and shared-link import. Constraints: browser-based with no install; no accounts; in v1 all project data and images stay on-device except user-initiated exports, backups, and share links. App analytics are consent-gated.

## Brand Personality

Calm, exacting, and humane. The product should feel like a serious studio instrument: quiet enough for repeated professional use, precise enough for installation planning, and approachable enough that a curator can sketch before every dimension is known.

## Anti-references

Sightlines should not feel like a CAD program, a SketchUp clone, a generic SaaS dashboard, or a collections-management database. It should avoid decorative complexity, marketing-page flourish, overbearing dark-mode theatrics, and visual metaphors that make the workspace feel less trustworthy than the measurements.

## Evidence on Hand

The maker is a working curator dogfooding Sightlines on real exhibitions. A 10-room / 200-work benchmark project ran acceptably in 2D and 3D. There are no external users, testimonials, case studies, or press yet; future work must not fabricate any. An onboarding sample-project walkthrough is planned.

## Design Principles

1. Treat project data as the source of truth; every view is a projection.
2. Support non-linear exhibition work: room, checklist, placement, metadata, preview, and export can happen in any order.
3. Make uncertainty visible without making it punitive.
4. Pair tactile editing with numeric precision everywhere measurements matter.
5. Keep privacy and portability visible in the product experience, not hidden in documentation.
6. Use state-aware density: incomplete records should teach and prompt, while complete records should compact into recognizable summaries without hiding essential spatial facts.

## Accessibility & Inclusion

Target WCAG 2.1 AA for contrast, keyboard access, focus states, and readable controls. Support reduced motion, color-blind-safe status indicators, touch-sized targets on tablet, no-hover alternatives, and clear recovery paths for import/storage errors. Tablet interactions should be pointer-agnostic from the start, with phone treated as a reduced viewing/light-editing tier rather than a cramped desktop clone.
