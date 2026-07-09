import { describeRoomContents, type RoomContentsSummary } from "../roomDeletion";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";

// Confirmation for deleting an OCCUPIED room via the Delete shortcut (empty
// rooms skip straight to deleteRoom — see App's keydown chain). Controlled by
// App: `summary` non-null opens it; Cancel/Escape/overlay dismiss all land in
// onOpenChange(false) via Radix, so every no path is the same no-op. Confirm
// is the only route to onConfirm — one deleteRoom call, one undo entry.
export function DeleteRoomDialog({
  roomName,
  summary,
  onConfirm,
  onOpenChange
}: {
  roomName: string;
  summary: RoomContentsSummary | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={summary !== null} onOpenChange={onOpenChange}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>Delete {roomName}?</DialogTitle>
          <DialogDescription>
            {summary
              ? `It contains ${describeRoomContents(summary)}. Deleting the room removes them too — undo brings everything back.`
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete room
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
