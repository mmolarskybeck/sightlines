// scripts/assert-chunk-graph.mjs
//
// Build invariant: the eager chunk graph must never reach the three chunk.
// The 3D stack (three.js + react-three fiber/drei) is reachable only through
// the lazy ThreeDView import; a static edge from any eagerly-loaded chunk
// (entry or its static-import closure) would put ~1MB of three.js on the
// critical path. This regressed once via Vite's preload helper being placed
// in the three chunk — see vite.config.ts manualChunks.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");

const html = readFileSync(path.join(dist, "index.html"), "utf8");
const entryMatch = html.match(/src="\/(assets\/index-[^"]+\.js)"/);
if (!entryMatch) {
  console.error("assert-chunk-graph: no entry <script> found in dist/index.html — build layout changed; update this script.");
  process.exit(1);
}

// Self-check: if chunk naming ever changes, fail loudly instead of silently
// asserting nothing.
const threeChunks = readdirSync(path.join(dist, "assets")).filter((file) => /^three-.*\.js$/.test(file));
if (threeChunks.length === 0) {
  console.error("assert-chunk-graph: no three-*.js chunk in dist/assets — chunk naming changed; update this script.");
  process.exit(1);
}

// Static import specifiers of a built chunk. Dynamic `import(...)` is masked
// out first so only static `import ... from "..."`, bare `import "..."`, and
// `export ... from "..."` edges remain.
function staticImports(file) {
  const source = readFileSync(path.join(dist, file), "utf8").replaceAll("import(", "__dynamic_import__(");
  const deps = new Set();
  for (const match of source.matchAll(/(?:import|from)\s*["']([^"']+)["']/g)) {
    deps.add(match[1]);
  }
  return [...deps]
    .filter((spec) => (spec.startsWith("./") || spec.startsWith("/assets/")) && spec.endsWith(".js"))
    .map((spec) => (spec.startsWith("./") ? path.posix.join("assets", spec.slice(2)) : spec.slice(1)));
}

const eager = new Set();
const queue = [entryMatch[1]];
while (queue.length > 0) {
  const file = queue.pop();
  if (eager.has(file)) continue;
  eager.add(file);
  queue.push(...staticImports(file));
}

const offenders = [...eager].filter((file) => /(^|\/)three-[^/]*\.js$/.test(file));
if (offenders.length > 0) {
  console.error(
    `assert-chunk-graph: FAIL — the eager chunk graph statically reaches the three chunk: ${offenders.join(", ")}\n` +
      "The 3D stack must load only via the lazy ThreeDView import. See vite.config.ts manualChunks."
  );
  process.exit(1);
}

console.log(`assert-chunk-graph: OK — entry closure (${eager.size} js file${eager.size === 1 ? "" : "s"}) does not reach three-*.js`);
