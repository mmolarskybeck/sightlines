import {
  describeSharedRooms,
  describeWallContents,
  type OpenWallRequest
} from "../../wallOpening";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";

// Confirmation for opening a wall — removing its surface so the room is open on
// that side. Same contract as DeleteRoomDialog: `request` non-null opens it, and
// Cancel/Escape/overlay all land in onOpenChange(false), so every "no" path is
// the same no-op. Confirm is the only route to onConfirm.
//
// Unlike the room dialog there is no empty-wall fast path: opening a wall is a
// structural change with no other confirmation surface, and an empty wall can
// still be shared with another room.
export function OpenWallDialog({
  request,
  onConfirm,
  onOpenChange
}: {
  request: OpenWallRequest | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  // The title asks the question; this answers what "open" actually does, in
  // the user's words: the wall is deleted and the room opens. Delete leads
  // because that is what is being authorised; open is only the result. Future
  // tense throughout — nothing has happened yet.
  //
  // Kept to three short sentences at most. An empty exterior wall gets two.
  const sentences = [
    request
      ? `This will delete the wall and open ${request.roomName} on that side.`
      : "",
    request ? describeWallContents(request.summary) : "",
    "Undo will revert this."
  ].filter(Boolean);

  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="dialog-alert" showClose={false}>
        <DialogHeader>
          <DialogTitle>Open {request?.wallName}?</DialogTitle>
          <DialogDescription>{request ? sentences.join(" ") : null}</DialogDescription>
          {/* Another room is being changed, which the title can't say. Its own
              beat rather than another clause in the description. */}
          {request && request.sharedRoomNames.length > 0 ? (
            <p className="dialog-alert-note">
              {describeSharedRooms(request.sharedRoomNames, request.willSplit)}
            </p>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Open wall
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
