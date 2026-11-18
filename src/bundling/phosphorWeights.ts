import { parseAst } from "rollup/parseAst";
import type { Plugin } from "vite";

// Build-time only (vite.config.ts); never imported by the app.
//
// Every @phosphor-icons/react icon ships its glyph in all six weights, as a
// `new Map([["bold", <g/>], ["duotone", <g/>], …])` in dist/defs/<Name>.es.js,
// and IconBase picks one at render time — so the bundler cannot tree-shake the
// unused ones. Sightlines draws only these three; dropping the other three
// roughly halves the icon bytes in the eager vendor chunk.
//
// phosphorWeights.test.ts scans src for every `weight=` prop and fails if one
// names a weight outside this list, so a stripped weight cannot silently render
// as an empty <svg>. Add a weight here before using it.
export const PHOSPHOR_WEIGHTS_KEPT: readonly string[] = ["regular", "bold", "fill"];

const DEFS_MODULE = /@phosphor-icons[\\/]react[\\/]dist[\\/]defs[\\/][^\\/]+\.es\.js$/;

type Node = { type: string; start: number; end: number; [key: string]: unknown };

// Returns the module with unused weights removed from its weight Map, or null
// when the module has no such Map (left untouched: correct, just unshrunk).
export function stripPhosphorWeights(
  code: string,
  keep: readonly string[] = PHOSPHOR_WEIGHTS_KEPT
): string | null {
  const program = parseAst(code) as unknown as Node;
  let weightMap: Node | null = null;
  const visit = (node: unknown): void => {
    if (weightMap || !node || typeof node !== "object") return;
    const candidate = node as Node;
    if (
      candidate.type === "NewExpression" &&
      (candidate.callee as Node).type === "Identifier" &&
      (candidate.callee as { name?: string }).name === "Map"
    ) {
      const [entries] = candidate.arguments as Node[];
      if (entries?.type === "ArrayExpression") {
        weightMap = entries;
        return;
      }
    }
    for (const value of Object.values(candidate)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(program);
  if (!weightMap) return null;
  const map: Node = weightMap;

  const entries = map.elements as Node[];
  const kept = entries.filter((entry) => {
    const name = entry.type === "ArrayExpression" ? (entry.elements as Node[])[0] : null;
    // Anything not shaped like ["weight", element] is kept as-is.
    if (!name || name.type !== "Literal") return true;
    return keep.includes(String((name as { value?: unknown }).value));
  });
  if (kept.length === entries.length) return null;
  const array = `[${kept.map((entry) => code.slice(entry.start, entry.end)).join(",")}]`;
  return code.slice(0, map.start) + array + code.slice(map.end);
}

export function phosphorWeightsPlugin(): Plugin {
  return {
    name: "sightlines-phosphor-weights",
    // Dev serves icons through esbuild's dep pre-bundle, which skips plugin
    // transforms; the src scan in the test is what keeps dev and prod agreeing.
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!DEFS_MODULE.test(id)) return null;
      const stripped = stripPhosphorWeights(code);
      return stripped === null ? null : { code: stripped, map: null };
    }
  };
}
