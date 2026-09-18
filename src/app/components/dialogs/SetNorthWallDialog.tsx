import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";

export type SetNorthWallRequest = {
  roomId: string;
  wallId: string;
  wallName: string;
  roomName: string;
  /** The wall names that are NOT defaults, in stored loop order. */
  customNames: string[];
};

// Confirmation for "Use as North wall" when it would overwrite names someone
// typed. Same contract as OpenWallDialog: `request` non-null opens it, every
// "no" path lands in onOpenChange(false), and Confirm is the only route to
// onConfirm.
//
// It is raised only for the destructive case — a room whose four walls still
// carry their birth names relabels straight away, because there is nothing to
// lose and a confirm for a no-op is noise.
export function SetNorthWallDialog({
  request,
  onConfirm,
  onOpenChange
}: {
  request: SetNorthWallRequest | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="dialog-alert" showClose={false}>
        <DialogHeader>
          <DialogTitle>Use {request?.wallName} as North wall?</DialogTitle>
          {/* The whole compass is rewritten, not just the wall that was
              clicked — say so before naming what is lost. */}
          <DialogDescription>
            {request
              ? `This will rename all four walls in ${request.roomName} to North, East, South and West. Undo will revert this.`
              : null}
          </DialogDescription>
          {request && request.customNames.length > 0 ? (
            <p className="dialog-alert-note">
              {formatReplacedNames(request.customNames)}
            </p>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Relabel walls
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The names are quoted so a name like "Entrance" cannot be read as part of the
// sentence, and listed in full: there are at most four, and the point of the
// dialog is that the user recognises what they typed.
function formatReplacedNames(names: string[]): string {
  const quoted = names.map((name) => `“${name}”`);
  const list =
    quoted.length === 1
      ? quoted[0]!
      : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]!}`;
  return `${list} will be replaced.`;
}
