#!/usr/bin/env python3
"""Dropbox storage plan, phase 1: randomized interleaving check of the blob protocol.

Disposable prototype (docs/dropbox-storage-plan.md, "Phase 1 results"). Models the
App Folder as an in-memory store with Dropbox's write semantics (add = idempotent
for identical bytes, conflict otherwise; update = revision-conditional; move;
delete), then runs two publishing devices and one garbage collector as coroutines
under a random scheduler. Each yield is one remote call, so any interleaving the
scheduler picks is one a real network could produce, including a device that
stalls for a long time between its existence check and its head publication.

    python3 -I scripts/prototypes/simulate-blob-protocol.py [--runs 20000]

Checked properties, per run:
  P1  A reader never accepts a head whose blobs it cannot all fetch (it may retry).
  P2  At quiescence every blob referenced by any head or recovery version exists
      in /blobs (nothing permanently dangling).
Variants switch off one safeguard each to show which failure it prevents.
"""

import argparse
import random
from collections import Counter

UNIVERSE = [f"b{i}" for i in range(8)]
GC_GRACE = 6        # blob must be this old (logical ticks) to be a candidate
TRASH_GRACE = 12    # trashed blob must be this old before permanent deletion


class Conflict(Exception):
    pass


class Store:
    def __init__(self):
        self.files = {}  # path -> {"content", "rev", "t"}
        self.rev = 0
        self.t = 0

    def _put(self, path, content):
        self.rev += 1
        self.files[path] = {"content": content, "rev": self.rev, "t": self.t}
        return self.rev

    def add(self, path, content):
        cur = self.files.get(path)
        if cur is not None:
            if cur["content"] == content:
                return cur["rev"]  # strict_conflict false: identical bytes = no-op
            raise Conflict(path)
        return self._put(path, content)

    def update(self, path, content, base_rev):
        cur = self.files.get(path)
        if (cur is None) != (base_rev is None) or (cur and cur["rev"] != base_rev):
            raise Conflict(path)
        return self._put(path, content)

    def get(self, path):
        return self.files.get(path)

    def delete(self, path):
        self.files.pop(path, None)

    def move(self, src, dst):
        cur = self.files.pop(src, None)
        if cur is None:
            return False
        if dst in self.files:
            return True  # already moved by someone else
        self.files[dst] = cur
        return True

    def listing(self, prefix):
        return {p: f for p, f in self.files.items() if p.startswith(prefix)}


def blob(b):
    return f"/blobs/{b}"


def trash(b):
    return f"/trash/{b}"


def roots(store):
    refs = set()
    for p, f in store.listing("/").items():
        if p.startswith("/heads/") or p.startswith("/recovery/"):
            refs |= set(f["content"])
    return refs


def writer(store, rng, name, cfg, log):
    """A device publishing several versions of the same project."""
    base_rev = None
    for version in range(3):
        refs = frozenset(rng.sample(UNIVERSE, rng.randint(1, 4)))
        present = {p.split("/")[-1] for p in store.listing("/blobs/")}
        yield
        for b in sorted(refs - present):
            store.add(blob(b), "bytes:" + b)
            yield
        # Recovery version: immutable, its own root.
        store.add(f"/recovery/{name}-{version}", refs)
        yield
        while True:
            try:
                base_rev = store.update("/heads/p", refs, base_rev)
                break
            except Conflict:
                head = store.get("/heads/p")
                base_rev = head["rev"] if head else None  # "keep this device's version"
                yield
        log.append(("published", name, refs))
        yield
        if cfg["post_verify"]:
            for b in sorted(refs):
                if store.get(blob(b)) is None:
                    if not (cfg["trash"] and store.move(trash(b), blob(b))):
                        store.add(blob(b), "bytes:" + b)  # re-upload from local bytes
                yield


def collector(store, rng, cfg):
    for _ in range(3):
        live = roots(store)
        yield
        for p, f in list(store.listing("/blobs/").items()):
            b = p.split("/")[-1]
            if b not in live and store.t - f["t"] >= GC_GRACE:
                if cfg["trash"]:
                    store.move(p, trash(b))
                else:
                    store.delete(p)
                yield
        if cfg["trash"]:
            live = roots(store) if cfg["fresh_sweep_roots"] else live
            yield
            for p, f in list(store.listing("/trash/").items()):
                b = p.split("/")[-1]
                if b in live:
                    store.move(p, blob(b))
                elif store.t - f["t"] >= TRASH_GRACE:
                    store.delete(p)
                yield


def reader(store, cfg, violations):
    """Pulls the head whenever scheduled; must never accept an incomplete one."""
    while True:
        head = store.get("/heads/p")
        if head:
            missing = []
            for b in head["content"]:
                if store.get(blob(b)) is None and not (cfg["trash"] and store.get(trash(b))):
                    missing.append(b)
            if missing:
                violations["P1 reader accepted incomplete head" if not cfg["reader_checks"]
                           else "~ reader retried (transient)"] += 1
            # with reader_checks a missing blob means "retry later": not accepted
        yield


def run(seed, cfg):
    rng = random.Random(seed)
    store = Store()
    # Pre-existing garbage so the collector has work to race against.
    for b in UNIVERSE[:4]:
        store.add(blob(b), "bytes:" + b)
    store.t = GC_GRACE + TRASH_GRACE
    log, violations = [], Counter()
    procs = {"A": writer(store, rng, "A", cfg, log), "B": writer(store, rng, "B", cfg, log),
             "GC": collector(store, rng, cfg)}
    rd = reader(store, cfg, violations)
    weights = {"A": 1.0, "B": 1.0, "GC": 1.0}
    stalled = rng.choice(["A", "B", None])
    if stalled:
        weights[stalled] = 0.08  # one device sleeps a lot (laptop lid closed)
    while procs:
        names = list(procs)
        pick = rng.choices(names, [weights[n] for n in names])[0]
        try:
            next(procs[pick])
        except StopIteration:
            del procs[pick]
        store.t += 1
        next(rd)
    for b in roots(store):
        if store.get(blob(b)) is None:
            violations["P2 dangling reference at quiescence"] += 1
            break
    return violations


VARIANTS = {
    "full protocol": dict(post_verify=True, trash=True, fresh_sweep_roots=True, reader_checks=True),
    "no post-publish verify": dict(post_verify=False, trash=True, fresh_sweep_roots=True, reader_checks=True),
    "no trash (direct delete)": dict(post_verify=True, trash=False, fresh_sweep_roots=True, reader_checks=True),
    "sweep reuses stale roots": dict(post_verify=False, trash=True, fresh_sweep_roots=False, reader_checks=True),
    "reader trusts head": dict(post_verify=True, trash=True, fresh_sweep_roots=True, reader_checks=False),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=20000)
    args = ap.parse_args()
    for name, cfg in VARIANTS.items():
        total, runs_bad = Counter(), 0
        for seed in range(args.runs):
            v = run(seed, cfg)
            total.update({k: 1 for k in v})
            runs_bad += any(not k.startswith("~") for k in v)
        detail = ", ".join(f"{k}: {n}" for k, n in sorted(total.items())) or "none"
        print(f"{name:28} runs with violations {runs_bad:6}/{args.runs}  ({detail})")


if __name__ == "__main__":
    main()
