# Renderer benchmark fixture

`renderer-10-room-200-work.ts` is a deterministic 10-room / 200-work project
for measuring 3D scene derivation, mesh count, texture loading, camera entry,
and orbit performance. The rooms occupy one shared floor coordinate space and
contain 20 wall placements each.

The 200 records intentionally reuse six display assets from
`fixtures/artworks/wikimedia`, whose metadata links to public-domain works on
Wikimedia Commons. This keeps the fixture lightweight while preserving the
object count that stresses the renderer. A future image-memory benchmark can
swap in 200 distinct display assets without changing the project fixture.

Record measurements on a representative desktop and tablet. Keep Overview
whole-floor; use the results to decide whether eye-level rendering needs
camera-visible connected-room filtering.
