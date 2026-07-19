import type { RecoveryOffer } from "../../store";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";

// Surfaced only when a project fails to load with a typed corruption error AND a
// schema-valid earlier snapshot exists. A restore is never applied silently: the
// user chooses it here. Copy says "a previous copy", not "last good" —
// schema-valid is not a promise that it is semantically what they want.
export function RecoveryDialog({
  offer,
  onRestore,
  onDismiss
}: {
  offer: RecoveryOffer | null;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  const when = offer ? formatSnapshotTime(offer.createdAt) : "";

  return (
    <Dialog
      open={offer !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent className="dialog-alert" showClose={false}>
        <DialogHeader>
          <DialogTitle>This project couldn’t be opened</DialogTitle>
          <DialogDescription>
            {offer ? `Restore a previous copy from ${when}?` : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss}>
            Not now
          </Button>
          <Button onClick={onRestore}>Restore previous copy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatSnapshotTime(createdAtISO: string): string {
  const date = new Date(createdAtISO);
  if (Number.isNaN(date.getTime())) return "an earlier point";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
