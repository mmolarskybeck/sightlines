// Build invariant: the eager chunk graph must never reach the three or pdf
// chunks. Three.js must remain reachable only through the lazy ThreeDView
// import; pdf-lib/fontkit only through handleExportPdf's dynamic import.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");

const html = readFileSync(path.join(dist, "index.html"), "utf8");
const entryMatch = html.match(/src="\/(assets\/index-[^"]+\.js)"/);
if (!entryMatch) {
  console.error("assert-chunk-graph: no entry <script> found in dist/index.html — build layout changed; update this script.");
  process.exit(1);
}

// Fail if naming changes instead of silently asserting nothing.
const LAZY_CHUNKS = ["three", "pdf"];
const assetFiles = readdirSync(path.join(dist, "assets"));
for (const name of LAZY_CHUNKS) {
  if (!assetFiles.some((file) => new RegExp(`^${name}-.*\\.js$`).test(file))) {
    console.error(`assert-chunk-graph: no ${name}-*.js chunk in dist/assets — chunk naming changed; update this script.`);
    process.exit(1);
  }
}

// Mask dynamic imports before extracting static import/export edges.
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

const offenders = [...eager].filter((file) =>
  LAZY_CHUNKS.some((name) => new RegExp(`(^|/)${name}-[^/]*\\.js$`).test(file))
);
if (offenders.length > 0) {
  console.error(
    `assert-chunk-graph: FAIL — the eager chunk graph statically reaches a lazy-only chunk: ${offenders.join(", ")}\n` +
      "The 3D stack must load only via the lazy ThreeDView import and the PDF stack only via handleExportPdf's dynamic import. See vite.config.ts manualChunks."
  );
  process.exit(1);
}

console.log(
  `assert-chunk-graph: OK — entry closure (${eager.size} js file${eager.size === 1 ? "" : "s"}) reaches none of: ${LAZY_CHUNKS.map((name) => `${name}-*.js`).join(", ")}`
);
