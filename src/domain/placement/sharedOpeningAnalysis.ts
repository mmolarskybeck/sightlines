import { parseFaceWallId } from "../geometry/freestandingWalls";
import { getOpenWallIds } from "../geometry/wallCascade";
import {
  buildFloorWallsById,
  evaluateOpeningPairWith
} from "../geometry/openingConnections";
import type { FloorWall } from "../geometry/planObjects";
import {
  areSharedBoundaryWalls,
  findSharedBoundary,
  mirrorDoorLeaf,
  mirrorOpeningXMm,
  type SharedBoundary
} from "../geometry/sharedWalls";
import type {
  ConnectableOpeningWallObject,
  DoorLeaf,
  Project,
  WallObject
} from "../project";
import { isStructurallyValidPair } from "./openingPairs";
import { isOpeningSlotFree } from "./openingSlots";
import { isBlockingKind } from "./overlapPolicy";

// A door or window on a shared wall is ONE physical opening stored as two
// linked wall objects. This module derives what the document should look like
// for that invariant to hold, and says nothing about how (or whether) the
// answer is applied.
//
// Deliberately split three ways (architecture rule 5): `analyzeSharedOpenings`
// is a pure read that mints no ids and allocates no objects — safe to call from
// a memoized render-time selector — while `applySharedOpeningActions` is the
// only half that constructs anything, and persistent conflicts are their own
// type rather than PlacementWarnings.
//
// The pass is ORDER-INDEPENDENT: alignment is always evaluated against the
// input `project`, never a partially-repaired draft, and every work list is
// sorted by id. Shuffling `project.wallObjects` cannot change the result.

// How far apart two halves of a pair may sit before the pair counts as
// drifted. A genuine mirror lands within floating-point noise of the mirrored
// x, so a millimetre is generous for "still the same opening" and catches any
// real drift. Matches the 1 mm exactness `isOpeningSlotFree` already uses.
export const SHARED_OPENING_MIRROR_TOLERANCE_MM = 1;

// How far the two halves of a pair may differ in width, height or hang height
// before they stop being one physical opening. Same millimetre reasoning as the
// mirror tolerance: authored sizes are whole millimetres, so anything above this
// is a real difference rather than round-tripping noise.
export const SHARED_OPENING_GEOMETRY_TOLERANCE_MM = 1;

// Authoring slop when testing whether an opening's extent lies inside the run
// two walls have in common. Sub-millimetre differences are floating point, not
// an overhang.
const SPAN_CONTAINMENT_EPS_MM = 1;

// What a resolver may point a one-sided opening at. Two variants, because an
// ambiguous boundary between two EMPTY walls has no existing opening to offer
// and would otherwise be unresolvable.
export type SharedOpeningTarget =
  | { kind: "opening"; openingId: string } // adopt this existing opening
  | { kind: "wall"; wallId: string }; // create the twin on this wall

export type SharedOpeningConflictReason =
  | "ambiguous-boundary-wall"
  | "ambiguous-counterpart-opening"
  | "overhangs-common-span"
  | "paired-overhang"
  | "paired-geometry-mismatch"
  | "counterpart-occupied"
  | "blocked-mirror-slot"
  | "missing-twin"
  | "boundary-lost";

export type SharedOpeningConflict = {
  id: string; // `${openingId}:${reason}`
  reason: SharedOpeningConflictReason;
  openingId: string;
  // Always [the opening's own wall, ...the counterpart walls involved]. Plural
  // because an ambiguous boundary spans several.
  wallIds: string[];
  // The ONLY targets a resolver may accept for this conflict.
  candidates?: SharedOpeningTarget[];
  // Every opening the conflict is ABOUT, sorted, including `openingId`. Set for
  // `ambiguous-counterpart-opening`, whose one conflict stands for a whole
  // connected cluster of mutually-adoptable openings: the conflict is keyed on
  // the cluster's lexicographically smallest member so the result cannot depend
  // on traversal order, but Stage 7 must be able to surface it for WHICHEVER
  // member the user selects. `candidates` stays the KEYED opening's own graph
  // neighbours — Stage 6's resolver validates a chosen target by graph adjacency
  // to the opening actually being resolved, not by the keyed opening's list.
  memberIds?: string[];
  partnerId?: string;
  blockerId?: string;
};

export type SharedOpeningAction =
  | { kind: "adopt"; openingId: string; counterpartOpeningId: string }
  | { kind: "create-twin"; openingId: string; wallId: string; xMm: number }
  | {
      kind: "realign";
      authoritativeOpeningId: string;
      partnerOpeningId: string;
      partnerXMm: number;
    };

// Omitted entirely = the whole project (document load, issues rail). Present
// but empty = nothing is in scope, which is what makes an opted-in but
// narrowly-scoped transaction unable to repair unrelated galleries
// (architecture rule 3).
export type SharedOpeningScope = { openingIds?: string[]; wallIds?: string[] };

export type SharedOpeningAnalysis = {
  actions: SharedOpeningAction[];
  conflicts: SharedOpeningConflict[];
};

export type AppliedSharedOpeningActions = {
  project: Project;
  formedPairIds: [string, string][];
  createdOpeningIds: string[];
  realignedIds: string[];
};

function isConnectableOpening(
  wallObject: WallObject | undefined
): wallObject is ConnectableOpeningWallObject {
  return wallObject?.kind === "door" || wallObject?.kind === "window";
}

function byIdAscending(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

type Extent = { minMm: number; maxMm: number };

function extentOf(xMm: number, widthMm: number): Extent {
  return { minMm: xMm - widthMm / 2, maxMm: xMm + widthMm / 2 };
}

function isWithinSpan(extent: Extent, boundary: SharedBoundary): boolean {
  return (
    extent.minMm >= boundary.commonMinMm - SPAN_CONTAINMENT_EPS_MM &&
    extent.maxMm <= boundary.commonMaxMm + SPAN_CONTAINMENT_EPS_MM
  );
}

// Overlaps the common run by more than authoring slop. The distinction from
// `isWithinSpan` is what separates a door deliberately placed on the EXTERIOR
// stretch of a partly-shared wall (no overlap at all — silent) from one that
// straddles the seam (overlaps but is not contained — an overhang).
function intersectsSpan(extent: Extent, boundary: SharedBoundary): boolean {
  return (
    extent.maxMm > boundary.commonMinMm + SPAN_CONTAINMENT_EPS_MM &&
    extent.minMm < boundary.commonMaxMm - SPAN_CONTAINMENT_EPS_MM
  );
}

// Where an unpaired opening sits relative to the runs its wall shares with
// other walls — the first rung of the phase 1 ladder, and the only thing that
// decides whether the opening has a CONFIRMED counterpart wall.
type OpeningPlacement =
  | { kind: "exterior" }
  | { kind: "overhang"; boundaries: SharedBoundary[] }
  | { kind: "ambiguous-wall"; boundaries: SharedBoundary[] }
  | { kind: "confirmed"; counterpartWallId: string };

// The analysis plus the one thing only the pass itself can know: for each
// opening that could be resolved BY HAND, the exact set of targets a resolver
// may accept for THAT opening. Kept off `SharedOpeningAnalysis` because every
// existing caller (load repair, reconciliation, issues rail) wants actions and
// conflicts and nothing else.
type SharedOpeningAnalysisInternals = SharedOpeningAnalysis & {
  candidatesByOpeningId: Map<string, SharedOpeningTarget[]>;
};

export function analyzeSharedOpenings(
  project: Project,
  scope?: SharedOpeningScope
): SharedOpeningAnalysis {
  const { actions, conflicts } = runSharedOpeningAnalysis(project, scope);
  return { actions, conflicts };
}

// The ONLY targets a resolver may accept for this one opening.
//
// A conflict's own `candidates` are not a substitute. One
// `ambiguous-counterpart-opening` conflict stands for a whole cluster and is
// keyed on the cluster's lexicographically smallest member, so its `candidates`
// are the KEYED opening's graph neighbours — offering those to a different
// member of the same cluster would advertise a pairing that member cannot form.
// This answers per opening, by graph adjacency to the opening actually being
// resolved.
//
// Deliberately unscoped: the graph an opening lives in is a property of the
// document, so narrowing the scope must never license a pairing the whole-
// document pass would have refused. Returns [] for an opening with nothing to
// choose between — including a `missing-twin`, whose repair is one fixed
// action rather than a pick (see sharedOpeningIssues.ts).
export function sharedOpeningCandidates(
  project: Project,
  openingId: string
): SharedOpeningTarget[] {
  return runSharedOpeningAnalysis(project).candidatesByOpeningId.get(openingId) ?? [];
}

function runSharedOpeningAnalysis(
  project: Project,
  scope?: SharedOpeningScope
): SharedOpeningAnalysisInternals {
  const actions: SharedOpeningAction[] = [];
  const conflicts: SharedOpeningConflict[] = [];

  // One wall map for the whole pass: evaluateOpeningPair would otherwise
  // rebuild every floor wall for every candidate it tests.
  const wallsById = buildFloorWallsById(project);
  const objectsById = new Map(project.wallObjects.map((object) => [object.id, object]));
  const openings = project.wallObjects.filter(isConnectableOpening);

  // findSharedBoundary is O(walls); the same wall is asked about once per
  // opening on it and once per half of a pair, so memoize per pass.
  // An open wall has no surface, so it can neither carry an opening nor back
  // one on the other side: it must drop out of shared-opening topology
  // entirely. Without this, sliding a room flush against a previously-exterior
  // open wall would let reconciliation mint a `create-twin` door ON the open
  // wall. Filtered HERE rather than inside findSharedBoundary, which stays
  // purely geometric because restore has to find the twin of an already-open
  // wall.
  const openWallIds = getOpenWallIds(project);
  const boundaryCache = new Map<string, SharedBoundary[]>();
  const boundariesOf = (wallId: string): SharedBoundary[] => {
    const cached = boundaryCache.get(wallId);
    if (cached) return cached;
    const result = openWallIds.has(wallId)
      ? ({ status: "none" } as const)
      : findSharedBoundary(project, wallId);
    const boundaries = (
      result.status === "none"
        ? []
        : result.status === "confirmed"
          ? [result.boundary]
          : result.boundaries
    ).filter((boundary) => !openWallIds.has(boundary.wallId));
    boundaryCache.set(wallId, boundaries);
    return boundaries;
  };
  // The boundary between two SPECIFIC walls, from `wallId`'s point of view —
  // so commonMin/MaxMm read in that wall's local x. Present exactly when
  // areSharedBoundaryWalls is true (both go through the same pairwise test).
  const boundaryBetween = (wallId: string, otherWallId: string): SharedBoundary | undefined =>
    boundariesOf(wallId).find((boundary) => boundary.wallId === otherWallId);

  const isInScope = (opening: ConnectableOpeningWallObject): boolean => {
    if (scope === undefined) return true;
    return (
      (scope.openingIds?.includes(opening.id) ?? false) ||
      (scope.wallIds?.includes(opening.wallId) ?? false)
    );
  };

  const addConflict = (
    reason: SharedOpeningConflictReason,
    openingId: string,
    rest: Omit<SharedOpeningConflict, "id" | "reason" | "openingId">
  ): void => {
    conflicts.push({ id: `${openingId}:${reason}`, reason, openingId, ...rest });
  };

  // ---------------------------------------------------------------------
  // Phase 1 — one-sided openings looking for their other face.
  // ---------------------------------------------------------------------
  //
  // The ladder, per unpaired opening:
  //
  //   1. SPAN FIT. Compare the opening's extent against every run its wall
  //      shares with another wall:
  //        contained in exactly one -> that wall is its CONFIRMED counterpart
  //        contained in two or more -> `ambiguous-boundary-wall`
  //        contained in none but intersecting one -> `overhangs-common-span`
  //        intersecting none        -> a legitimate exterior opening; silent.
  //      The last two are the reason a long wall may be shared over part of its
  //      run and exterior over the rest: a door on the exterior stretch of a
  //      partly-shared wall is not an error, only one straddling the seam is.
  //   2. ADOPTION GRAPH. Every opening with a confirmed counterpart wall is a
  //      node; an edge joins two of them when each sits on the other's confirmed
  //      counterpart wall and `evaluateOpeningPairWith` reads them as aligned.
  //      Connected components then decide:
  //        one edge, both endpoints degree 1 -> `adopt`
  //        any larger component             -> ONE
  //                                            `ambiguous-counterpart-opening`
  //        no edges (isolated node)         -> fall through to rung 3.
  //   3. MIRROR SLOT on the confirmed counterpart wall: free -> `create-twin`,
  //      else `counterpart-occupied` / `blocked-mirror-slot`.
  //
  // The graph is built from the INPUT PROJECT ALONE — never from a running
  // "claimed" set — because a claim set makes mutual uniqueness traversal
  // dependent: A1 could pair with B1 or B2 and A2 with B2 or B3, but if A1 is
  // visited first and claims B1/B2, A2 sees only B3 and silently adopts it
  // despite genuinely having had two candidates. Degree in the complete graph
  // cannot be hidden that way, and keying each cluster's conflict on its
  // lexicographically smallest member makes the emitted conflict independent of
  // which member is visited first.

  const unpaired = openings
    .filter(
      (opening) =>
        opening.connectsToObjectId === undefined && parseFaceWallId(opening.wallId) === null
    )
    .sort(byIdAscending);
  const unpairedById = new Map(unpaired.map((opening) => [opening.id, opening]));

  // Rung 1, for every unpaired opening in the project — deliberately NOT
  // scope-filtered, since the graph an in-scope opening lives in is a property
  // of the document, not of what the caller happened to look at.
  const placements = new Map<string, OpeningPlacement>(
    unpaired.map((opening) => {
      const boundaries = boundariesOf(opening.wallId);
      if (boundaries.length === 0) return [opening.id, { kind: "exterior" } as const];

      const extent = extentOf(opening.xMm, opening.widthMm);
      // NARROWING. Wall-level discovery is ambiguous for a perfectly legitimate
      // plan — two rooms stacked along one long wall each back a different half
      // of it. That is only a conflict for openings that BOTH halves could host.
      const containing = boundaries.filter((boundary) => isWithinSpan(extent, boundary));
      if (containing.length === 1) {
        const confirmed = { kind: "confirmed", counterpartWallId: containing[0].wallId } as const;
        return [opening.id, confirmed];
      }
      if (containing.length > 1) {
        return [opening.id, { kind: "ambiguous-wall", boundaries: containing } as const];
      }

      const intersecting = boundaries.filter((boundary) => intersectsSpan(extent, boundary));
      // Touches a shared run without fitting inside it: the walls are shared,
      // the opening just straddles the end of the part they share.
      if (intersecting.length > 0) {
        return [opening.id, { kind: "overhang", boundaries: intersecting } as const];
      }
      // Clear of every shared run. An exterior door on the exterior stretch of a
      // partly-shared wall, which is as legitimate as one on a wall with no
      // facing room at all — emitting anything here would flag real front doors.
      return [opening.id, { kind: "exterior" } as const];
    })
  );

  const confirmedWallOf = (openingId: string): string | undefined => {
    const placement = placements.get(openingId);
    return placement?.kind === "confirmed" ? placement.counterpartWallId : undefined;
  };

  // Whether these two unpaired openings read as one shared opening. Symmetric,
  // and always evaluated against the input project.
  const readsAsOneOpening = (
    a: ConnectableOpeningWallObject,
    b: ConnectableOpeningWallObject
  ): boolean =>
    a.id !== b.id &&
    a.kind === b.kind &&
    a.wallId !== b.wallId &&
    evaluateOpeningPairWith(project, wallsById, a.id, b.id).status === "aligned";

  // Whether `candidate`'s OWN placement points back at `wallId` — either it has
  // that wall as its confirmed counterpart, or its boundary is itself ambiguous
  // and that wall is one of the options. An overhanging or exterior opening
  // never does, which is what disqualifies it as a resolution target.
  const facesBack = (candidate: ConnectableOpeningWallObject, wallId: string): boolean => {
    const placement = placements.get(candidate.id);
    if (placement?.kind === "confirmed") return placement.counterpartWallId === wallId;
    if (placement?.kind === "ambiguous-wall") {
      return placement.boundaries.some((boundary) => boundary.wallId === wallId);
    }
    return false;
  };

  const adoptableOn = (
    subject: ConnectableOpeningWallObject,
    counterpartWallId: string
  ): ConnectableOpeningWallObject[] =>
    // `unpaired` is already sorted by id, so the filtered view is too.
    unpaired.filter(
      (candidate) => candidate.wallId === counterpartWallId && readsAsOneOpening(subject, candidate)
    );

  // An opening whose own boundary WALL is ambiguous cannot be a graph node (it
  // has no confirmed counterpart wall), but it still offers the openings on
  // those walls as resolution targets. Those targets are withheld from the
  // graph: pairing one of them off elsewhere would silently consume a target the
  // unresolved conflict still depends on. Computed over the whole project
  // regardless of scope, so narrowing the scope can never license a pairing the
  // full pass would have refused.
  const ambiguousWallCandidates = new Map<string, SharedOpeningTarget[]>();
  const withheld = new Set<string>();
  for (const opening of unpaired) {
    const placement = placements.get(opening.id);
    if (placement?.kind !== "ambiguous-wall") continue;

    // Genuinely two rooms behind the same door. The app cannot pick one for the
    // user; offer every wall that could host the other face — existing openings
    // where there are any, the bare wall where there are not.
    const candidates: SharedOpeningTarget[] = [];
    for (const boundary of placement.boundaries) {
      // Both sides have to agree. `adoptableOn` only asks whether the CANDIDATE
      // looks right from here — wall, kind, alignment — and says nothing about
      // where the candidate itself sits. Without the second half of the test an
      // opening that overhangs its own shared run, or sits on the exterior
      // stretch of a partly-shared wall, could be advertised as a valid manual
      // resolution target, which the type contract says these never are.
      const adoptable = adoptableOn(opening, boundary.wallId).filter((candidate) =>
        facesBack(candidate, opening.wallId)
      );
      if (adoptable.length > 0) {
        for (const candidate of adoptable) {
          candidates.push({ kind: "opening", openingId: candidate.id });
          withheld.add(candidate.id);
        }
      } else if (mirrorSlot(project, wallsById, opening, boundary.wallId).status === "free") {
        candidates.push({ kind: "wall", wallId: boundary.wallId });
      }
    }
    ambiguousWallCandidates.set(opening.id, candidates);
  }

  // The complete adoption graph over the openings that are still free to pair.
  const graphNodes = unpaired.filter(
    (opening) => confirmedWallOf(opening.id) !== undefined && !withheld.has(opening.id)
  );
  const nodesByWallId = new Map<string, ConnectableOpeningWallObject[]>();
  for (const node of graphNodes) {
    const onWall = nodesByWallId.get(node.wallId);
    if (onWall) onWall.push(node);
    else nodesByWallId.set(node.wallId, [node]);
  }
  const neighbours = new Map<string, ConnectableOpeningWallObject[]>();
  for (const node of graphNodes) {
    const counterpartWallId = confirmedWallOf(node.id);
    const facing = counterpartWallId ? (nodesByWallId.get(counterpartWallId) ?? []) : [];
    neighbours.set(
      node.id,
      // Mutual by construction: each must be on the OTHER's confirmed wall.
      facing.filter(
        (other) => confirmedWallOf(other.id) === node.wallId && readsAsOneOpening(node, other)
      )
    );
  }

  // Connected components, walked from the sorted node list so the traversal is
  // deterministic even though the result no longer depends on it.
  const componentOf = new Map<string, string[]>();
  for (const node of graphNodes) {
    if (componentOf.has(node.id)) continue;
    const members: string[] = [];
    const queue = [node.id];
    const seen = new Set<string>([node.id]);
    while (queue.length > 0) {
      const currentId = queue.shift() as string;
      members.push(currentId);
      for (const other of neighbours.get(currentId) ?? []) {
        if (seen.has(other.id)) continue;
        seen.add(other.id);
        queue.push(other.id);
      }
    }
    members.sort((a, b) => a.localeCompare(b));
    for (const memberId of members) componentOf.set(memberId, members);
  }

  const resolvedByComponent = new Set<string>();

  for (const opening of unpaired) {
    if (resolvedByComponent.has(opening.id)) continue;

    const component = componentOf.get(opening.id);
    if (component && component.length > 1) {
      for (const memberId of component) resolvedByComponent.add(memberId);
      const members = component.flatMap((memberId) => unpairedById.get(memberId) ?? []);
      // Either end of a cluster pulls the whole cluster into scope: adopting is
      // symmetric, and a conflict about a cluster is not about one half of it.
      if (!members.some(isInScope)) continue;

      // Exactly one edge, both endpoints degree 1 — the only shape where the
      // document can be repaired without picking for the user. (A two-member
      // component is connected, so it is exactly that shape.)
      if (component.length === 2) {
        actions.push({
          kind: "adopt",
          openingId: component[0],
          counterpartOpeningId: component[1]
        });
        continue;
      }

      // Any larger cluster: ONE conflict for the whole thing, keyed on the
      // lexicographically smallest member.
      const keyedId = component[0];
      // `members` is sorted, so the keyed opening's own wall lands first — the
      // [own wall, ...counterparts] shape every other conflict uses.
      const wallIds: string[] = [];
      for (const member of members) {
        if (!wallIds.includes(member.wallId)) wallIds.push(member.wallId);
      }
      addConflict("ambiguous-counterpart-opening", keyedId, {
        wallIds,
        candidates: (neighbours.get(keyedId) ?? []).map((candidate) => ({
          kind: "opening" as const,
          openingId: candidate.id
        })),
        memberIds: component
      });
      continue;
    }

    if (!isInScope(opening)) continue;

    const placement = placements.get(opening.id);
    if (!placement || placement.kind === "exterior") continue;

    if (placement.kind === "overhang") {
      // Explicitly NOT "exterior" — the walls really are shared here, the
      // opening just runs off the end of the part they share.
      addConflict("overhangs-common-span", opening.id, {
        wallIds: [opening.wallId, ...placement.boundaries.map((boundary) => boundary.wallId)]
      });
      continue;
    }

    if (placement.kind === "ambiguous-wall") {
      addConflict("ambiguous-boundary-wall", opening.id, {
        wallIds: [opening.wallId, ...placement.boundaries.map((boundary) => boundary.wallId)],
        candidates: ambiguousWallCandidates.get(opening.id) ?? []
      });
      continue;
    }

    // An unresolved ambiguous-boundary-wall conflict is offering this opening as
    // one of its resolution targets. Say nothing about it: creating its own twin
    // (or reporting the offering opening as an obstruction) would consume or
    // duplicate a target the user has not chosen between yet. Withheld openings
    // are excluded from the adoption graph for the same reason, but only the
    // PAIRING rungs are suppressed — an ambiguity or overhang of its own is
    // independent information and is still reported above.
    if (withheld.has(opening.id)) continue;

    // Confirmed counterpart wall, no adoption candidate anywhere on it.
    const counterpartWallId = placement.counterpartWallId;
    const slot = mirrorSlot(project, wallsById, opening, counterpartWallId);
    if (slot.status === "free") {
      actions.push({
        kind: "create-twin",
        openingId: opening.id,
        wallId: counterpartWallId,
        xMm: slot.xMm
      });
      continue;
    }

    // An opening sitting in the mirrored slot that we could not adopt (wrong
    // kind, already paired, or too misaligned) is a different explanation from
    // a blocked zone or a wall we cannot map onto, so they get different
    // reasons — Stage 7 names the obstruction either way.
    addConflict(
      slot.blocker && isConnectableOpening(slot.blocker)
        ? "counterpart-occupied"
        : "blocked-mirror-slot",
      opening.id,
      {
        wallIds: [opening.wallId, counterpartWallId],
        ...(slot.blocker ? { blockerId: slot.blocker.id } : {})
      }
    );
  }

  // ---------------------------------------------------------------------
  // Phase 2 — existing pairs. Three-way: healthy, repairable, or reportable.
  // ---------------------------------------------------------------------
  //
  // This is what covers a room sliding while staying adjacent — the case that
  // previously produced neither a repair nor a conflict.
  const seenPairKeys = new Set<string>();
  const pairs: [ConnectableOpeningWallObject, ConnectableOpeningWallObject][] = [];
  for (const opening of openings) {
    if (opening.connectsToObjectId === undefined) continue;
    const partner = objectsById.get(opening.connectsToObjectId);
    if (!isStructurallyValidPair(opening, partner) || !isConnectableOpening(partner)) continue;
    // Keyed on the lexicographically smaller half, so each pair is reported
    // once whichever way round the array happens to be ordered.
    const [first, second] =
      opening.id.localeCompare(partner.id) <= 0 ? [opening, partner] : [partner, opening];
    if (seenPairKeys.has(first.id)) continue;
    seenPairKeys.add(first.id);
    pairs.push([first, second]);
  }
  pairs.sort((a, b) => a[0].id.localeCompare(b[0].id));

  for (const [first, second] of pairs) {
    if (!isInScope(first) && !isInScope(second)) continue;

    // Pairwise, never derived from discovery (architecture rule 2): a third
    // wall nearby makes DISCOVERY ambiguous but says nothing about whether
    // these two walls still face each other.
    if (!areSharedBoundaryWalls(project, first.wallId, second.wallId)) {
      addConflict("boundary-lost", first.id, {
        wallIds: [first.wallId, second.wallId],
        partnerId: second.id
      });
      continue;
    }

    const firstSpan = boundaryBetween(first.wallId, second.wallId);
    const secondSpan = boundaryBetween(second.wallId, first.wallId);
    const partnerXMm = mirrorOpeningXMm(project, first.wallId, second.wallId, first.xMm);
    if (!firstSpan || !secondSpan || partnerXMm === null) {
      // Unreachable while areSharedBoundaryWalls holds (it runs the same
      // pairwise test, which already requires both walls to exist and be
      // non-degenerate). Reported rather than skipped so a future divergence
      // surfaces instead of silently dropping a pair.
      addConflict("boundary-lost", first.id, {
        wallIds: [first.wallId, second.wallId],
        partnerId: second.id
      });
      continue;
    }

    // Span containment is checked BEFORE drift on purpose. A pair can be
    // perfectly mirrored and still hang off the end of the run its two rooms
    // now share — that is not "healthy", it is an opening into nothing.
    const firstFits = isWithinSpan(extentOf(first.xMm, first.widthMm), firstSpan);
    const secondFits = isWithinSpan(extentOf(partnerXMm, second.widthMm), secondSpan);
    if (!firstFits || !secondFits) {
      addConflict("paired-overhang", first.id, {
        wallIds: [first.wallId, second.wallId],
        partnerId: second.id
      });
      continue;
    }

    // Two halves of ONE physical opening that are not the same size or hang at
    // different heights. Only x is mirrored, so drift on width/height/y is
    // invisible to the check below — a pair with a 900 mm door on one side and a
    // 1800 mm one on the other reads as perfectly healthy. Stage 3 stops new
    // mismatches at the edit paths; this is the only thing that can explain an
    // IMPORTED one.
    //
    // Deliberately no repair and no authoritative half. Unlike x drift, there is
    // no geometric answer to which size is right, and a lexicographic default
    // would silently resize whichever half happened to sort second. Stage 6's
    // Realign establishes authority from the half the user selected.
    if (
      Math.abs(first.widthMm - second.widthMm) > SHARED_OPENING_GEOMETRY_TOLERANCE_MM ||
      Math.abs(first.heightMm - second.heightMm) > SHARED_OPENING_GEOMETRY_TOLERANCE_MM ||
      Math.abs(first.yMm - second.yMm) > SHARED_OPENING_GEOMETRY_TOLERANCE_MM
    ) {
      addConflict("paired-geometry-mismatch", first.id, {
        wallIds: [first.wallId, second.wallId],
        partnerId: second.id
      });
      continue;
    }

    if (Math.abs(second.xMm - partnerXMm) <= SHARED_OPENING_MIRROR_TOLERANCE_MM) continue;

    // Drifted with a live boundary. The lexicographically smaller half is
    // authoritative so the whole-project pass is deterministic; the direct
    // edit paths (Stage 3) and the inspector's Realign (Stage 6) name their own
    // authoritative half instead of relying on this default.
    const secondWall = wallsById.get(second.wallId);
    if (
      secondWall &&
      !isOpeningSlotFree(
        project,
        secondWall,
        { widthMm: second.widthMm, heightMm: second.heightMm },
        second.yMm,
        partnerXMm,
        second.id
      )
    ) {
      const blocker = findSlotBlocker(project, second.wallId, second, partnerXMm, second.id);
      addConflict("blocked-mirror-slot", first.id, {
        wallIds: [first.wallId, second.wallId],
        partnerId: second.id,
        ...(blocker ? { blockerId: blocker.id } : {})
      });
      continue;
    }

    actions.push({
      kind: "realign",
      authoritativeOpeningId: first.id,
      partnerOpeningId: second.id,
      partnerXMm
    });
  }

  // Per-opening resolution targets, from the same two sources the conflicts
  // above draw on — graph adjacency for a cluster, and the ambiguous-wall
  // candidate list for an opening backed by more than one room. Built for every
  // opening that has one, not only the ones that ended up keying a conflict, so
  // a cluster's non-keyed members can be resolved from their own neighbours.
  const candidatesByOpeningId = new Map<string, SharedOpeningTarget[]>();
  for (const node of graphNodes) {
    const facing = neighbours.get(node.id) ?? [];
    if (facing.length === 0) continue;
    candidatesByOpeningId.set(
      node.id,
      facing.map((candidate) => ({ kind: "opening" as const, openingId: candidate.id }))
    );
  }
  for (const [openingId, candidates] of ambiguousWallCandidates) {
    if (candidates.length > 0) candidatesByOpeningId.set(openingId, candidates);
  }

  return { actions, conflicts, candidatesByOpeningId };
}

type MirrorSlot =
  | { status: "free"; xMm: number }
  | { status: "blocked"; blocker: WallObject | null };

// Where `opening` would land on `counterpartWallId`, and whether that slot is
// clear. The twin copies the primary's ACTUAL geometry, so the slot is tested
// with the primary's width/height/y rather than the kind's defaults.
function mirrorSlot(
  project: Project,
  wallsById: ReadonlyMap<string, FloorWall>,
  opening: ConnectableOpeningWallObject,
  counterpartWallId: string
): MirrorSlot {
  const counterpartWall = wallsById.get(counterpartWallId);
  const xMm = mirrorOpeningXMm(project, opening.wallId, counterpartWallId, opening.xMm);
  if (!counterpartWall || xMm === null) return { status: "blocked", blocker: null };

  const free = isOpeningSlotFree(
    project,
    counterpartWall,
    { widthMm: opening.widthMm, heightMm: opening.heightMm },
    opening.yMm,
    xMm,
    null
  );
  if (free) return { status: "free", xMm };
  return {
    status: "blocked",
    blocker: findSlotBlocker(project, counterpartWallId, opening, xMm, null)
  };
}

// The object standing in a mirrored slot, using the same strict-overlap rule
// findFreeOpeningCenterXMm applies. Only blocking kinds are considered, so the
// candidates are exactly doors, windows and blocked zones; a door or window is
// preferred over a blocked zone because it produces the more useful
// explanation ("already part of another shared opening" vs "no room here").
function findSlotBlocker(
  project: Project,
  wallId: string,
  opening: { widthMm: number; heightMm: number; yMm: number },
  xMm: number,
  ignoreOpeningId: string | null
): WallObject | null {
  const halfWidthMm = opening.widthMm / 2;
  const halfHeightMm = opening.heightMm / 2;
  const overlapping = project.wallObjects
    .filter(
      (object) =>
        object.wallId === wallId &&
        // Same predicate isOpeningSlotFree uses to decide the slot is taken. A
        // second, looser filter here could name a wall label as the blocker of a
        // slot the label is not blocking — and, since ties break on id, could
        // name it in preference to the blocked zone that actually is.
        isBlockingKind(object.kind) &&
        object.id !== ignoreOpeningId &&
        Math.abs(object.yMm - opening.yMm) < halfHeightMm + object.heightMm / 2 &&
        Math.abs(object.xMm - xMm) < halfWidthMm + object.widthMm / 2
    )
    .sort(byIdAscending);
  return overlapping.find(isConnectableOpening) ?? overlapping[0] ?? null;
}

// How two halves that are becoming (or already are) one physical opening
// settle their handing. `authoritative` is the half whose handing wins a real
// conflict — the primary the user acted on for an adoption, the
// lexicographically smaller half for the whole-document load pass.
//
//   hinged + doorway (either order) -> HINGED WINS: the leaf propagates
//                                      (mirrored) onto the doorway half
//   two hinged, conflicting handing -> the authoritative half wins
//   doorway + doorway               -> unchanged
//
// "Lexically smaller wins" is rejected outright for the first row: it can
// silently erase the only hinged leaf in the pair. Hinged-wins never destroys
// data, and — at the edit paths — it is one undoable edit.
//
// Returned as the pair of leaves to store on (authoritative, counterpart), so
// the caller never has to remember which side gets mirrored.
export function resolveSharedDoorLeaves(
  authoritative: ConnectableOpeningWallObject,
  counterpart: ConnectableOpeningWallObject
): { authoritativeLeaf: DoorLeaf | undefined; counterpartLeaf: DoorLeaf | undefined } {
  // A window pair has nothing to resolve; the type already says so, this only
  // narrows it.
  if (authoritative.kind !== "door" || counterpart.kind !== "door") {
    return { authoritativeLeaf: undefined, counterpartLeaf: undefined };
  }
  // The only row where the non-authoritative half wins: it is the sole hinged
  // leaf in the pair, and dropping it would be the data loss the table exists
  // to avoid.
  const winner = authoritative.leaf ?? counterpart.leaf;
  if (!winner) return { authoritativeLeaf: undefined, counterpartLeaf: undefined };
  return authoritative.leaf
    ? { authoritativeLeaf: winner, counterpartLeaf: mirrorDoorLeaf(winner) }
    : { authoritativeLeaf: mirrorDoorLeaf(winner), counterpartLeaf: winner };
}

// Set or clear `leaf` on a connectable opening. Clearing DELETES the key rather
// than writing `undefined`, so a doorway serializes exactly as it did before
// hinging existed (and structural equality in tests still holds).
export function withDoorLeaf(
  opening: ConnectableOpeningWallObject,
  leaf: DoorLeaf | undefined
): ConnectableOpeningWallObject {
  if (opening.kind !== "door") return opening;
  if (leaf) return { ...opening, leaf };
  const { leaf: _cleared, ...rest } = opening;
  return rest;
}

// The only half of this module that constructs anything.
//
// CONTRACT: `actions` MUST come from `analyzeSharedOpenings` of this exact
// `project` value. The caller owns that — Stage 4 re-analyzes the project it is
// about to write, and a resolver acting on an older document must re-analyze
// before applying, not hand an older analysis to this function.
//
// The per-action guards below are INTEGRITY checks against malformed or
// duplicated input, not staleness protection. They verify only that ids resolve,
// that the objects are connectable openings of the same kind on different walls,
// and that no pointer is being overwritten — enough to keep a repeated or
// hand-written action from corrupting an existing pairing. They do NOT re-derive
// anything geometric — shared topology, span fit, boundary ambiguity and mirror
// slot freedom are never re-checked here — so an action computed against a
// DIFFERENT project value can still be applied to a boundary that has since
// moved, become occupied, or become ambiguous. Nothing here will catch that.
export function applySharedOpeningActions(
  project: Project,
  actions: SharedOpeningAction[],
  newObjectId: () => string
): AppliedSharedOpeningActions {
  const formedPairIds: [string, string][] = [];
  const createdOpeningIds: string[] = [];
  const realignedIds: string[] = [];

  // Same-reference convention as normalizeOpeningPairs (openingPairs.ts:123):
  // callers memoize on project identity, so a no-op must not mint a new object.
  if (actions.length === 0) {
    return { project, formedPairIds, createdOpeningIds, realignedIds };
  }

  const wallObjects = [...project.wallObjects];
  const indexById = new Map(wallObjects.map((object, index) => [object.id, index]));

  const connectableAt = (id: string): ConnectableOpeningWallObject | null => {
    const index = indexById.get(id);
    if (index === undefined) return null;
    const object = wallObjects[index];
    return isConnectableOpening(object) ? object : null;
  };
  const replace = (id: string, next: ConnectableOpeningWallObject): void => {
    const index = indexById.get(id);
    if (index !== undefined) wallObjects[index] = next;
  };

  for (const action of actions) {
    if (action.kind === "adopt") {
      const primary = connectableAt(action.openingId);
      const counterpart = connectableAt(action.counterpartOpeningId);
      if (
        !primary ||
        !counterpart ||
        primary.id === counterpart.id ||
        primary.kind !== counterpart.kind ||
        primary.wallId === counterpart.wallId ||
        primary.connectsToObjectId !== undefined ||
        counterpart.connectsToObjectId !== undefined
      ) {
        continue;
      }
      // Handing is settled here and nowhere else: two authored leaves can
      // disagree only at the moment they become one opening. `primary` is the
      // half the user acted on, so it is the authoritative one.
      //
      // No boundary re-derivation, consistent with this function's no-geometry
      // rule: every `adopt` reaches here from the analyzer's facing-wall graph,
      // so the two walls already ARE a shared boundary and the mirror applies.
      const { authoritativeLeaf, counterpartLeaf } = resolveSharedDoorLeaves(primary, counterpart);
      replace(
        primary.id,
        withDoorLeaf({ ...primary, connectsToObjectId: counterpart.id }, authoritativeLeaf)
      );
      replace(
        counterpart.id,
        withDoorLeaf({ ...counterpart, connectsToObjectId: primary.id }, counterpartLeaf)
      );
      formedPairIds.push([primary.id, counterpart.id]);
      continue;
    }

    if (action.kind === "create-twin") {
      const primary = connectableAt(action.openingId);
      if (!primary || primary.connectsToObjectId !== undefined) continue;
      if (primary.wallId === action.wallId) continue;

      // Verbatim from the primary: kind, widthMm, heightMm, yMm and
      // blocksPlacement. Only xMm is mirrored. Copying yMm is what makes a
      // mirrored WINDOW sit at the same height rather than snapping back to the
      // wall's default centerline — the divergence that made the old
      // getDefaultOpeningSizeMm-based twin wrong.
      //
      // `leaf` is the one other thing that is mirrored rather than copied: the
      // twin is the same physical door seen from the other room, so its handing
      // has to be restated in the twin wall's own (opposite) frame.
      const twinId = newObjectId();
      const twinBase = {
        id: twinId,
        blocksPlacement: primary.blocksPlacement,
        wallId: action.wallId,
        xMm: action.xMm,
        yMm: primary.yMm,
        widthMm: primary.widthMm,
        heightMm: primary.heightMm,
        connectsToObjectId: primary.id
      };
      // Branching on kind rather than passing `primary.kind` through: with the
      // union split, only a literal can discriminate, and only the door branch
      // may carry a leaf at all.
      const twin: ConnectableOpeningWallObject =
        primary.kind === "door"
          ? withDoorLeaf(
              { ...twinBase, kind: "door" },
              primary.leaf ? mirrorDoorLeaf(primary.leaf) : undefined
            )
          : { ...twinBase, kind: "window" };
      replace(primary.id, { ...primary, connectsToObjectId: twinId });
      indexById.set(twinId, wallObjects.length);
      wallObjects.push(twin);
      createdOpeningIds.push(twinId);
      formedPairIds.push([primary.id, twinId]);
      continue;
    }

    const authoritative = connectableAt(action.authoritativeOpeningId);
    const partner = connectableAt(action.partnerOpeningId);
    if (!authoritative || !partner || !isStructurallyValidPair(authoritative, partner)) continue;
    replace(partner.id, { ...partner, xMm: action.partnerXMm });
    realignedIds.push(partner.id);
  }

  // Every action was stale: keep the caller's identity check meaningful.
  if (formedPairIds.length === 0 && realignedIds.length === 0) {
    return { project, formedPairIds, createdOpeningIds, realignedIds };
  }

  return {
    project: { ...project, wallObjects },
    formedPairIds,
    createdOpeningIds,
    realignedIds
  };
}
