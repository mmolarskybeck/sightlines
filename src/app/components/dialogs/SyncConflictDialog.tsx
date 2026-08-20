import { formatBackupRelativeTime } from "../../cloud/cloudBackupCopy";
import type {
  SyncConflictChoice,
  SyncConflictRecord
} from "../../store/cloudSyncSlice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";

// The whole-project decision, and the only place the user is ever asked it
// (docs/cloud-sync-plan.md, "Conflict UX"). Two rules govern every string here:
//
//   - Name the DIRECTION of replacement in project language. "Use the Dropbox
//     version" / "Keep this device's version" — never "override the file",
//     never a path, never a rev.
//   - Sightlines does not merge layouts. There is no fifth option that quietly
//     combines the two versions, so the copy must not imply one exists.
//
// Every choice is a full-width pane rather than a footer button row: they are
// four different outcomes for the user's work, not a confirm/cancel pair, and
// each needs its consequence stated underneath. "Not now" is one of them for
// the same reason — postponing is a real, persisted outcome ("Needs review"),
// not a way of closing the dialog.

type Choice = {
  key: string;
  label: string;
  note: string;
  run: () => void;
};

export function SyncConflictDialog({
  conflict,
  onResolve,
  onDisableSync
}: {
  conflict: SyncConflictRecord | null;
  onResolve: (choice: SyncConflictChoice) => void;
  // The missing-head variant's second option unlinks this device instead of
  // resolving a conflict — there is no remote copy left to decide about.
  onDisableSync: () => void;
}) {
  if (!conflict) return null;

  const postpone: Choice = {
    key: "not-now",
    label: "Not now",
    note: "Nothing changes here or in Dropbox. This project shows Needs review until you decide.",
    run: () => onResolve("not-now")
  };

  const { title, description, choices } = conflict.remoteMissing
    ? {
        title: "This project’s synced copy is missing from Dropbox",
        description:
          "The copy your devices sync with is gone. Your work on this device is untouched, and Sightlines never puts a synced copy back on its own.",
        choices: [
          {
            key: "keep-mine",
            label: "Put this version back in Dropbox",
            note: "Uploads this device’s version as the synced copy again.",
            run: () => onResolve("keep-mine")
          },
          {
            key: "disable",
            label: "Turn off sync for this project",
            note: "Keeps the project on this device and stops syncing it. Nothing is deleted.",
            run: onDisableSync
          },
          postpone
        ]
      }
    : {
        title: "This project changed in two places",
        description:
          "It was edited on another device and on this one since they last synced. Sightlines doesn’t merge layouts — choose which complete version to use.",
        choices: [
          {
            key: "use-dropbox",
            label: "Use the Dropbox version",
            note: "Replaces the project on this device. A recovery snapshot is kept.",
            run: () => onResolve("use-dropbox")
          },
          {
            key: "keep-mine",
            label: "Keep this device’s version",
            note: "Replaces the version in Dropbox.",
            run: () => onResolve("keep-mine")
          },
          {
            key: "keep-both",
            label: "Keep both",
            note: "Saves this device’s copy as a separate project and loads the Dropbox version here.",
            run: () => onResolve("keep-both")
          },
          postpone
        ]
      };

  // Display only, and said as such: the rev is the lineage, and two devices'
  // clocks disagree. It answers "which other version is this?", never "which
  // one is newer".
  const remoteWhen = conflict.remoteModifiedIso
    ? formatBackupRelativeTime(conflict.remoteModifiedIso)
    : null;

  return (
    <Dialog
      open
      // Escape and the backdrop mean the same thing the quiet option does:
      // decide later. Closing must never be read as picking a version.
      onOpenChange={(next) => {
        if (!next) onResolve("not-now");
      }}
    >
      <DialogContent className="sync-conflict-dialog" showClose={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="sync-conflict-body">
          {remoteWhen ? (
            <p className="sync-conflict-note">
              The Dropbox version last changed {remoteWhen}.
            </p>
          ) : null}
          <div className="sync-conflict-choices">
            {choices.map((choice) => (
              <button
                className={
                  choice.key === "not-now"
                    ? "sync-conflict-choice is-quiet"
                    : "sync-conflict-choice"
                }
                key={choice.key}
                type="button"
                onClick={choice.run}
              >
                <span className="sync-conflict-choice-label">{choice.label}</span>
                <span className="sync-conflict-choice-note">{choice.note}</span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
