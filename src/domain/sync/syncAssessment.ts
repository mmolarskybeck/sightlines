// The sync state machine, as one pure function. Everything the decision needs
// is a comparison against the accepted base: the local fingerprint against the
// fingerprint recorded at that base, and the remote revision against the base
// revision. No clocks — timestamps never establish ancestry (devices disagree,
// and upload order is not lineage).

export type SyncAssessment =
  | "synced"
  | "push"
  | "pull"
  | "conflict"
  | "remote-missing";

export function assessSync(input: {
  localFingerprint: string;
  // meta.fingerprintAtRev — what this device's copy looked like at the base.
  baseFingerprint: string;
  // meta.lastAcceptedRev — the revision this device's copy descends from.
  baseRev: string;
  // null = the head is not in Dropbox (never created, or removed there).
  remoteRev: string | null;
}): SyncAssessment {
  // A missing head outranks every other reading: whether this device also has
  // changes is irrelevant when there is nothing to reconcile against, and it
  // must never be silently recreated.
  if (input.remoteRev === null) return "remote-missing";

  const localChanged = input.localFingerprint !== input.baseFingerprint;
  const remoteChanged = input.remoteRev !== input.baseRev;

  // Both sides moved: Sightlines does not merge layouts, so this stops here and
  // the curator chooses a whole version.
  if (localChanged && remoteChanged) return "conflict";
  if (localChanged) return "push";
  if (remoteChanged) return "pull";
  return "synced";
}
