import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Rejects raw 0x00 bytes in files that are supposed to be text.
//
// This has bitten this repo four times: a regex character class in
// dropboxAuth.ts where the `\u0000` escape was meant, twice a grouping-key
// delimiter in PlacementWarnings.tsx where a space was meant, and once in this
// file's own comment describing the other three. Every one was invisible in an
// editor and functionally harmless — the damage is that git reclassifies the
// file as binary, so diffs collapse to "Binary files differ" and review stops
// working on it.
//
// `od -c` CANNOT catch this: it renders a raw NUL and the two-character escape
// identically as `\0`. Reading the bytes is the only reliable test.
//
// Two modes, one allowlist, deliberately in one file so the two can't drift:
//   --staged  the pre-commit hook. Reads the INDEX (`git show :path`), because
//             that is the content a commit would actually record — which may
//             differ from what is on disk.
//   (default) CI and `npm run check:nuls`. Reads every tracked text file from
//             disk, so nothing depends on a contributor having installed the
//             hook, and `--no-verify` cannot route around it.

const TEXT_EXTENSIONS = new Set([
  ".astro",
  ".css",
  ".csv",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".webmanifest",
  ".xml",
  ".yaml",
  ".yml"
]);

const TEXT_BASENAMES = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "Dockerfile",
  "LICENSE",
  "Makefile",
  "_headers",
  "_redirects"
]);

export function isExpectedTextPath(filePath) {
  const basename = path.basename(filePath);
  return (
    TEXT_BASENAMES.has(basename) ||
    basename.startsWith(".env") ||
    TEXT_EXTENSIONS.has(path.extname(basename).toLowerCase())
  );
}

export function containsNul(bytes) {
  return bytes.includes(0);
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    encoding: options.encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"]
  });
}

export function stagedTextFilesWithNuls(cwd = process.cwd()) {
  const root = git(["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
  const names = git(
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { cwd: root }
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter(isExpectedTextPath);

  return names.filter((filePath) => {
    const stagedBlob = git(["show", `:${filePath}`], { cwd: root });
    return containsNul(stagedBlob);
  });
}

// Every tracked text file, read from the working tree. In CI the checkout IS
// the commit under test, so this is exactly the committed content; locally it
// is stricter than the hook, flagging a NUL the moment it lands on disk rather
// than waiting for it to be staged.
export function trackedTextFilesWithNuls(cwd = process.cwd()) {
  const root = git(["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
  const names = git(["ls-files", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter(isExpectedTextPath);

  return names.filter((filePath) => {
    const absolute = path.join(root, filePath);
    // A tracked path can be absent (deleted but not yet staged) or a symlink
    // pointing at a binary. Neither is this check's business, and reading them
    // would turn a clean tree into a spurious failure.
    let stats;
    try {
      stats = fs.lstatSync(absolute);
    } catch {
      return false;
    }
    if (!stats.isFile()) return false;
    return containsNul(fs.readFileSync(absolute));
  });
}

function main() {
  const staged = process.argv.includes("--staged");
  const offenders = staged ? stagedTextFilesWithNuls() : trackedTextFilesWithNuls();
  if (offenders.length === 0) return;

  console.error(
    staged
      ? "Commit blocked: staged text files contain raw NUL bytes:"
      : "Text files contain raw NUL bytes:"
  );
  for (const filePath of offenders) console.error(`  ${filePath}`);
  console.error("Use a textual escape such as \\u0000 instead of embedding byte 0x00.");
  process.exitCode = 1;
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryPoint === import.meta.url) main();
