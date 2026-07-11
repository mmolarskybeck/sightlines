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
creation time, first-frame time, entry latency (`entryMs`), and frame-time
samples. Orbit the scene for a few seconds before reading it so `frameCount`, `frameTimeMs`, and
`maxFrameTimeMs` describe interactive navigation rather than just entry.

Record the result on a representative desktop and tablet. Repeat after a
reload for a cold entry and once more for a warm entry. The benchmark is an
instrument, not a pass/fail threshold yet; use the measurements to decide
whether eye-level room-visibility filtering is warranted.
