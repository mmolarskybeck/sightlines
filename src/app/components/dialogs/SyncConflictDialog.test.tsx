import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncConflictRecord } from "../../store/cloudSyncSlice";
import { SyncConflictDialog } from "./SyncConflictDialog";

afterEach(cleanup);

// The binding rides along on every parked conflict (which project, and how it
// fingerprinted when the decision was parked); the dialog itself never reads it.
const BINDING = { projectId: "project-1", localFingerprint: "fp-local" };

const BOTH_CHANGED: SyncConflictRecord = {
  remoteRev: "0123456789abcdef",
  remoteModifiedIso: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  remoteMissing: false,
  binding: BINDING
};

const REMOTE_MISSING: SyncConflictRecord = {
  remoteRev: null,
  remoteModifiedIso: null,
  remoteMissing: true,
  binding: BINDING
};

function renderDialog(conflict: SyncConflictRecord | null) {
  const onResolve = vi.fn();
  const onDisableSync = vi.fn();
  render(
    <SyncConflictDialog
      conflict={conflict}
      onDisableSync={onDisableSync}
      onResolve={onResolve}
    />
  );
  return { onResolve, onDisableSync };
}

describe("SyncConflictDialog", () => {
  it("renders nothing without a parked conflict", () => {
    renderDialog(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers the four whole-project choices, each naming its direction", () => {
    renderDialog(BOTH_CHANGED);

    expect(screen.getByText("This project changed in two places")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Use the Dropbox version/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Keep this device’s version/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Keep both/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Not now/ })).toBeInTheDocument();

    // The naming rule from docs/cloud-sync-plan.md: replacement is named as a
    // direction, in project language. Filesystem verbs are the failure mode.
    expect(screen.getByText(/Replaces the project on this device/)).toBeInTheDocument();
    expect(screen.getByText(/Replaces the version in Dropbox/)).toBeInTheDocument();
    expect(screen.queryByText(/override/i)).not.toBeInTheDocument();
  });

  it("fires the matching resolution for each choice", () => {
    const { onResolve } = renderDialog(BOTH_CHANGED);

    fireEvent.click(screen.getByRole("button", { name: /Use the Dropbox version/ }));
    expect(onResolve).toHaveBeenCalledWith("use-dropbox");

    fireEvent.click(screen.getByRole("button", { name: /Keep this device’s version/ }));
    expect(onResolve).toHaveBeenCalledWith("keep-mine");

    fireEvent.click(screen.getByRole("button", { name: /^Keep both/ }));
    expect(onResolve).toHaveBeenCalledWith("keep-both");

    fireEvent.click(screen.getByRole("button", { name: /Not now/ }));
    expect(onResolve).toHaveBeenCalledWith("not-now");
  });

  // Timestamps are display only — they answer "which other version is this?",
  // never which one is newer (the rev is the lineage).
  it("shows when the Dropbox version last changed, when that is known", () => {
    renderDialog(BOTH_CHANGED);
    expect(screen.getByText("The Dropbox version last changed 2 h ago.")).toBeInTheDocument();
  });

  it("has no recovery-snapshot promise it cannot keep on the Dropbox choice", () => {
    renderDialog(BOTH_CHANGED);
    expect(screen.getByText(/A recovery snapshot is kept/)).toBeInTheDocument();
  });

  // Dismissing is postponing, never a silent pick: Escape must land on the same
  // persisted "Needs review" the quiet option does.
  it("treats a dismissal as Not now", () => {
    const { onResolve } = renderDialog(BOTH_CHANGED);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onResolve).toHaveBeenCalledWith("not-now");
  });

  describe("when the synced copy is missing", () => {
    it("offers to put this version back, to unlink, or to wait", () => {
      const { onResolve, onDisableSync } = renderDialog(REMOTE_MISSING);

      expect(
        screen.getByText("This project’s synced copy is missing from Dropbox")
      ).toBeInTheDocument();
      // No "use the Dropbox version": there is no Dropbox version to use.
      expect(
        screen.queryByRole("button", { name: /Use the Dropbox version/ })
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Keep both/ })).not.toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: /Put this version back in Dropbox/ })
      );
      expect(onResolve).toHaveBeenCalledWith("keep-mine");

      // Unlinking is not a conflict resolution — it drops this device's
      // bookkeeping and leaves the project alone.
      fireEvent.click(
        screen.getByRole("button", { name: /Turn off sync for this project/ })
      );
      expect(onDisableSync).toHaveBeenCalled();
      expect(onResolve).not.toHaveBeenCalledWith("keep-both");

      fireEvent.click(screen.getByRole("button", { name: /Not now/ }));
      expect(onResolve).toHaveBeenCalledWith("not-now");
    });

    it("says nothing about a remote timestamp there is no file for", () => {
      renderDialog(REMOTE_MISSING);
      expect(screen.queryByText(/last changed/)).not.toBeInTheDocument();
    });
  });
});
