import { spawnSync } from "node:child_process";

const WORKER_NAME = "sightlines";
const MAX_DNS_LABEL_LENGTH = 63;

function previewAliasForBranch(branchName) {
  const fallback = "preview";
  const suffixLength = WORKER_NAME.length + 1;
  const maxAliasLength = MAX_DNS_LABEL_LENGTH - suffixLength;
  const alias =
    branchName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maxAliasLength)
      .replace(/-$/g, "") || fallback;

  return alias;
}

const args = process.argv.slice(2);
const branchName =
  process.env.WORKERS_CI_BRANCH ||
  process.env.GITHUB_HEAD_REF ||
  process.env.GITHUB_REF_NAME ||
  "";
const alias = previewAliasForBranch(branchName);

if (args.includes("--print-alias")) {
  console.log(alias);
  process.exit(0);
}

console.log(
  branchName
    ? `Uploading Cloudflare Worker preview for "${branchName}" with alias "${alias}".`
    : `Uploading Cloudflare Worker preview with fallback alias "${alias}".`
);

const result = spawnSync(
  "wrangler",
  ["versions", "upload", "--preview-alias", alias],
  {
    stdio: "inherit"
  }
);

process.exit(result.status ?? 1);
