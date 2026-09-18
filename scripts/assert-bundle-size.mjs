// Build invariant: the named chunks must not grow past their recorded baseline
// by more than BUDGET_RATIO. Sizes are raw bytes of the built .js files (the
// number that actually changes when a refactor drags a module into the wrong
// chunk). Pair with assert-chunk-graph.mjs: that script guards WHICH chunks the
// entry reaches; this one guards how big each chunk is.
//
// After a deliberate change (new dependency, new feature in a lazy chunk):
//   node scripts/assert-bundle-size.mjs --update
// and commit scripts/bundle-size-baseline.json alongside the change.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const BUDGET_RATIO = 0.1;
const TRACKED = ["index", "vendor", "three", "pdf", "fontkit", "xlsx"];
const baselinePath = path.resolve("scripts/bundle-size-baseline.json");
const assetsDir = path.resolve("dist/assets");
const update = process.argv.includes("--update");

const files = readdirSync(assetsDir);
const measured = {};
for (const name of TRACKED) {
  const match = files.filter((file) => new RegExp(`^${name}-[^/]*\\.js$`).test(file));
  if (match.length !== 1) {
    console.error(
      `assert-bundle-size: expected exactly one ${name}-*.js chunk in dist/assets, found ${match.length} — chunk naming changed; update TRACKED in this script.`
    );
    process.exit(1);
  }
  measured[name] = statSync(path.join(assetsDir, match[0])).size;
}

if (update) {
  writeFileSync(baselinePath, `${JSON.stringify(measured, null, 2)}\n`);
  console.log(`assert-bundle-size: baseline written to ${path.relative(process.cwd(), baselinePath)}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
const failures = [];
const rows = [];
for (const name of TRACKED) {
  const before = baseline[name];
  const after = measured[name];
  if (typeof before !== "number") {
    failures.push(`${name}: no baseline recorded (run with --update)`);
    continue;
  }
  const delta = (after - before) / before;
  rows.push(`  ${name.padEnd(8)} ${kb(after).padStart(10)}  (baseline ${kb(before)}, ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%)`);
  if (delta > BUDGET_RATIO) {
    failures.push(`${name}: ${kb(after)} exceeds baseline ${kb(before)} by ${(delta * 100).toFixed(1)}% (budget ${BUDGET_RATIO * 100}%)`);
  }
}

console.log(`assert-bundle-size: ${failures.length ? "FAIL" : "OK"}\n${rows.join("\n")}`);
if (failures.length) {
  console.error(
    `\n${failures.map((line) => `  - ${line}`).join("\n")}\n` +
      "If the growth is intentional, run `node scripts/assert-bundle-size.mjs --update` and commit the new baseline with the change."
  );
  process.exit(1);
}
