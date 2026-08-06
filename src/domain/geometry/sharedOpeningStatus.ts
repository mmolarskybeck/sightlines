import { isStructurallyValidPair } from "../placement/openingPairs";
import {
  analyzeSharedOpenings,
  sharedOpeningCandidates,
  type SharedOpeningConflict,
  type SharedOpeningConflictReason,
  type SharedOpeningTarget
} from "../placement/sharedOpeningAnalysis";
import type { ConnectableOpeningWallObject, Project, WallObject } from "../project";

// What the inspector needs to know about ONE selected opening, as structured
// data. Deliberately no copy: sentences, room names and button labels are the
// app layer's job (`sharedOpeningIssueCopy.ts` lives in `src/app/` for exactly
// this reason — putting a copy layer in `src/domain/` forced the repo's first
// `domain -> app` import). This module returns a state and a list of the
// resolutions that state admits; nothing here is user-visible text.

// The resolutions Stage 6's store actions expose, named after the store action
// each one drives — `resolve` -> `resolveSharedOpening`, `complete` ->
// `completeSharedOpening`, `realign` -> `realignSharedOpening`, `split` ->
// `splitSharedOpening`, `keep-this-only` -> `keepThisOpeningOnly`.
export type SharedOpeningResolution =
  | "resolve" // pick a target from `candidates`
  | "complete" // create the twin the load pass declined
  | "realign" // mirror the selected half onto its partner
  | "split" // keep both as separate openings
  | "keep-this-only"; // delete the partner

export type SharedOpeningStatus =
  | { kind: "exposed" }
  | { kind: "shared"; partnerId: string }
  | { kind: "drifted"; partnerId: string }
  | {
      kind: "conflict";
      conflict: SharedOpeningConflict;
      partnerId: string | null;
      candidates: SharedOpeningTarget[];
    };

const EXPOSED: SharedOpeningStatus = { kind: "exposed" };

function isConnectableOpening(
  wallObject: WallObject | undefined
): wallObject is ConnectableOpeningWallObject {
  return wallObject?.kind === "door" || wallObject?.kind === "window";
}

// The partner this opening is CURRENTLY joined to, or null. Structural validity
// only — the same pointer-level test `normalizeOpeningPairs` uses — because a
// pair keeps its identity when the rooms move apart (settled decision 3), so
// `boundary-lost` still has a live partner to offer resolutions about.
function livePartnerId(project: Project, opening: ConnectableOpeningWallObject): string | null {
  const partnerId = opening.connectsToObjectId;
  if (partnerId === undefined) return null;
  const partner = project.wallObjects.find((object) => object.id === partnerId);
  return isStructurallyValidPair(opening, partner) ? partnerId : null;
}

// Whether a conflict is ABOUT this opening, and how directly — lower is
// stronger. Three ways a conflict can name an opening:
//
//   0. `openingId` — it is keyed on this opening.
//   1. `partnerId` — it is a PHASE 2 conflict keyed on the other half. Every
//      pair conflict (`boundary-lost`, `paired-overhang`,
//      `paired-geometry-mismatch`, and phase 2's `blocked-mirror-slot`) is
//      keyed on the lexicographically smaller half, so without this rung the
//      larger half of a broken pair would read as a healthy `shared` opening.
//   2. `memberIds` — the `ambiguous-counterpart-opening` cluster case. One
//      conflict stands for a whole connected cluster and is keyed on its
//      lexicographically smallest member; the analyzer's comment is explicit
//      that Stage 7 must surface it for WHICHEVER member the user selects.
//
// Rank, then id, so a hypothetical multi-match is decided by a stated rule
// rather than by the analyzer's emission order. (The analyzer skips every
// cluster member before it can emit anything else about it, and a paired
// opening never reaches phase 1, so no fixture reaches this tie-break today —
// it exists so a future reason cannot make the answer order-dependent.)
function conflictRank(conflict: SharedOpeningConflict, openingId: string): number | null {
  if (conflict.openingId === openingId) return 0;
  if (conflict.partnerId === openingId) return 1;
  if (conflict.memberIds?.includes(openingId) ?? false) return 2;
  return null;
}

function pickConflict(
  conflicts: SharedOpeningConflict[],
  openingId: string
): SharedOpeningConflict | null {
  let best: SharedOpeningConflict | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const conflict of conflicts) {
    const rank = conflictRank(conflict, openingId);
    if (rank === null) continue;
    if (rank < bestRank || (rank === bestRank && best !== null && conflict.id < best.id)) {
      best = conflict;
      bestRank = rank;
    }
  }
  return best;
}

// A declined `create-twin` as a `missing-twin` conflict.
//
// MUST stay byte-for-byte equivalent to the mapping in
// `src/domain/placement/sharedOpeningIssues.ts` (`selectSharedOpeningConflicts`):
// the issues rail and the inspector describe the same problem, and a row the
// user clicks must open an inspector showing the conflict with the SAME `id`.
// If one of the two changes, change both.
function missingTwinConflict(
  openingId: string,
  ownWallId: string,
  twinWallId: string
): SharedOpeningConflict {
  return {
    id: `${openingId}:missing-twin`,
    reason: "missing-twin",
    openingId,
    // [own wall, ...counterpart walls], per SharedOpeningConflict's contract.
    // No `candidates`: completing this is one fixed repair, not a pick.
    wallIds: [ownWallId, twinWallId]
  };
}

export function getSharedOpeningStatus(project: Project, openingId: string): SharedOpeningStatus {
  const opening = project.wallObjects.find((object) => object.id === openingId);
  if (!isConnectableOpening(opening)) return EXPOSED;

  // SCOPED, deliberately. This runs from a React render path and the whole-
  // document pass is the perf trap the plan calls out explicitly
  // (`selectSharedOpeningConflicts` is the unscoped one, memoized on project
  // identity in App.tsx). The scope is still wide enough for every state:
  //
  //   - a cluster is in scope if ANY member is (`!members.some(isInScope)`),
  //     so selecting a non-keyed member still surfaces the cluster conflict;
  //   - a pair is in scope if EITHER half is (`!isInScope(first) &&
  //     !isInScope(second)`), so a partner on a wall we never named still
  //     surfaces the pair's conflict or its `realign`;
  //   - rung 1 (span fit) and the adoption graph are computed over the whole
  //     project regardless of scope, so narrowing can never manufacture an
  //     answer the whole-document pass would have refused.
  const { actions, conflicts } = analyzeSharedOpenings(project, {
    openingIds: [openingId],
    wallIds: [opening.wallId]
  });

  const partnerId = livePartnerId(project, opening);

  const conflict = pickConflict(conflicts, openingId);
  if (conflict) return conflictStatus(project, openingId, conflict, partnerId);

  // The analyzer never emits `missing-twin` itself — it emits the `create-twin`
  // ACTION nobody will apply on load, and Stage 5 turns that into the conflict.
  // Same remap here, so the inspector and the issues rail agree.
  const createTwin = actions.find(
    (action) => action.kind === "create-twin" && action.openingId === openingId
  );
  if (createTwin && createTwin.kind === "create-twin") {
    return conflictStatus(
      project,
      openingId,
      missingTwinConflict(openingId, opening.wallId, createTwin.wallId),
      partnerId
    );
  }

  const drifted = actions.some(
    (action) =>
      action.kind === "realign" &&
      (action.authoritativeOpeningId === openingId || action.partnerOpeningId === openingId)
  );
  // `partnerId !== null` is narrowing, not a real branch: phase 2 only emits
  // `realign` for a pair that already passed `isStructurallyValidPair`.
  if (drifted && partnerId !== null) return { kind: "drifted", partnerId };

  if (partnerId !== null) return { kind: "shared", partnerId };

  return EXPOSED;
}

function conflictStatus(
  project: Project,
  openingId: string,
  conflict: SharedOpeningConflict,
  partnerId: string | null
): SharedOpeningStatus {
  // `conflict.candidates` are the KEYED opening's targets. For a cluster
  // conflict keyed on a DIFFERENT opening they are wrong for this one —
  // offering them would advertise a pairing this opening cannot form — so ask
  // per opening instead. That call runs an UNSCOPED pass, so only make it when
  // the state actually offers a pick.
  const candidates = conflictResolutions(conflict.reason).includes("resolve")
    ? sharedOpeningCandidates(project, openingId)
    : [];
  return { kind: "conflict", conflict, partnerId, candidates };
}

// The Stage 7 state -> resolution table. The `never` default is load-bearing:
// a tenth `SharedOpeningConflictReason` must be a compile error here, not a
// silent empty list that renders a caution nobody can act on.
function conflictResolutions(reason: SharedOpeningConflictReason): SharedOpeningResolution[] {
  switch (reason) {
    // Genuinely two rooms behind one opening, or several openings that could be
    // the other face. Only the user can pick.
    case "ambiguous-boundary-wall":
    case "ambiguous-counterpart-opening":
      return ["resolve"];

    // The load pass declined to create geometry in a document the user just
    // opened; completing it is one fixed repair.
    case "missing-twin":
      return ["complete"];

    // No geometric basis for choosing which half is right, so the user's
    // selection supplies the authority. Same single resolution as `drifted`.
    case "paired-geometry-mismatch":
      return ["realign"];

    // The rooms no longer meet. Both halves are real openings now; the user
    // decides whether they keep both or only the one they are looking at.
    case "boundary-lost":
      return ["split", "keep-this-only"];

    // Nothing to offer. The walls are shared but the opening runs past the run
    // the rooms actually have in common, or the mirrored slot is taken —
    // resolving either means moving geometry, which the user does directly.
    case "overhangs-common-span":
    case "paired-overhang":
    case "blocked-mirror-slot":
    case "counterpart-occupied":
      return [];

    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function sharedOpeningResolutions(status: SharedOpeningStatus): SharedOpeningResolution[] {
  switch (status.kind) {
    // Today's "No door on a facing wall to pair with." is mechanism talk and
    // goes away entirely — an exposed opening is not a problem.
    case "exposed":
      return [];

    // One quiet static line. Pairing is a consequence of wall topology, not a
    // user-managed field, so there is no Disconnect and no dropdown.
    case "shared":
      return [];

    // Live boundary, drifted halves. Split is refused here by design: these
    // really are two faces of one opening.
    case "drifted":
      return ["realign"];

    case "conflict":
      return conflictResolutions(status.conflict.reason);

    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
