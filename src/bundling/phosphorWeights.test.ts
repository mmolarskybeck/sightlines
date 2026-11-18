import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TypeScript from "typescript";
import { parseAst } from "rollup/parseAst";
import { describe, expect, it } from "vitest";
import { PHOSPHOR_WEIGHTS_KEPT, stripPhosphorWeights } from "./phosphorWeights";

// Loaded through Node rather than Vite: Vite's transform of the typescript
// package logs a missing-sourcemap error on every run.
const ts = createRequire(import.meta.url)("typescript") as typeof TypeScript;

const ALL_WEIGHTS = ["bold", "duotone", "fill", "light", "regular", "thin"];
const defsDir = path.resolve("node_modules/@phosphor-icons/react/dist/defs");

function weightEntries(code: string): string[] {
  return [...code.matchAll(/^\s*\[\s*"(\w+)",/gm)].map((match) => match[1]);
}

describe("stripPhosphorWeights", () => {
  it("keeps exactly the listed weights, byte-for-byte, in a real icon module", () => {
    const original = readFileSync(path.join(defsDir, "Check.es.js"), "utf8");
    expect(weightEntries(original)).toEqual(ALL_WEIGHTS);

    const stripped = stripPhosphorWeights(original);
    expect(stripped).not.toBeNull();
    expect(() => parseAst(stripped!)).not.toThrow();
    expect(stripped).not.toMatch(/"(thin|light|duotone)"/);
    for (const weight of PHOSPHOR_WEIGHTS_KEPT) expect(stripped).toContain(`"${weight}"`);
    // The surviving glyphs are the original source, not a re-serialization.
    const regularPath = original.match(/"regular",[\s\S]*?d: "([^"]+)"/)![1];
    expect(stripped).toContain(regularPath);
    expect(stripped!.length).toBeLessThan(original.length * 0.75);
  });

  it("leaves a module without a weight Map untouched", () => {
    expect(stripPhosphorWeights(`export const a = 1;`)).toBeNull();
    expect(stripPhosphorWeights(`const m = new Map([["regular", 1]]);`)).toBeNull();
  });

  it("recognizes the Map in every installed icon module", () => {
    // Guards a library upgrade that changes the defs format: an unrecognized
    // module would ship unshrunk without any build error.
    const unrecognized = readdirSync(defsDir)
      .filter((file) => file.endsWith(".es.js"))
      .filter((file) => stripPhosphorWeights(readFileSync(path.join(defsDir, file), "utf8")) === null);
    expect(unrecognized).toEqual([]);
  });
});

// Every value a `weight` JSX prop can take, read from the TypeScript AST so
// spacing (`weight = "thin"`) and expressions cannot slip past. A value that
// is not a string literal, or a ternary/parenthesized/`as const` tree of them,
// is reported as unresolvable: the build cannot know it is a kept weight.
function weightPropProblems(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: string[] = [];
  const where = (node: TypeScript.Node) =>
    `${fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const values = (node: TypeScript.Expression): string[] | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      return values(node.expression);
    }
    if (ts.isConditionalExpression(node)) {
      const whenTrue = values(node.whenTrue);
      const whenFalse = values(node.whenFalse);
      return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
    }
    return null;
  };
  const visit = (node: TypeScript.Node): void => {
    if (ts.isIdentifier(node) && node.text === "IconContext") {
      problems.push(`${where(node)}: IconContext can set a default weight`);
    }
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "weight") {
      const initializer = node.initializer;
      const expression = !initializer
        ? undefined
        : ts.isJsxExpression(initializer)
          ? initializer.expression
          : initializer;
      const found = expression ? values(expression) : null;
      if (!found) problems.push(`${where(node)}: unresolvable ${node.getText(file)}`);
      else {
        for (const weight of found) {
          if (!PHOSPHOR_WEIGHTS_KEPT.includes(weight)) {
            problems.push(`${where(node)}: stripped weight "${weight}"`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}

describe("weightPropProblems", () => {
  it("accepts kept literals and ternaries of them", () => {
    expect(
      weightPropProblems(
        `const a = <A weight="bold" />; const b = <B weight={on ? "fill" : ("regular" as const)} />;`,
        "ok.tsx"
      )
    ).toEqual([]);
  });

  it("catches stripped weights however they are written", () => {
    const problems = weightPropProblems(
      [
        `const a = <A weight = "thin" />;`,
        `const b = <B weight={"light"} />;`,
        `const c = <C weight={on ? "regular" : \`duotone\`} />;`
      ].join("\n"),
      "bad.tsx"
    );
    expect(problems).toEqual([
      `bad.tsx:1: stripped weight "thin"`,
      `bad.tsx:2: stripped weight "light"`,
      `bad.tsx:3: stripped weight "duotone"`
    ]);
  });

  it("rejects values it cannot resolve, and IconContext", () => {
    const problems = weightPropProblems(
      [
        `const a = <A weight={on ? "regular" : otherWeight} />;`,
        `const b = <B weight={pick()} />;`,
        `const c = <C weight />;`,
        `const d = <IconContext.Provider value={{}} />;`
      ].join("\n"),
      "bad.tsx"
    );
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/^bad\.tsx:1: unresolvable/);
    expect(problems[3]).toMatch(/IconContext/);
  });
});

describe("app icon weights", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
    });
  }

  it("uses only weights the build keeps", () => {
    const problems = sourceFiles(path.resolve("src/app")).flatMap((file) =>
      weightPropProblems(readFileSync(file, "utf8"), path.relative(process.cwd(), file))
    );
    expect(problems).toEqual([]);
  });
});
