#!/usr/bin/env python3
"""Dropbox storage plan, phase 1: read-only measurement of a content-addressed store.

Disposable prototype (docs/dropbox-storage-plan.md, phase 1). It reads an export of
the Sightlines App Folder (a ZIP of /projects, /backups, /shares) and simulates
storing every image tier once by the SHA-256 of its actual bytes, with small
per-version manifests that reference those blobs. It never writes anywhere except
the optional --json output path, and never touches Dropbox.

    python3 -I scripts/prototypes/measure-cloud-dedupe.py ~/Downloads/Sightlines.zip \
        [--json out.json] [--quota-bytes 2147483648]

The export is private evidence: never commit it or this script's JSON output.
"""

import argparse
import hashlib
import io
import json
import statistics
import sys
import time
import zipfile
import zlib
from collections import defaultdict

MB = 1_000_000


def category(path):
    head = path.strip("/").split("/", 1)[0]
    return {"projects": "head", "backups": "backup", "shares": "share"}.get(head, "other")


def deflated_size(raw):
    return len(zlib.compress(raw, 6))


def read_packages(outer_path):
    """Yield one record per nested .sightlines package."""
    with zipfile.ZipFile(outer_path) as outer:
        for info in outer.infolist():
            if not info.filename.endswith(".sightlines"):
                continue
            pkg_bytes = outer.read(info)
            with zipfile.ZipFile(io.BytesIO(pkg_bytes)) as inner:
                manifest_raw = inner.read("manifest.json")
                manifest = json.loads(manifest_raw)
                path_hash = {}
                for entry in inner.infolist():
                    if entry.filename.startswith("assets/") and not entry.is_dir():
                        data = inner.read(entry)
                        path_hash[entry.filename] = (hashlib.sha256(data).hexdigest(), len(data))
            refs = []  # (assetId, tier, sha, bytes)
            for asset in manifest.get("assets", []):
                for tier in asset.get("tiers", []):
                    sha, size = path_hash[tier["path"]]
                    refs.append((asset["assetId"], tier["tier"], sha, size))
            # Manifest that a split store would write: same JSON, tiers keep sha/size,
            # so size is a close proxy. Measured deflated, as the zip stores it.
            yield {
                "path": info.filename,
                "category": category(info.filename),
                "projectId": manifest["project"]["id"],
                "title": manifest["project"].get("name") or manifest["project"].get("title"),
                "exportedAt": manifest.get("exportedAt"),
                "mode": manifest.get("mode"),
                "packageBytes": info.file_size,
                "manifestRawBytes": len(manifest_raw),
                "manifestDeflatedBytes": deflated_size(manifest_raw),
                "refs": refs,
            }


def blob_set(pkgs):
    blobs = {}
    for p in pkgs:
        for _, _, sha, size in p["refs"]:
            blobs[sha] = size
    return blobs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("export_zip")
    ap.add_argument("--json")
    ap.add_argument("--quota-bytes", type=int, default=2 * 1024**3)
    args = ap.parse_args()

    t0 = time.time()
    pkgs = list(read_packages(args.export_zip))
    read_s = time.time() - t0
    out = {"packages": len(pkgs), "readSeconds": round(read_s, 1)}

    # --- 1. Current physical usage by category ------------------------------
    by_cat = defaultdict(lambda: {"count": 0, "bytes": 0})
    for p in pkgs:
        by_cat[p["category"]]["count"] += 1
        by_cat[p["category"]]["bytes"] += p["packageBytes"]
    current_total = sum(v["bytes"] for v in by_cat.values())
    out["current"] = {"byCategory": dict(by_cat), "total": current_total,
                      "quotaHeadroom": args.quota_bytes - current_total}

    internal = [p for p in pkgs if p["category"] in ("head", "backup")]
    shares = [p for p in pkgs if p["category"] == "share"]
    share_bytes = sum(p["packageBytes"] for p in shares)
    manifests_internal = sum(p["manifestDeflatedBytes"] for p in internal)

    # --- 2. Content-addressed store scenarios (shares stay self-contained) --
    acct_blobs = blob_set(internal)
    per_project = defaultdict(list)
    for p in internal:
        per_project[p["projectId"]].append(p)
    per_project_blob_bytes = sum(sum(blob_set(v).values()) for v in per_project.values())
    tiers = defaultdict(lambda: [0, 0])
    for sha, size in acct_blobs.items():
        pass
    seen = set()
    for p in internal:
        for _, tier, sha, size in p["refs"]:
            if sha not in seen:
                seen.add(sha)
                tiers[tier][0] += 1
                tiers[tier][1] += size
    out["contentAddressed"] = {
        "manifestsBytes": manifests_internal,
        "accountWide": {"blobs": len(acct_blobs), "blobBytes": sum(acct_blobs.values()),
                        "totalWithManifestsAndShares": sum(acct_blobs.values()) + manifests_internal + share_bytes},
        "perProjectNamespace": {"blobBytes": per_project_blob_bytes,
                                "totalWithManifestsAndShares": per_project_blob_bytes + manifests_internal + share_bytes},
        "uniqueBlobsByTier": {k: {"count": v[0], "bytes": v[1]} for k, v in tiers.items()},
        "manifestDeflated": {
            "median": int(statistics.median(p["manifestDeflatedBytes"] for p in internal)),
            "max": max(p["manifestDeflatedBytes"] for p in internal),
        },
    }

    # --- 3. Garbage potential: blobs referenced only by backups -------------
    head_blobs = blob_set([p for p in internal if p["category"] == "head"])
    newest_per_project = [max(v, key=lambda p: p["exportedAt"] or "") for v in per_project.values()]
    newest_blobs = blob_set(newest_per_project)
    only_history = {s: b for s, b in acct_blobs.items() if s not in newest_blobs}
    out["garbage"] = {
        "headBlobBytes": sum(head_blobs.values()),
        "newestVersionPerProjectBlobBytes": sum(newest_blobs.values()),
        "referencedOnlyByOlderVersions": {"blobs": len(only_history), "bytes": sum(only_history.values())},
    }

    # --- 4. Churn: upload cost per successive version, per project ----------
    #     Today every version uploads the whole package; a split store uploads the
    #     manifest plus blobs not already present (account-wide, ordered by time).
    chrono = sorted(internal, key=lambda p: p["exportedAt"] or "")
    present = set()
    steps = []
    for p in chrono:
        new = {sha: size for _, _, sha, size in p["refs"] if sha not in present}
        steps.append({"projectId": p["projectId"], "category": p["category"],
                      "fullPackage": p["packageBytes"], "newBlobs": len(new),
                      "newBlobBytes": sum(new.values()),
                      "splitUpload": sum(new.values()) + p["manifestDeflatedBytes"],
                      "refCount": len({sha for _, _, sha, _ in p["refs"]})})
        present.update(new)
    later = steps[1:] if len(steps) > 1 else steps
    zero_new = sum(1 for s in later if s["newBlobs"] == 0)
    out["churn"] = {
        "versions": len(steps),
        "versionsWithNoNewBlobs": zero_new,
        "uploadBytesToday": sum(s["fullPackage"] for s in steps),
        "uploadBytesSplit": sum(s["splitUpload"] for s in steps),
        "medianSplitUpload": int(statistics.median(s["splitUpload"] for s in later)),
        "medianFullPackage": int(statistics.median(s["fullPackage"] for s in later)),
        "newBlobsPerVersion": {"median": statistics.median(s["newBlobs"] for s in later),
                               "max": max(s["newBlobs"] for s in later)},
        "refsPerVersion": {"median": statistics.median(s["refCount"] for s in steps),
                           "max": max(s["refCount"] for s in steps)},
    }

    # --- 5. Migration headroom: unit = one project (newest version first) ---
    #     Peak extra space if each project's blobs + manifests are uploaded before
    #     any legacy file is removed (worst case, no cleanup during migration).
    present = set()
    units = []
    for pid, versions in sorted(per_project.items(), key=lambda kv: -max(p["packageBytes"] for p in kv[1])):
        need = {sha: size for v in versions for _, _, sha, size in v["refs"] if sha not in present}
        present.update(need)
        units.append({"projectId": pid[:8], "versions": len(versions),
                      "legacyBytes": sum(v["packageBytes"] for v in versions),
                      "newUploadBytes": sum(need.values()) + sum(v["manifestDeflatedBytes"] for v in versions)})
    out["migration"] = {
        "projects": len(units),
        "totalUploadNoCleanup": sum(u["newUploadBytes"] for u in units),
        "largestSingleUnitUpload": max(u["newUploadBytes"] for u in units),
        "units": units,
    }

    # --- 6. Reconstruction: rebuild one .sightlines zip from blobs ----------
    with zipfile.ZipFile(args.export_zip) as outer:
        biggest = max(internal, key=lambda p: p["packageBytes"])
        src = zipfile.ZipFile(io.BytesIO(outer.read(biggest["path"])))
        blobs = {e.filename: src.read(e) for e in src.infolist() if e.filename.startswith("assets/")}
        manifest = src.read("manifest.json")
        t1 = time.time()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("manifest.json", manifest, compress_type=zipfile.ZIP_DEFLATED)
            for name, data in blobs.items():
                hashlib.sha256(data).hexdigest()  # verify-on-assemble cost
                z.writestr(name, data, compress_type=zipfile.ZIP_STORED)
        out["reconstruction"] = {"package": biggest["path"].rsplit("/", 1)[-1],
                                 "blobs": len(blobs), "bytes": buf.tell(),
                                 "seconds": round(time.time() - t1, 3)}

    print_summary(out)
    if args.json:
        with open(args.json, "w") as f:
            json.dump(out, f, indent=2)


def print_summary(o):
    m = lambda b: f"{b / MB:,.1f} MB"
    print(f"packages read: {o['packages']} in {o['readSeconds']} s")
    c = o["current"]
    for k, v in c["byCategory"].items():
        print(f"  current {k:7}: {v['count']:3} pkgs {m(v['bytes'])}")
    print(f"  current total {m(c['total'])}; headroom vs quota {m(c['quotaHeadroom'])}")
    ca = o["contentAddressed"]
    print(f"split store, account-wide : {ca['accountWide']['blobs']} blobs {m(ca['accountWide']['blobBytes'])}; "
          f"total incl. manifests+shares {m(ca['accountWide']['totalWithManifestsAndShares'])}")
    print(f"split store, per-project  : {m(ca['perProjectNamespace']['blobBytes'])}; "
          f"total {m(ca['perProjectNamespace']['totalWithManifestsAndShares'])}")
    print(f"  manifests {m(ca['manifestsBytes'])} (median {ca['manifestDeflated']['median']:,} B, max {ca['manifestDeflated']['max']:,} B)")
    print(f"  unique blobs by tier: {json.dumps(ca['uniqueBlobsByTier'])}")
    g = o["garbage"]
    print(f"garbage if only newest version per project kept: "
          f"{g['referencedOnlyByOlderVersions']['blobs']} blobs {m(g['referencedOnlyByOlderVersions']['bytes'])}")
    ch = o["churn"]
    print(f"churn: {ch['versions']} versions, {ch['versionsWithNoNewBlobs']} with zero new blobs; "
          f"upload today {m(ch['uploadBytesToday'])} vs split {m(ch['uploadBytesSplit'])}")
    print(f"  median per-version upload: full {m(ch['medianFullPackage'])} vs split {ch['medianSplitUpload']:,} B; "
          f"new blobs/version median {ch['newBlobsPerVersion']['median']} max {ch['newBlobsPerVersion']['max']}; "
          f"refs/version median {ch['refsPerVersion']['median']} max {ch['refsPerVersion']['max']}")
    mg = o["migration"]
    print(f"migration (no cleanup): upload {m(mg['totalUploadNoCleanup'])}; largest unit {m(mg['largestSingleUnitUpload'])}")
    r = o["reconstruction"]
    print(f"reassemble largest package locally: {r['blobs']} blobs {m(r['bytes'])} in {r['seconds']} s")


if __name__ == "__main__":
    sys.exit(main())
