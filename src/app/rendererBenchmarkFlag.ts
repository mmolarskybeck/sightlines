// Tiny, dependency-free module so both the eager App.tsx path and the
// lazily-loaded rendererBenchmarkAssets.ts (which eagerly globs fixture
// images) can share this check without dragging the glob into the eager
// bundle graph.
export const rendererBenchmarkEnabled =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("benchmark") === "renderer";
