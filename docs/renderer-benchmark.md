# Renderer benchmark

The renderer fixture test checks shape and schema validity. The browser
benchmark measures the actual 3D path.

Start the dev server, then open:

```text
http://localhost:5173/?benchmark=renderer
```

In development, that query loads the deterministic 10-room / 200-work fixture
without persisting it over the user's saved project. Open the browser console
and read:

```js
window.__sightlinesRendererBenchmark.getMetrics()
```

The result includes scene-derivation time, room/wall/artwork counts, canvas
creation time, first-frame time, entry latency (`entryMs`), and active frame-time
percentiles. Gaps over 100 ms are counted as idle gaps and excluded from the
frame sample ring buffer. Orbit the scene for a few seconds before reading it
so `frameCount`, `frameTimeP50Ms`, `frameTimeP95Ms`, and
`maxActiveFrameTimeMs` describe interactive navigation rather than idle time.

For navigation checks, select a room, wall, or artwork and use **Focus
selection** before orbiting. Double-clicking a selected mesh focuses it too.

Record the result on a representative desktop and tablet. Repeat after a
reload for a cold entry and once more for a warm entry. The benchmark is an
instrument, not a pass/fail threshold yet; use the measurements to decide
whether eye-level room-visibility filtering is warranted.
