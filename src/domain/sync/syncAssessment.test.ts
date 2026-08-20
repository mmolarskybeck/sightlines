import { describe, expect, it } from "vitest";
import { assessSync } from "./syncAssessment";

// A project whose local copy and Dropbox head both still sit on the accepted
// base — the one case that needs no work. Each test perturbs one side.
const AT_BASE = {
  localFingerprint: "fp-base",
  baseFingerprint: "fp-base",
  baseRev: "rev-base",
  remoteRev: "rev-base" as string | null
};

describe("assessSync", () => {
  it("is synced when neither side moved", () => {
    expect(assessSync(AT_BASE)).toBe("synced");
  });

  it("pushes when only this device changed", () => {
    expect(assessSync({ ...AT_BASE, localFingerprint: "fp-local" })).toBe("push");
  });

  it("pulls when only the Dropbox head moved", () => {
    expect(assessSync({ ...AT_BASE, remoteRev: "rev-newer" })).toBe("pull");
  });

  it("conflicts when both sides moved since the accepted base", () => {
    expect(
      assessSync({
        ...AT_BASE,
        localFingerprint: "fp-local",
        remoteRev: "rev-newer"
      })
    ).toBe("conflict");
  });

  // A missing head outranks every other reading: there is nothing to reconcile
  // against, and it must never be silently recreated.
  it("reports a missing head whether or not this device changed", () => {
    expect(assessSync({ ...AT_BASE, remoteRev: null })).toBe("remote-missing");
    expect(
      assessSync({ ...AT_BASE, localFingerprint: "fp-local", remoteRev: null })
    ).toBe("remote-missing");
  });

  // Lineage is the rev alone. A remote that came back to the base revision is
  // the base, no matter what any clock says.
  it("never infers direction from anything but the rev and the fingerprint", () => {
    expect(
      assessSync({
        localFingerprint: "fp-base",
        baseFingerprint: "fp-base",
        baseRev: "rev-base",
        remoteRev: "rev-base"
      })
    ).toBe("synced");
  });
});
